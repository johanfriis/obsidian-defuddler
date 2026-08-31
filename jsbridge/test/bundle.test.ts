import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';
import { parseHTML } from 'linkedom';
import { beforeAll, describe, expect, it } from 'vitest';

// Playbook M0/B1: prove the bundle builds from the pinned submodule and evaluates into a DOM
// exposing window.__clipper. Reader.toggle itself needs a real browser — that is B3, on device.
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const bundlePath = join(root, '../android/app/src/main/assets/clipper-bundle.js');

let source: string;
let run: <T = unknown>(expression: string) => T;
let reinject: () => void;

beforeAll(() => {
  execFileSync(process.execPath, ['build.mjs'], { cwd: root, stdio: 'pipe' });
  source = readFileSync(bundlePath, 'utf8');
  ({ run, reinject } = createContext());
}, 120_000);

/**
 * Evaluates the bundle once against a linkedom document with the browser globals it touches, and
 * hands back probes into that one context.
 *
 * Deliberately a single shared context rather than one per test: linkedom's `Window` is a proxy
 * that shares its property namespace across `parseHTML` calls, so `window.__clipper` set on one
 * "fresh" window is visible on the next, and a second bundle evaluation would silently keep the
 * first one's closures. One context is also ~12x less work — this bundle is ~2 MB.
 *
 * Assertions go through `run()` — a string in, a primitive out — which is the same shape as the
 * PROBE the device harness (SpikeBActivity) sends through `evaluateJavascript`.
 */
function createContext() {
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
    // Stands in for the browser's blob-URL minting, keeping the text where a probe can read it.
    URL: {
      createObjectURL: (blob: { parts: string[] }) => {
        const w = window as unknown as { __blobs?: string[] };
        (w.__blobs ??= []).push(blob.parts[0]);
        return `blob:stub/${w.__blobs.length}`;
      },
    },
  };
  sandbox.globalThis = sandbox;
  sandbox.self = sandbox;
  Object.setPrototypeOf(sandbox, window);

  const evaluate = (js: string, filename: string) =>
    runInNewContext(js, sandbox, { filename });

  evaluate(source, 'clipper-bundle.js');

  // Resolve every embedded asset up front so tests can assert on the text in any order —
  // getURL caches, so only the first call per asset mints a blob.
  evaluate(
    `window.__assetText = {};
     ['reader.css', 'highlighter.css', 'flatten-shadow-dom.js'].forEach(function (name) {
       window.__clipper.browser.runtime.getURL(name);
       window.__assetText[name] = window.__blobs[window.__blobs.length - 1];
     });`,
    'setup.js',
  );

  return {
    run: <T = unknown>(expression: string): T => evaluate(expression, 'probe.js') as T,
    /** Re-runs the whole bundle in the same page, the way Kotlin re-injects per page load. */
    reinject: () => evaluate(source, 'clipper-bundle.js'),
  };
}

function messagesFor(locale: string) {
  return JSON.parse(
    readFileSync(join(root, `vendor/obsidian-clipper/src/_locales/${locale}/messages.json`), 'utf8'),
  );
}

