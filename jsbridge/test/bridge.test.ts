import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import { createSandbox } from './sandbox';

/**
 * M1.3 — the contract between the shim and Kotlin's `AndroidBridge`.
 *
 * The bundle is evaluated inside the same wrapper `ClipperBundle.injectionScript` applies on the
 * device, with a fake bridge recording every call. That makes this the executable spec for
 * `AndroidBridge.kt`: if the argument order or the token discipline changes on either side, this
 * fails rather than the phone.
 */
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
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

  const { window, evaluate } = createSandbox({ AndroidBridge });
  (window as unknown as Record<string, unknown>).AndroidBridge = AndroidBridge;

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

  // M2.2's protocol. The clip sheet asks the *page* for its content, and only Kotlin can carry a
  // message between two WebViews — so a message that nothing local handles becomes a request with
  // an id, and the answer comes back against that id. These two tests are the executable spec for
  // the Kotlin router; get the envelope wrong on either side and they fail instead of the phone.
  it('sends an unhandled message to Kotlin as a request, and resolves on the reply', async () => {
    calls.length = 0;
    run(
      'window.__pending = window.__clipper.browser.runtime.sendMessage({ action: "sendMessageToTab", message: { action: "getPageContent" } })',
    );

    expect(calls).toHaveLength(1);
    expect(calls[0].method).toBe('postMessage');
    const sent = JSON.parse(calls[0].args[0] as string);
    expect(sent.kind).toBe('request');
    expect(sent.message).toEqual({
      action: 'sendMessageToTab',
      message: { action: 'getPageContent' },
    });
    expect(typeof sent.id).toBe('number');

    run(
      `window.__clipper.receive(JSON.stringify({ kind: 'response', id: ${sent.id}, result: { title: 'Hello' } }))`,
    );
    expect(await run<Promise<{ title: string }>>('window.__pending')).toEqual({ title: 'Hello' });
  });

  it('routes an inbound request to upstream\'s content script and answers against its id', async () => {
    // `getPageContent` is the clip path: the sheet asks it of the page, through Kotlin. Upstream
    // answers it with `sendResponse` *after* returning `true`, so a dispatcher that only read
    // return values would call it unhandled and the clip would come back empty.
    //
    // What is asserted is the routing — reached the content script, answered against the right id.
    // Not the extracted content: that is `extraction.test.ts`'s job under jsdom, and D14 says we do
    // not pin defuddle's output anyway. Here the sandbox is linkedom and the page is one `<p>`.
    calls.length = 0;
    run(
      "window.__clipper.receive(JSON.stringify({ kind: 'request', id: 77, message: { action: 'getPageContent' } }))",
    );

    await new Promise((resolve) => setTimeout(resolve, 50));
    const reply = calls.find((c) => c.method === 'postMessage');
    expect(reply, 'no response posted back to Kotlin').toBeDefined();
    const envelope = JSON.parse(reply!.args[0] as string);
    expect(envelope.kind).toBe('response');
    expect(envelope.id).toBe(77);
    expect(envelope.result, 'content script answered with nothing').toBeDefined();
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

  // storage.onChanged exists because upstream's *UI* subscribes to it (core/popup.ts) even though
  // the reader never did — M2.0 found the popup dying on an undefined addListener. It then shipped
  // broken a second way: the listener collection is a Set, and `.length` on a Set is undefined, so
  // every guard read false and the event never fired. Hence these tests.
  it('announces a set to storage.onChanged listeners with old and new values', async () => {
    run('window.__changes = []');
    run(
      'window.__clipper.browser.storage.local.onChanged.addListener(function (c) { window.__changes.push(JSON.stringify(c)); })',
    );
    await run<Promise<void>>('window.__clipper.browser.storage.local.set({ watched: "first" })');
    await run<Promise<void>>('window.__clipper.browser.storage.local.set({ watched: "second" })');
    expect(run<string>('window.__changes.join("|")')).toBe(
      '{"watched":{"newValue":"first"}}|{"watched":{"oldValue":"first","newValue":"second"}}',
    );
  });

  it('announces a remove, and stays silent when nothing is listening', async () => {
    run('window.__removals = []');
    run('window.__syncWatcher = function (c) { window.__removals.push(JSON.stringify(c)); }');
    run('window.__clipper.browser.storage.sync.onChanged.addListener(window.__syncWatcher)');
    await run<Promise<void>>('window.__clipper.browser.storage.sync.set({ doomed: 7 })');
    await run<Promise<void>>('window.__clipper.browser.storage.sync.remove("doomed")');
    expect(run<string>('window.__removals.at(-1)')).toBe('{"doomed":{"oldValue":7}}');

    // With the listener detached, a write must not read the old value back over the bridge: the
    // event costs a round trip per key, so it is only paid when someone is actually listening.
    run('window.__clipper.browser.storage.sync.onChanged.removeListener(window.__syncWatcher)');
    calls.length = 0;
    await run<Promise<void>>('window.__clipper.browser.storage.sync.set({ unwatched: 1 })');
    expect(calls.map((c) => c.method)).toEqual(['setItem']);
  });
});
