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
  // Two documents use this shim and they receive the token differently (M2.2).
  //
  // The PAGE WebView gets it as a closure parameter, because that document is a site's, and a
  // closure variable is the one place page script cannot read it back from (see AndroidBridge).
  //
  // The UI WebView has no such wrapper — it loads our own HTML, which loads our own script — so the
  // token rides on the page URL. That is safe *here* and nowhere else: the origin is ours, served
  // from our assets, and no foreign script ever runs on it. On the page WebView the same trick
  // would hand the token to whatever site is loaded.
  const fromClosure = typeof __clipperBridgeToken === 'string' ? __clipperBridgeToken : null;
  const fromUrl =
    typeof location === 'object' && location.protocol === 'https:'
      ? new URLSearchParams(location.search).get('bridgeToken')
      : null;
  const token = fromClosure ?? fromUrl;
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
    if (onChanged.listeners.size === 0) return;
    for (const listener of onChanged.listeners) listener(changes, area, () => {});
  };

  return {
    onChanged,
    get: async (keys?: string | string[] | Record<string, unknown> | null) => read(keys),
    set: async (items: Record<string, unknown>) => {
      const changes: Record<string, { oldValue?: unknown; newValue?: unknown }> = {};
      for (const [k, v] of Object.entries(items)) {
        // Only read the old value when someone is listening: every read is a bridge round trip.
        if (onChanged.listeners.size > 0) changes[k] = { oldValue: getOne(k), newValue: v };
        if (backing) backing.bridge.setItem(backing.token, area, k, JSON.stringify(v));
        else store.set(k, v);
      }
      announce(changes);
    },
    remove: async (keys: string | string[]) => {
      const changes: Record<string, { oldValue?: unknown; newValue?: unknown }> = {};
      for (const k of Array.isArray(keys) ? keys : [keys]) {
        if (onChanged.listeners.size > 0) changes[k] = { oldValue: getOne(k) };
        if (backing) backing.bridge.removeItem(backing.token, area, k);
        else store.delete(k);
      }
      announce(changes);
    },
    clear: async () => {
      const changes: Record<string, { oldValue?: unknown; newValue?: unknown }> = {};
      if (onChanged.listeners.size > 0) {
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

// --- the wire protocol between a document and Kotlin ------------------------
// Three envelope kinds, used in both directions (M2.2). A message with no `kind` is a plain event,
// which is what M1 sent and still sends, so the reader's path is unchanged.
//
//   request   Kotlin, route this to the other WebView and tell me what it said.
//   response  the answer to a request, carrying the id it answers.
//   event     fire and forget.
//
// This exists because upstream's UI asks the *page* questions — `sendMessageToTab` with
// `getPageContent` is the clip path — and in an extension the background does that routing. Here
// the two documents live in different WebViews and only Kotlin can carry anything between them.

type Envelope =
  | { kind: 'request'; id: number; message: unknown }
  | { kind: 'response'; id: number; result: unknown }
  | { kind: 'event'; message: unknown };

/** Outbound requests waiting on Kotlin. */
const pending = new Map<number, (result: unknown) => void>();
let nextRequestId = 1;

/**
 * A reply that never comes would leak a promise upstream is awaiting, and the symptom would be a
 * clip sheet that spins forever with nothing in the log. Kotlin always answers, so this is a
 * backstop against a routing bug rather than an expected path — hence generous: M1.7 measured
 * Defuddle at ~4.3 s on the 864 KB apnews fixture, and a cold page can be slower.
 */
const REQUEST_TIMEOUT_MS = 20_000;

function postToNative(envelope: Envelope): boolean {
  if (!native) return false;
  try {
    native.bridge.postMessage(native.token, JSON.stringify(envelope));
    return true;
  } catch (error) {
    console.warn('[shim] postMessage to Kotlin failed', error);
    return false;
  }
}

/**
 * Deliver a message that arrived *from outside* to this document's `onMessage` listeners.
 *
 * This is `tabs.sendMessage` landing, not `runtime.sendMessage` leaving — see [sendMessage] for why
 * the distinction is load-bearing.
 *
 * The `sendResponse` + `return true` pattern is not a nicety: upstream's content script answers
 * `getPageContent` that way (content.ts ~L199), because extraction is async. A dispatcher that only
 * looked at return values would see `true`, treat it as "not handled", and the clip would silently
 * find no content.
 */
function dispatchInbound(message: unknown): Promise<unknown> | undefined {
  for (const listener of onMessage.listeners) {
    let settle: ((value: unknown) => void) | undefined;
    let answered = false;
    let answer: unknown;
    const sendResponse = (value: unknown) => {
      answered = true;
      answer = value;
      settle?.(value);
    };

    const result = listener(message, {}, sendResponse) as unknown;

    // `return true` means "I will call sendResponse later".
    if (result === true) {
      if (answered) return Promise.resolve(answer);
      return new Promise((resolve) => {
        settle = resolve;
      });
    }
    if (result && typeof (result as Promise<unknown>).then === 'function') {
      return result as Promise<unknown>;
    }
    if (answered) return Promise.resolve(answer);
    if (result !== undefined) return Promise.resolve(result);
  }
  return undefined;
}

/**
 * A message registered as this document's background stand-in, if it has one.
 *
 * Only the UI document does. In a real extension the background is a *separate context*, so
 * `runtime.sendMessage` from the popup reaches it and never the popup's own listeners; we keep our
 * responder in the same document purely for convenience, and this keeps the semantics honest.
 */
let background: ((message: unknown) => Promise<unknown> | undefined) | null = null;

/** Install this document's background stand-in. See `src/background.ts`. */
function registerBackground(handler: (message: unknown) => Promise<unknown> | undefined): void {
  background = handler;
}

/**
 * Upstream's channel *out* of this document — to the extension's background, and from there to
 * wherever the background decides.
 *
 * **It deliberately does not run this document's own `onMessage` listeners.** Chrome does not
 * deliver a `runtime.sendMessage` back to its sender, and depending on that is not pedantry here:
 * upstream's content script ends its listener with an unconditional `return true` (content.ts
 * ~L396), meaning "I will answer asynchronously" for *every* message it is handed, including ones
 * it has no branch for and never answers. Feed a document its own outbound messages and that
 * catch-all swallows them all — the reader's own `clipperReaderApplied` included.
 */
async function sendMessage(message: unknown): Promise<unknown> {
  const answered = background?.(message);
  if (answered !== undefined) return answered;
  if (!native) return undefined;

  const id = nextRequestId++;
  const reply = new Promise<unknown>((resolve) => {
    pending.set(id, resolve);
    setTimeout(() => {
      if (pending.delete(id)) {
        console.warn('[shim] no reply from Kotlin for', JSON.stringify(message).slice(0, 120));
        resolve(undefined);
      }
    }, REQUEST_TIMEOUT_MS);
  });

  if (!postToNative({ kind: 'request', id, message })) {
    pending.delete(id);
    return undefined;
  }
  return reply;
}

/**
 * Events and requests coming *down* from Kotlin, delivered by `evaluateJavascript`. Exposed on the
 * bundle surface as `__clipper.receive` so Kotlin has a stable entry point.
 *
 * A payload with no `kind` is treated as a plain event: that is what M1 sent, and keeping it
 * working means the reader's inbound path did not have to change for M2.
 */
function receiveFromNative(json: string): void {
  let payload: unknown;
  try {
    payload = JSON.parse(json);
  } catch (error) {
    console.warn('[shim] unparseable message from Kotlin', error);
    return;
  }

  const envelope = payload as Partial<Envelope> & { kind?: string };

  if (envelope.kind === 'response') {
    const settle = pending.get(envelope.id as number);
    if (!settle) return; // already timed out, or never ours
    pending.delete(envelope.id as number);
    settle((envelope as { result: unknown }).result);
    return;
  }

  if (envelope.kind === 'request') {
    const id = envelope.id as number;
    const inner = (envelope as { message: unknown }).message;
    const handled = dispatchInbound(inner);
    if (handled === undefined) {
      postToNative({ kind: 'response', id, result: undefined });
      return;
    }
    handled
      .then((result) => postToNative({ kind: 'response', id, result }))
      .catch((error: unknown) => {
        // The asker is another WebView; an error here must reach it as an answer, not as a
        // promise that never settles.
        postToNative({
          kind: 'response',
          id,
          result: { success: false, error: error instanceof Error ? error.message : String(error) },
        });
      });
    return;
  }

  const message = envelope.kind === 'event' ? (envelope as { message: unknown }).message : payload;
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

export { storage, runtime, i18n, tabs, scripting, receiveFromNative, registerBackground };
/** Whether a Kotlin bridge is actually backing storage and messaging. Diagnostics only. */
export const hasNativeBridge = native !== null;
/** Raw embedded asset text. Not part of the polyfill surface — bundle-entry.ts uses it for the
 *  inline-CSS delivery path, which exists because blob URLs are subject to page CSP. */
export { assets as bundledAssets };
export default browser;
