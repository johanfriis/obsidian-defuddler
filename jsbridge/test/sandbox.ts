import { runInNewContext } from 'node:vm';
import { parseHTML } from 'linkedom';

/**
 * The VM sandbox `bundle.test.ts` and `bridge.test.ts` evaluate the bundle in: a linkedom
 * document plus the handful of browser globals the bundle touches at evaluation time.
 *
 * Deliberately one context per suite rather than one per test: linkedom's `Window` is a proxy
 * that shares its property namespace across `parseHTML` calls, so `window.__clipper` set on one
 * "fresh" window is visible on the next, and a second bundle evaluation would silently keep the
 * first one's closures. One context is also ~12x less work — the bundle is ~2 MB.
 *
 * `URL.createObjectURL` records each blob's text on `window.__blobs`, so probes can read what a
 * blob URL would serve (bundle.test.ts asserts on it; harmless where unused).
 */
/** What the sandbox pretends the page is. Only the fields upstream actually reads. */
const PAGE_LOCATION = {
  href: 'https://example.test/article',
  protocol: 'https:',
  host: 'example.test',
  hostname: 'example.test',
  origin: 'https://example.test',
  pathname: '/article',
  search: '',
  hash: '',
};

export function createSandbox(extras: Record<string, unknown> = {}) {
  const { window, document } = parseHTML('<html><head></head><body><p>hi</p></body></html>');
  Object.defineProperty(window, 'location', { value: PAGE_LOCATION, configurable: true });

  const sandbox: Record<string, unknown> = {
    window,
    document,
    navigator: { language: 'en-GB', userAgent: 'node' },
    console,
    setTimeout,
    clearTimeout,
    queueMicrotask,
    requestAnimationFrame: (fn: () => void) => setTimeout(fn, 0),
    matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
    // A page URL. Bundling upstream's content script (M2.2) brought in code that reads
    // `window.location.href` at import time, and linkedom supplies no location at all — without
    // this the bundle rejects on load and every test after it runs against a half-built world.
    location: PAGE_LOCATION,
    // Upstream's content script reads the selection before extracting; linkedom has no such API.
    // An empty selection is the honest default — nothing is selected in here.
    getSelection: () => ({ rangeCount: 0, toString: () => '' }),
    Blob: function Blob(this: { parts: string[] }, parts: string[]) {
      this.parts = parts;
    },
    // The real constructor, plus the object-URL stub. It used to be the stub alone, which meant
    // `new URL(...)` — which upstream uses to absolutise page links — threw in here.
    URL: Object.assign(
      function SandboxURL(this: unknown, url: string, base?: string) {
        return new URL(url, base);
      } as unknown as typeof URL,
      {
        createObjectURL: (blob: { parts: string[] }) => {
          const w = window as unknown as { __blobs?: string[] };
          (w.__blobs ??= []).push(blob.parts[0]);
          return `blob:stub/${w.__blobs.length}`;
        },
        revokeObjectURL: () => {},
      },
    ),
    ...extras,
  };
  sandbox.globalThis = sandbox;
  sandbox.self = sandbox;
  Object.setPrototypeOf(sandbox, window);

  const evaluate = (js: string, filename: string) => runInNewContext(js, sandbox, { filename });

  return { window, document, sandbox, evaluate };
}
