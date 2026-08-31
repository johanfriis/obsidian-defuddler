// Replacement for `webextension-polyfill` (playbook §4, D15/§17 — the real polyfill is MPL-2.0
// and must never ship). Upstream imports it from exactly one place,
// `src/utils/browser-polyfill.ts`, so a single esbuild alias covers every `browser.*` call in
// the vendored tree.
//
// Spike B scope: storage is in-memory, runtime messaging is a local event bus, and getURL is
// backed by the asset map build.mjs embeds. M1.3 replaces storage and runtime with the Kotlin
// AndroidBridge; i18n and getURL are already in their final shape.

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

// --- storage ---------------------------------------------------------------
// `storage.sync` and `storage.local` are distinct areas upstream: Reader.loadSettings reads
// `reader_settings` from sync, storage-utils reads general settings from local. Both are backed
// by their own map here; both merge over module-level defaults upstream, so an empty area is safe.

function storageArea() {
  const store = new Map<string, unknown>();

  const read = (keys?: string | string[] | Record<string, unknown> | null) => {
    const out: Record<string, unknown> = {};
    if (keys == null) {
      for (const [k, v] of store) out[k] = v;
      return out;
    }
    if (typeof keys === 'string') {
      if (store.has(keys)) out[keys] = store.get(keys);
      return out;
    }
    if (Array.isArray(keys)) {
      for (const k of keys) if (store.has(k)) out[k] = store.get(k);
      return out;
    }
    // Object form: the values are defaults for missing keys.
    for (const [k, fallback] of Object.entries(keys)) {
      out[k] = store.has(k) ? store.get(k) : fallback;
    }
    return out;
  };

  return {
    get: async (keys?: string | string[] | Record<string, unknown> | null) => read(keys),
    set: async (items: Record<string, unknown>) => {
      for (const [k, v] of Object.entries(items)) store.set(k, v);
    },
    remove: async (keys: string | string[]) => {
      for (const k of Array.isArray(keys) ? keys : [keys]) store.delete(k);
    },
    clear: async () => void store.clear(),
  };
}

const storage = {
  local: storageArea(),
  sync: storageArea(),
  session: storageArea(),
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

/** Local event bus. M1.3 forwards this to Kotlin via AndroidBridge.postMessage. */
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
  return undefined;
}

const runtime = {
  id: 'obsidian-reader-android',
  getURL,
  getManifest: () => ({ version: '0.0.0' }),
  sendMessage,
  onMessage,
  onInstalled: eventSource(),
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

export { storage, runtime, i18n, tabs, scripting };
/** Raw embedded asset text. Not part of the polyfill surface — bundle-entry.ts uses it for the
 *  inline-CSS delivery path, which exists because blob URLs are subject to page CSP. */
export { assets as bundledAssets };
export default browser;
