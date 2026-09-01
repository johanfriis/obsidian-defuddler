import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';
import { parseHTML } from 'linkedom';
import { beforeAll, describe, expect, it } from 'vitest';

/**
 * M1.3 — the contract between the shim and Kotlin's `AndroidBridge`.
 *
 * The bundle is evaluated inside the same wrapper `ClipperBundle.injectionScript` applies on the
 * device, with a fake bridge recording every call. That makes this the executable spec for
 * `AndroidBridge.kt`: if the argument order or the token discipline changes on either side, this
 * fails rather than the phone.
 */
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const committedBundle = join(root, '../android/app/src/main/assets/clipper-bundle.js');
// Built once by test/global-setup.ts: --prod, so the suite exercises exactly what ships (D28), and
// to scratch, so running tests can never leave a debug bundle in the tree.
const bundlePath = join(root, '.tmp/clipper-bundle.js');
const TOKEN = 'test-token-1234';

interface Call {
  method: string;
  args: unknown[];
}

let run: <T = unknown>(expression: string) => T;
let calls: Call[];
let prefs: Map<string, string>;

beforeAll(() => {
  const source = readFileSync(bundlePath, 'utf8');

  const { window, document } = parseHTML('<html><head></head><body><p>hi</p></body></html>');
  calls = [];
  prefs = new Map();

  const record = (method: string, args: unknown[]) => calls.push({ method, args });

  // Mirrors AndroidBridge.kt: token first, then area, then key. A wrong token throws there;
  // throwing here too keeps the failure shape honest.
  const auth = (token: unknown) => {
    if (token !== TOKEN) throw new Error('SecurityException: bad token');
  };

  const AndroidBridge = {
    getItem(token: string, area: string, key: string) {
      auth(token);
      record('getItem', [area, key]);
      return prefs.get(`${area}:${key}`) ?? null;
    },
    setItem(token: string, area: string, key: string, json: string) {
      auth(token);
      record('setItem', [area, key, json]);
      prefs.set(`${area}:${key}`, json);
    },
    removeItem(token: string, area: string, key: string) {
      auth(token);
      record('removeItem', [area, key]);
      prefs.delete(`${area}:${key}`);
    },
    keys(token: string, area: string) {
      auth(token);
      record('keys', [area]);
      const out: string[] = [];
      for (const k of prefs.keys()) if (k.startsWith(`${area}:`)) out.push(k.slice(area.length + 1));
      return JSON.stringify(out);
    },
    clear(token: string, area: string) {
      auth(token);
      record('clear', [area]);
      for (const k of [...prefs.keys()]) if (k.startsWith(`${area}:`)) prefs.delete(k);
    },
    postMessage(token: string, json: string) {
      auth(token);
      record('postMessage', [json]);
    },
  };

  (window as unknown as Record<string, unknown>).AndroidBridge = AndroidBridge;

  const sandbox: Record<string, unknown> = {
    window,
    document,
    AndroidBridge,
    navigator: { language: 'en-GB', userAgent: 'node' },
    console,
    setTimeout,
    clearTimeout,
    queueMicrotask,
    requestAnimationFrame: (fn: () => void) => setTimeout(fn, 0),
    matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
    Blob: function Blob(this: { parts: string[] }, parts: string[]) {
      this.parts = parts;
    },
    URL: { createObjectURL: () => 'blob:stub' },
  };
  sandbox.globalThis = sandbox;
  sandbox.self = sandbox;
  Object.setPrototypeOf(sandbox, window);

  const evaluate = (js: string, filename: string) => runInNewContext(js, sandbox, { filename });

  // The wrapper ClipperBundle.injectionScript builds. The token reaches the shim as a closure
  // parameter and is never assigned to window — that is the whole point of it.
  evaluate(
    `(function (__clipperBridgeToken) {\n${source}\n})(${JSON.stringify(TOKEN)});`,
    'clipper-bundle.js',
  );
  run = <T = unknown>(expression: string): T => evaluate(expression, 'probe.js') as T;
}, 120_000);

describe('AndroidBridge contract', () => {
  it('detects the bridge when the token arrives through the wrapper', () => {
    expect(run('window.__clipper.hasNativeBridge')).toBe(true);
  });

  it('keeps the token off window, where page script could read it', () => {
    expect(run('typeof window.__clipperBridgeToken')).toBe('undefined');
    expect(run('JSON.stringify(Object.keys(window.__clipper))')).not.toContain('oken');
  });

  it('round-trips a value through SharedPreferences', async () => {
    await run<Promise<void>>(
      'window.__clipper.browser.storage.sync.set({ reader_settings: { fontSize: 20 } })',
    );
    expect(prefs.get('sync:reader_settings')).toBe('{"fontSize":20}');

    const got = await run<Promise<Record<string, { fontSize: number }>>>(
      'window.__clipper.browser.storage.sync.get("reader_settings")',
    );
    expect(got.reader_settings.fontSize).toBe(20);
  });

  it('keeps local and sync in separate areas', async () => {
    await run<Promise<void>>('window.__clipper.browser.storage.local.set({ shared: "L" })');
    await run<Promise<void>>('window.__clipper.browser.storage.sync.set({ shared: "S" })');
    expect(prefs.get('local:shared')).toBe('"L"');
    expect(prefs.get('sync:shared')).toBe('"S"');
  });

  it('returns object-form defaults for keys the device has never stored', async () => {
    const got = await run<Promise<Record<string, unknown>>>(
      'window.__clipper.browser.storage.local.get({ neverSet: "fallback" })',
    );
    expect(got.neverSet).toBe('fallback');
  });

  it('enumerates an area for get(null)', async () => {
    await run<Promise<void>>('window.__clipper.browser.storage.local.set({ a: 1, b: 2 })');
    const got = await run<Promise<Record<string, unknown>>>(
      'window.__clipper.browser.storage.local.get(null)',
    );
    expect(got.a).toBe(1);
    expect(got.b).toBe(2);
  });

  it('treats an unparseable stored value as absent rather than throwing', async () => {
    prefs.set('local:corrupt', 'not json{');
    const got = await run<Promise<Record<string, unknown>>>(
      'window.__clipper.browser.storage.local.get({ corrupt: "fallback" })',
    );
    // Present but unreadable: upstream gets undefined and falls back to its own defaults.
    expect(got.corrupt).toBeUndefined();
  });

  it('never touches the bridge for session storage', async () => {
    calls.length = 0;
    await run<Promise<void>>('window.__clipper.browser.storage.session.set({ ephemeral: 1 })');
    expect(calls).toHaveLength(0);
  });

  it('forwards runtime.sendMessage up to Kotlin as JSON', async () => {
    calls.length = 0;
    await run<Promise<unknown>>(
      'window.__clipper.browser.runtime.sendMessage({ action: "readerModeChanged", isActive: true })',
    );
    expect(calls).toEqual([
      { method: 'postMessage', args: ['{"action":"readerModeChanged","isActive":true}'] },
    ]);
  });

  it('delivers events sent down from Kotlin to onMessage listeners', () => {
    run('window.__seen = []');
    run('window.__clipper.browser.runtime.onMessage.addListener(function (m) { window.__seen.push(m.action); })');
    run('window.__clipper.receive(JSON.stringify({ action: "fromKotlin" }))');
    expect(run('window.__seen.join(",")')).toBe('fromKotlin');
  });

  it('survives an unparseable message from Kotlin', () => {
    expect(() => run('window.__clipper.receive("{not json")')).not.toThrow();
  });
});