describe('clipper-bundle', () => {
  it('builds to the committed asset path', () => {
    expect(existsSync(bundlePath)).toBe(true);
    expect(source.length).toBeGreaterThan(500_000);
  });

  it('evaluates into a document and exposes the __clipper surface', () => {
    expect(run('window.obsidianReaderInitialized')).toBe(true);
    expect(run('typeof window.__clipper')).toBe('object');
    expect(run('typeof window.__clipper.toggle')).toBe('function');
    expect(run('typeof window.__clipper.isActive')).toBe('function');
    expect(run('typeof window.__clipper.installReaderCss')).toBe('function');
    expect(run('typeof window.__clipper.Reader.toggle')).toBe('function');
    expect(run('window.__clipper.isActive()')).toBe(false);
  });

  it('is idempotent — re-injecting does not replace the surface', () => {
    run('window.__first = window.__clipper');
    reinject();
    expect(run('window.__clipper === window.__first')).toBe(true);
  });

  it('ships our shim, not webextension-polyfill (MPL-2.0 — playbook §17)', () => {
    // The real polyfill self-identifies with these; neither may appear. (DOMPurify's own
    // Apache-2.0-OR-MPL-2.0 banner does appear and is expected — §17 lists it as shipped.)
    expect(source).not.toContain('webextension-polyfill/dist');
    expect(source).not.toContain('wrapAPIs');
    expect(source).not.toContain('This library provides a browser.* API');
    // Positive proof the alias landed: a string only our shim contains.
    expect(source).toContain('[shim] runtime.getURL');
  });

  it('serves compiled reader.css through runtime.getURL', () => {
    // utils/reader.ts injects reader.css by calling runtime.getURL and setting <link href>.
    // Upstream ships it as a separate webpack entry, so nothing imports it — if build.mjs ever
    // stops compiling it, the reader renders unstyled and only this test would notice.
    expect(run('window.__clipper.browser.runtime.getURL("reader.css")')).toMatch(/^blob:/);
    expect(run<number>('window.__assetText["reader.css"].length')).toBeGreaterThan(20_000);
    expect(run('window.__assetText["reader.css"].includes(".obsidian-reader-active")')).toBe(true);
    expect(run('window.__assetText["reader.css"].includes("--background-primary")')).toBe(true);
  });

  it('embeds reader.css without an @charset rule (illegal inside <style>)', () => {
    expect(run('window.__assetText["reader.css"].trimStart().startsWith("@charset")')).toBe(false);
  });

  it('serves highlighter.css and flatten-shadow-dom.js too', () => {
    expect(run<number>('window.__assetText["highlighter.css"].length')).toBeGreaterThan(500);
    expect(run<number>('window.__assetText["flatten-shadow-dom.js"].length')).toBeGreaterThan(100);
  });

  it('caches one blob URL per asset rather than leaking one per call', () => {
    expect(
      run(
        'window.__clipper.browser.runtime.getURL("reader.css") ===' +
          ' window.__clipper.browser.runtime.getURL("reader.css")',
      ),
    ).toBe(true);
  });

  it('warns rather than throwing when an asset is not bundled', () => {
    expect(run('window.__clipper.browser.runtime.getURL("nope.css")')).toBe('nope.css');
  });

  it('installs reader.css as an inline <style> upstream will not overwrite', () => {
    // The CSP fallback (see bundle-entry.ts): upstream keeps any element carrying this id through
    // its stylesheet-strip pass and only creates its own blob <link> when none exists. If that
    // contract changes upstream, this test is what notices.
    expect(run('window.__clipper.installReaderCss()')).toBe(true);
    expect(run('document.getElementById("obsidian-reader-styles").tagName')).toBe('STYLE');
    expect(
      run(
        'document.getElementById("obsidian-reader-styles")' +
          '.textContent.includes(".obsidian-reader-active")',
      ),
    ).toBe(true);
    // Idempotent — a second call must not stack duplicate stylesheets.
    expect(run('window.__clipper.installReaderCss()')).toBe(false);
    expect(run('document.querySelectorAll("#obsidian-reader-styles").length')).toBe(1);
  });

  it('resolves real English strings rather than message keys', () => {
    // getMessage labels every button in the reader toolbar (screenshot 1).
    const expected = messagesFor('en').readerSettings.message;
    expect(run('window.__clipper.browser.i18n.getMessage("readerSettings")')).toBe(expected);
    expect(source).toContain(expected);
  });

  it('bundles only the locales build.mjs keeps', () => {
    const en = JSON.stringify(messagesFor('en'));
    const danishOnly = Object.values(messagesFor('da')).find(
      (m: any) => m.message && m.message.length > 12 && !en.includes(m.message),
    ) as { message: string } | undefined;
    if (danishOnly) expect(source).not.toContain(danishOnly.message);
  });
});
