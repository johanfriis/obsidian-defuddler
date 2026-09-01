import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import { createSandbox } from './sandbox';

// Playbook M0/B1: prove the bundle builds from the pinned submodule and evaluates into a DOM
// exposing window.__clipper. Reader.toggle itself needs a real browser — that is B3, on device.
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const committedBundle = join(root, '../android/app/src/main/assets/clipper-bundle.js');
// Built once by test/global-setup.ts: --prod, so the suite exercises exactly what ships (D28), and
// to scratch, so running tests can never leave a debug bundle in the tree.
const bundlePath = join(root, '.tmp/clipper-bundle.js');

let source: string;
let run: <T = unknown>(expression: string) => T;
let reinject: () => void;

beforeAll(() => {
  source = readFileSync(bundlePath, 'utf8');
  ({ run, reinject } = createContext());
}, 120_000);

/**
 * Evaluates the bundle once into the shared sandbox (see test/sandbox.ts for why once) and hands
 * back probes into that one context.
 *
 * Assertions go through `run()` — a string in, a primitive out — which is the same shape as the
 * PROBE the device harness (SpikeBActivity) sends through `evaluateJavascript`.
 */
function createContext() {
  const { evaluate } = createSandbox();

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
  it('builds, and the committed asset exists', () => {
    expect(existsSync(bundlePath)).toBe(true);
    expect(source.length).toBeGreaterThan(500_000);
    // Whether the *committed* one is current is `npm run verify`'s job, not a test's — a test that
    // rebuilt it in place would make the answer trivially yes.
    expect(existsSync(committedBundle)).toBe(true);
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

  it('installs highlighter.css inline at load, under the id ensureHighlighterCSS guards on', () => {
    // Installed by the bundle's own init, not left to the reader toggle: upstream's *content
    // script* has its own ensureHighlighterCSS (content.ts ~L409) which — unlike the reader's —
    // never guards on an existing sheet and always creates a blob <link>, the thing a CSP-strict
    // page refuses (§2, B3). Ours has to already be there when it looks.
    expect(run('document.getElementById("obsidian-highlighter-stylesheet").tagName')).toBe('STYLE');
    expect(
      run<number>('document.getElementById("obsidian-highlighter-stylesheet").textContent.length'),
    ).toBeGreaterThan(500);
    // Idempotent: a second call finds its own sheet and leaves it alone.
    expect(run('window.__clipper.installHighlighterCss()')).toBe(false);
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

  it('replaces the Obsidian mark in the reader toolbar (M1.5, §17)', () => {
    // The gem is the only 256-grid icon among the toolbar's 24-grid lucide shapes, which is what
    // the sweep matches on. Built by hand here because Reader.apply needs a real browser.
    run(`document.body.innerHTML =
      '<div class="obsidian-reader-nav">' +
      '<button class="nav-btn"><svg viewBox="0 0 256 256"><path d="M94.82 149.44"/></svg></button>' +
      '</div>'`);
    expect(run('window.__clipper.sweepBranding(document)')).toBe(1);
    expect(run('document.querySelectorAll(\'.obsidian-reader-nav svg\').length')).toBe(1);
    expect(run('document.querySelector(".obsidian-reader-nav svg").getAttribute("viewBox")')).toBe(
      '0 0 24 24',
    );
  });

  it('is a no-op on a toolbar that carries no mark', () => {
    run(`document.body.innerHTML =
      '<div class="obsidian-reader-nav"><button class="nav-btn"><svg viewBox="0 0 24 24"></svg></button></div>'`);
    expect(run('window.__clipper.sweepBranding(document)')).toBe(0);
  });

  it('leaves every reader-toolbar control in place — the unbuilt list is empty (M2.7)', () => {
    // The list emptied out as the milestones landed: `addToObsidian` at M2.6 (its `toggleIframe`
    // opens our clip sheet) and `highlighter` at M2.7 (`Reader.toggleHighlighter` is local to the
    // page and needs nothing routed). The mechanism stays, and so does this test: putting a key
    // back should be a deliberate act that fails here first.
    run(`document.body.innerHTML =
      '<div class="obsidian-reader-nav">' +
      '<button aria-label="Contents"></button>' +
      '<button aria-label="Highlighter"></button>' +
      '<button aria-label="Add to Obsidian"></button>' +
      '<button aria-label="Reader settings"></button>' +
      '</div>'`);
    expect(run('window.__clipper.hideUnbuiltControls(document)')).toBe(0);
    expect(run('document.querySelectorAll("[data-clipper-unbuilt]").length')).toBe(0);
  });

  it('ships the CSS that acts on those marks', () => {
    run('var el = document.getElementById("obsidian-reader-styles"); if (el) el.remove();');
    run('window.__clipper.installReaderCss()');
    const css = run<string>('document.getElementById("obsidian-reader-styles").textContent');
    expect(css).toContain('[data-clipper-unbuilt]');
    expect(css).toContain('.obsidian-reader-clip-dropdown');
    // The Aa panel's "Settings" row opens the extension's options page, which we do not have.
    expect(css).toContain('.obsidian-reader-settings-link-button');
    // ...and the reader's own stylesheet is still in there ahead of them.
    expect(css).toContain('obsidian-reader-container');
  });

  it('answers prefers-color-scheme with the app theme, passing other queries through', () => {
    run(`window.__mmCalls = [];
         window.matchMedia = function (q) {
           window.__mmCalls.push(q);
           return { matches: false, media: q, addEventListener: function () {}, removeEventListener: function () {} };
         };
         window.__clipper.installColorSchemeBridge(true);`);

    // The app says dark, so the dark query matches and the light one does not...
    expect(run('window.matchMedia("(prefers-color-scheme: dark)").matches')).toBe(true);
    expect(run('window.matchMedia("(prefers-color-scheme: light)").matches')).toBe(false);
    // ...and an unrelated query is left entirely to the real implementation.
    expect(run('window.matchMedia("(min-width: 600px)").matches')).toBe(false);
    expect(run('window.__mmCalls.length')).toBe(3);
    // Non-`matches` members still work, so upstream's listener wiring is untouched.
    expect(run('typeof window.matchMedia("(prefers-color-scheme: dark)").addEventListener')).toBe(
      'function',
    );
    expect(run('window.matchMedia("(prefers-color-scheme: dark)").media')).toBe(
      '(prefers-color-scheme: dark)',
    );
  });

  it('reports light when the app is light', () => {
    run(`window.matchMedia = function (q) {
           return { matches: false, media: q, addEventListener: function () {}, removeEventListener: function () {} };
         };
         window.__clipper.installColorSchemeBridge(false);`);
    expect(run('window.matchMedia("(prefers-color-scheme: dark)").matches')).toBe(false);
    expect(run('window.matchMedia("(prefers-color-scheme: light)").matches')).toBe(true);
  });

  it('installs a Trusted Types default policy where the page enforces them', () => {
    // YouTube sends `require-trusted-types-for 'script'`, which otherwise breaks Defuddle's
    // innerHTML writes and Reader.apply's DOMParser call. linkedom has no trustedTypes, so the
    // unsupported branch is what runs here; the created/refused branches are exercised on device.
    expect(run('window.__clipper.installTrustedTypesPolicy()')).toBe('unsupported');
    run(`window.__tt = { calls: [], defaultPolicy: null,
           createPolicy: function (n, p) { this.calls.push(n); this.defaultPolicy = p; return p; } };
         window.trustedTypes = window.__tt;`);
    expect(run('window.__clipper.installTrustedTypesPolicy()')).toBe('installed');
    expect(run('window.__tt.calls[0]')).toBe('default');
    expect(run('window.__tt.defaultPolicy.createHTML("<b>x</b>")')).toBe('<b>x</b>');
    // Never stacks a second policy over one already in place.
    expect(run('window.__clipper.installTrustedTypesPolicy()')).toBe('already-present');
    run('delete window.trustedTypes');
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
