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

beforeAll(() => {
  execFileSync(process.execPath, ['build.mjs'], { cwd: root, stdio: 'pipe' });
  source = readFileSync(bundlePath, 'utf8');
}, 120_000);

/** Evaluates the bundle against a linkedom document with the browser globals it touches. */
function evaluateBundle() {
  const { window, document } = parseHTML('<html><body><p>hi</p></body></html>');
  // Record blob contents on the window rather than in a closure: the window object is what
  // demonstrably crosses the vm boundary in both directions (window.__clipper reads back).
  (window as any).__blobs = [] as string[];

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
        const blobs = (window as any).__blobs as string[];
        blobs.push(blob.parts[0]);
        return `blob:stub/${blobs.length}`;
      },
    },
  };
  sandbox.globalThis = sandbox;
  sandbox.self = sandbox;
  Object.setPrototypeOf(sandbox, window);

  runInNewContext(source, sandbox, { filename: 'clipper-bundle.js' });
  return { window, blobs: (window as any).__blobs as string[] };
}

describe('clipper-bundle', () => {
  it('builds to the committed asset path', () => {
    expect(existsSync(bundlePath)).toBe(true);
    expect(source.length).toBeGreaterThan(500_000);
  });

  it('evaluates into a document and exposes the __clipper surface', () => {
    const { window } = evaluateBundle();
    expect(window.obsidianReaderInitialized).toBe(true);
    const clipper = window.__clipper;
    expect(clipper).toBeDefined();
    expect(typeof clipper!.toggle).toBe('function');
    expect(typeof clipper!.isActive).toBe('function');
    expect(typeof clipper!.Reader.toggle).toBe('function');
    expect(clipper!.isActive()).toBe(false);
  });

  it('is idempotent — a second injection does not replace the surface', () => {
    const { window } = evaluateBundle();
    const first = window.__clipper;
    runInNewContext(source, Object.setPrototypeOf({ window, document: window.document, console }, window));
    expect(window.__clipper).toBe(first);
  });

  it('ships our shim, not webextension-polyfill (MPL-2.0 — playbook §17)', () => {
    // The real polyfill self-identifies with this wrapper comment and its CHROME_SEND_MESSAGE
    // callback wrapper; neither may appear. (DOMPurify's own Apache-2.0-OR-MPL-2.0 banner does
    // appear and is expected — §17 lists it as shipped under the Apache notice.)
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
    const { window, blobs } = evaluateBundle();
    const url = window.__clipper!.browser.runtime.getURL('reader.css');
    expect(url).toMatch(/^blob:/);
    const css = blobs.at(-1)!;
    expect(css).toContain('.obsidian-reader-active');
    expect(css).toContain('--background-primary');
    expect(css.length).toBeGreaterThan(20_000);
  });

  it('serves highlighter.css and flatten-shadow-dom.js too', () => {
    const { window } = evaluateBundle();
    const runtime = window.__clipper!.browser.runtime;
    expect(runtime.getURL('highlighter.css')).toMatch(/^blob:/);
    expect(runtime.getURL('flatten-shadow-dom.js')).toMatch(/^blob:/);
  });

  it('caches one blob URL per asset rather than leaking one per call', () => {
    const { window } = evaluateBundle();
    const runtime = window.__clipper!.browser.runtime;
    expect(runtime.getURL('reader.css')).toBe(runtime.getURL('reader.css'));
  });

  it('resolves i18n through the shim when upstream getMessage has no locale loaded', () => {
    const { window } = evaluateBundle();
    expect(window.__clipper!.browser.i18n.getMessage('readerSettings')).toBe(
      messagesEn().readerSettings.message,
    );
  });

  it('resolves real English strings rather than message keys', () => {
    // getMessage is what labels every button in the reader toolbar (screenshot 1).
    const messages = JSON.parse(
      readFileSync(join(root, 'vendor/obsidian-clipper/src/_locales/en/messages.json'), 'utf8'),
    );
    expect(messages.readerSettings?.message).toBeTruthy();
    expect(source).toContain(messages.readerSettings.message);
  });

  it('bundles only the locales build.mjs keeps', () => {
    const danish = JSON.parse(
      readFileSync(join(root, 'vendor/obsidian-clipper/src/_locales/da/messages.json'), 'utf8'),
    );
    const danishOnly = Object.values(danish).find(
      (m: any) => m.message && !JSON.stringify(messagesEn()).includes(m.message),
    ) as { message: string } | undefined;
    if (danishOnly) expect(source).not.toContain(danishOnly.message);
  });
});

function messagesEn() {
  return JSON.parse(
    readFileSync(join(root, 'vendor/obsidian-clipper/src/_locales/en/messages.json'), 'utf8'),
  );
}
