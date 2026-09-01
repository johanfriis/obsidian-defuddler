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
export function createSandbox(extras: Record<string, unknown> = {}) {
  const { window, document } = parseHTML('<html><head></head><body><p>hi</p></body></html>');

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
    Blob: function Blob(this: { parts: string[] }, parts: string[]) {
      this.parts = parts;
    },
    URL: {
      createObjectURL: (blob: { parts: string[] }) => {
        const w = window as unknown as { __blobs?: string[] };
        (w.__blobs ??= []).push(blob.parts[0]);
        return `blob:stub/${w.__blobs.length}`;
      },
    },
    ...extras,
  };
  sandbox.globalThis = sandbox;
  sandbox.self = sandbox;
  Object.setPrototypeOf(sandbox, window);

  const evaluate = (js: string, filename: string) => runInNewContext(js, sandbox, { filename });

  return { window, document, sandbox, evaluate };
}
