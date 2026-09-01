// Replacement for `webextension-polyfill` (playbook §4, D15/§17 — the real polyfill is MPL-2.0
// and must never ship). Upstream imports it from exactly one place,
// `src/utils/browser-polyfill.ts`, so a single esbuild alias covers every `browser.*` call in
// the vendored tree.
//
// `storage` and `runtime` messaging are backed by the Kotlin `AndroidBridge` when one is present
// (M1.3); `i18n` and `getURL` resolve entirely inside the bundle. With no bridge — vitest, or the
// bundle evaluated anywhere but our WebView — storage falls back to in-memory maps, which is what
// the tests exercise.

import { assets, messages } from 'virtual:assets';

type Listener = (...args: any[]) => any;

/** Minimal event source matching the shape upstream consumes (`onX.addListener(fn)`). */
function eventSource() {
  const listeners = new Set<Listener>();
  return {
    listeners,
    addListener: (fn: Listener) => void listeners.add(fn),
    removeListener: (fn: Listener) => void listeners.delete(fn),
    hasListener: (fn: Listener) => listeners.has(fn),
  };
}

// --- the Kotlin bridge -----------------------------------------------------
// `addJavascriptInterface` attaches `AndroidBridge` to the main world of *every* page the WebView
// loads, so any script on a hostile page can call it as easily as we can. Since minSdk is 31 only
// @JavascriptInterface-annotated methods are reachable (no reflection), which bounds the damage to
// what we ourselves expose — but "what we expose" grows a save-to-vault path in M2, so the calls
// are gated on a token instead.
//
// The token is handed in as a *closure parameter* by the Kotlin injection wrapper and never
// written to `window`: page script can read any global we set, but it cannot read a closure
// variable.
//
// What this does not fix, stated plainly so M2 does not assume otherwise: anything reachable
// through `window.__clipper` is reachable by the page, and that includes this module's own storage
// and sendMessage. **A message arriving from JS is therefore never authorisation to save** — M2's
// save must be initiated by a tap on the Kotlin side.
declare const __clipperBridgeToken: string | undefined;

interface NativeBridge {
  getItem(token: string, area: string, key: string): string | null;
  setItem(token: string, area: string, key: string, json: string): void;
  removeItem(token: string, area: string, key: string): void;
  keys(token: string, area: string): string;
  clear(token: string, area: string): void;
  postMessage(token: string, json: string): void;
}

const native: { bridge: NativeBridge; token: string } | null = (() => {
  const token = typeof __clipperBridgeToken === 'string' ? __clipperBridgeToken : null;
  const bridge = (globalThis as { AndroidBridge?: NativeBridge }).AndroidBridge;
  return token && bridge ? { bridge, token } : null;
})();

// --- storage ---------------------------------------------------------------
// `storage.sync` and `storage.local` are distinct areas upstream: Reader.loadSettings reads
// `reader_settings` from sync, storage-utils reads general settings from local. Both are backed
// by their own map here; both merge over module-level defaults upstream, so an empty area is safe.

/**
 * One storage area, backed by SharedPreferences through the bridge when there is one.
 *
 * Reads are synchronous across the bridge and asynchronous to upstream: `@JavascriptInterface`
 * calls block the calling JS thread while Kotlin runs, and a SharedPreferences lookup is a hash
 * probe against an already-loaded map, so there is nothing worth making async. Upstream awaits
 * these anyway.
 *
 * `session` never takes a bridge: it is per-document state by definition and outliving the
 * document would be the bug, not the feature.
 */
function storageArea(area: 'local' | 'sync' | 'session') {
  const store = new Map<string, unknown>();
  const backing = area === 'session' ? null : native;

  const getOne = (key: string): unknown => {
    if (!backing) return store.get(key);
    const raw = backing.bridge.getItem(backing.token, area, key);
    if (raw == null) return undefined;
    try {
      return JSON.parse(raw);
    } catch {
      // A value we cannot parse is a value we did not write. Treat the key as absent so upstream
      // falls back to its defaults rather than propagating a parse error into the reader.
      console.warn(`[shim] storage.${area}: unparseable value at "${key}"`);
      return undefined;
    }
  };

  const hasOne = (key: string): boolean =>
    backing ? backing.bridge.getItem(backing.token, area, key) != null : store.has(key);

  const allKeys = (): string[] => {
    if (!backing) return [...store.keys()];
    try {
      return JSON.parse(backing.bridge.keys(backing.token, area)) as string[];
    } catch {
      return [];
    }
  };

  const read = (keys?: string | string[] | Record<string, unknown> | null) => {
    const out: Record<string, unknown> = {};
    if (keys == null) {
      for (const k of allKeys()) out[k] = getOne(k);
      return out;
    }
    if (typeof keys === 'string') {
      if (hasOne(keys)) out[keys] = getOne(keys);
      return out;
    }
    if (Array.isArray(keys)) {
      for (const k of keys) if (hasOne(k)) out[k] = getOne(k);
      return out;
    }
    // Object form: the values are defaults for missing keys.
    for (const [k, fallback] of Object.entries(keys)) {
      out[k] = hasOne(k) ? getOne(k) : fallback;
    }
    return out;
  };

  // Per-area change events. The reader never subscribed, so this went unnoticed until the
  // extension's own UI pages did (`storage.local.onChanged` in core/popup.ts) and died on an
  // undefined `addListener`. Chrome fires these with a `{ [key]: { oldValue, newValue } }` map.
  const onChanged = eventSource();

  const announce = (changes: Record<string, { oldValue?: unknown; newValue?: unknown }>) => {
    if (onChanged.listeners.length === 0) return;
    for (const listener of onChanged.listeners) listener(changes, area, () => {});
  };

  return {
    onChanged,
    get: async (keys?: string | string[] | Record<string, unknown> | null) => read(keys),
    set: async (items: Record<string, unknown>) => {
      const changes: Record<string, { oldValue?: unknown; newValue?: unknown }> = {};
      for (const [k, v] of Object.entries(items)) {
        // Only read the old value when someone is listening: every read is a bridge round trip.
        if (onChanged.listeners.length > 0) changes[k] = { oldValue: getOne(k), newValue: v };
        if (backing) backing.bridge.setItem(backing.token, area, k, JSON.stringify(v));
        else store.set(k, v);
      }
      announce(changes);
    },
    remove: async (keys: string | string[]) => {
      const changes: Record<string, { oldValue?: unknown; newValue?: unknown }> = {};
      for (const k of Array.isArray(keys) ? keys : [keys]) {
        if (onChanged.listeners.length > 0) changes[k] = { oldValue: getOne(k) };
        if (backing) backing.bridge.removeItem(backing.token, area, k);
        else store.delete(k);
      }
      announce(changes);
    },
    clear: async () => {
      const changes: Record<string, { oldValue?: unknown; newValue?: unknown }> = {};
      if (onChanged.listeners.length > 0) {
        for (const k of allKeys()) changes[k] = { oldValue: getOne(k) };
      }
      if (backing) backing.bridge.clear(backing.token, area);
      else store.clear();
      announce(changes);
    },
  };
}

const storage = {
  local: storageArea('local'),
  sync: storageArea('sync'),
  session: storageArea('session'),
  onChanged: eventSource(),
};

// --- runtime ---------------------------------------------------------------
// getURL resolves against the assets build.mjs embedded. Blob URLs are used so the WebView can
// load reader.css / flatten-shadow-dom.js without any Android-side asset server. Blob URLs are
// created lazily and cached, so repeated getURL calls for the same asset reuse one URL.

// Charset is explicit: sass emits `@charset "UTF-8"` for the reader stylesheet, and a blob URL
// carries no headers of its own.
const MIME: Record<string, string> = {
  css: 'text/css;charset=utf-8',
  js: 'text/javascript;charset=utf-8',
  json: 'application/json',
  html: 'text/html;charset=utf-8',
};

const urlCache = new Map<string, string>();

function getURL(path: string): string {
  const name = path.replace(/^\/+/, '');
  const cached = urlCache.get(name);
  if (cached) return cached;

  const body = assets[name];
  if (body === undefined) {
    console.warn(`[shim] runtime.getURL: no bundled asset named "${name}"`);
    return name;
  }
  const type = MIME[name.split('.').pop() ?? ''] ?? 'application/octet-stream';
  const url = URL.createObjectURL(new Blob([body], { type }));
  urlCache.set(name, url);
  return url;
}

const onMessage = eventSource();

/**
 * Upstream's channel to its background script; here, the channel to Kotlin.
 *
 * The reader sends eight actions (`readerModeChanged`, `copyMarkdownToClipboard`,
 * `saveMarkdownToFile`, `openReaderPage`, `openHighlights`, `openSettings`, `toggleIframe`,
 * `disableYouTubeEmbedRule`). Most belong to milestones that have not landed, so unhandled
 * actions are Kotlin's problem to log, not ours to filter — a silent drop here would be
 * indistinguishable from a bug in the reader.
 *
 * Local listeners still run first, so anything the bundle handles internally keeps working with
 * no bridge at all (which is how the tests see it).
 */
async function sendMessage(message: unknown): Promise<unknown> {
  for (const listener of onMessage.listeners) {
    const result = listener(message, {}, () => {});
    if (result && typeof (result as Promise<unknown>).then === 'function') {
      const resolved = await result;
      if (resolved !== undefined) return resolved;
    } else if (result !== undefined && result !== true) {
      return result;
    }
  }
  if (native) {
    try {
      native.bridge.postMessage(native.token, JSON.stringify(message));
    } catch (error) {
      console.warn('[shim] postMessage to Kotlin failed', error);
    }
  }
  return undefined;
}

/**
 * Events coming *down* from Kotlin, delivered by `evaluateJavascript`. Exposed on the bundle
 * surface as `__clipper.receive` so Kotlin has a stable entry point.
 */
function receiveFromNative(json: string): void {
  let message: unknown;
  try {
    message = JSON.parse(json);
  } catch (error) {
    console.warn('[shim] unparseable message from Kotlin', error);
    return;
  }
  for (const listener of onMessage.listeners) listener(message, {}, () => {});
}

const runtime = {
  id: 'obsidian-reader-android',
  getURL,
  getManifest: () => ({ version: '0.0.0' }),
  sendMessage,
  onMessage,
  onInstalled: eventSource(),
  // Never fires here — an Android app has no extension update channel — but upstream's UI
  // subscribes unconditionally and an undefined member is a TypeError at boot.
  onUpdateAvailable: eventSource(),
  connect: () => ({
    postMessage: () => {},
    disconnect: () => {},
    onMessage: eventSource(),
    onDisconnect: eventSource(),
  }),
  lastError: undefined as { message: string } | undefined,
};

// --- i18n ------------------------------------------------------------------
// Backed by the bundled en messages.json. Upstream's own getMessage() tries a dynamic
// `require('../_locales/…')` first, which esbuild cannot bundle — it throws at runtime and
// upstream falls through to `browser.i18n.getMessage`, i.e. to this implementation. So this is
// the path that actually renders every visible string, and it has to do substitutions and
// placeholders properly rather than echo the key.

function getMessage(name: string, substitutions?: string | string[]): string {
  const entry = messages[name];
  if (!entry) return '';

  let text = entry.message;

  if (substitutions !== undefined) {
    const subs = Array.isArray(substitutions) ? substitutions : [substitutions];
    subs.forEach((sub, i) => {
      text = text.replace(`$${i + 1}`, sub);
    });
  }

  if (entry.placeholders) {
    for (const [key, value] of Object.entries(entry.placeholders)) {
      text = text.replace(`$${key}$`, value.content);
    }
  }

  return text;
}

const i18n = {
  getMessage,
  getUILanguage: () => (typeof navigator !== 'undefined' ? navigator.language : 'en'),
  getAcceptLanguages: async () => [i18n.getUILanguage()],
};

// --- surfaces the reader touches but cannot use in a WebView ---------------
// Present so property access doesn't throw; every call is a no-op. If one of these turns out to
// be load-bearing during B3, that is a finding for §2, not something to paper over here.

const notImplemented = (area: string, method: string) => (..._args: any[]) => {
  console.warn(`[shim] browser.${area}.${method} is not available in the WebView`);
  return Promise.resolve(undefined);
};

const tabs = {
  query: notImplemented('tabs', 'query'),
  create: notImplemented('tabs', 'create'),
  update: notImplemented('tabs', 'update'),
  sendMessage: notImplemented('tabs', 'sendMessage'),
  onUpdated: eventSource(),
  onActivated: eventSource(),
};

const scripting = {
  executeScript: notImplemented('scripting', 'executeScript'),
  insertCSS: notImplemented('scripting', 'insertCSS'),
  removeCSS: notImplemented('scripting', 'removeCSS'),
};

const browser = { storage, runtime, i18n, tabs, scripting };

export { storage, runtime, i18n, tabs, scripting, receiveFromNative };
/** Whether a Kotlin bridge is actually backing storage and messaging. Diagnostics only. */
export const hasNativeBridge = native !== null;
/** Raw embedded asset text. Not part of the polyfill surface — bundle-entry.ts uses it for the
 *  inline-CSS delivery path, which exists because blob URLs are subject to page CSP. */
export { assets as bundledAssets };
export default browser;
