// Entry point for android/app/src/main/assets/clipper-bundle.js.
//
// Kotlin injects this file into the page and then drives it through `window.__clipper`.
// Layer B (reader) only for now; Layer A (`clip()`) joins it in M2.

import { Reader } from '../vendor/obsidian-clipper/src/utils/reader';
import { initializeI18n } from '../vendor/obsidian-clipper/src/utils/i18n';
import browser, { bundledAssets } from '../shim/browser';

declare global {
  interface Window {
    __clipper?: ClipperBundle;
    obsidianReaderInitialized?: boolean;
  }
}

/** How the reader's stylesheet reaches the page. See `installReaderCss`. */
export type CssMode = 'link' | 'inline';

interface ClipperBundle {
  Reader: typeof Reader;
  toggle: (cssMode?: CssMode) => Promise<boolean>;
  isActive: () => boolean;
  installReaderCss: () => boolean;
  installTrustedTypesPolicy: () => string;
  /** The shim standing in for webextension-polyfill. Exposed so B3 can inspect storage and
   *  asset resolution from chrome://inspect, and so tests can exercise runtime.getURL. */
  browser: typeof browser;
}

// The id upstream protects from its own stylesheet-stripping pass (utils/reader.ts).
const READER_STYLE_ID = 'obsidian-reader-styles';

/**
 * Delivers reader.css as an inline `<style>` instead of upstream's blob-URL `<link>`.
 *
 * Upstream is a browser extension, so its `chrome-extension://` stylesheet is exempt from the
 * page's CSP. We have no such exemption and a blob URL is just another URL to `style-src` —
 * github.com, for instance, sends `default-src 'none'; style-src 'unsafe-inline' …`, which
 * refuses the blob but permits an inline style.
 *
 * No monkeypatching required: upstream keeps any element carrying READER_STYLE_ID through its
 * strip pass, and only creates its own `<link>` `if (!getElementById(READER_STYLE_ID))`. So
 * pre-inserting the style makes upstream skip the blob path on its own — which means this keeps
 * working across submodule bumps unless upstream changes that contract.
 *
 * Returns false if the style was already present.
 */
function installReaderCss(): boolean {
  if (document.getElementById(READER_STYLE_ID)) return false;
  const style = document.createElement('style');
  style.id = READER_STYLE_ID;
  style.textContent = bundledAssets['reader.css'] ?? '';
  (document.head ?? document.documentElement).appendChild(style);
  return true;
}

/**
 * Installs a pass-through Trusted Types default policy so the reader can write HTML.
 *
 * Pages sending `require-trusted-types-for 'script'` (YouTube does) reject plain strings passed
 * to innerHTML, DOMParser.parseFromString and script src. That stops the reader dead: Defuddle
 * fails extraction and `Reader.apply` throws. A browser extension never meets this because its
 * content script runs in an isolated world, which Trusted Types does not police; our
 * main-world injection is policed.
 *
 * A default policy is only creatable when the page has no `trusted-types` directive naming
 * allowed policies — YouTube sends none, so this succeeds there. Where it is refused we log and
 * carry on: the reader will fail on that page, which is honest and visible.
 *
 * The trade, stated plainly: a pass-through default policy switches off the page's own XSS
 * guard for the life of that document. Acceptable here because this WebView exists to render a
 * page the user chose into our reader, and we are already injecting a bundle that rewrites the
 * whole DOM — but it is a real reduction in the page's defences, not a free win.
 *
 * Returns a short status for the spike log and tests.
 */
function installTrustedTypesPolicy(): string {
  const tt = (window as unknown as { trustedTypes?: any }).trustedTypes;
  if (!tt || typeof tt.createPolicy !== 'function') return 'unsupported';
  if (tt.defaultPolicy) return 'already-present';
  try {
    tt.createPolicy('default', {
      createHTML: (input: string) => input,
      createScript: (input: string) => input,
      createScriptURL: (input: string) => input,
    });
    return 'installed';
  } catch (error) {
    console.warn('[clipper] Trusted Types default policy refused', error);
    return 'refused';
  }
}

/** Mirrors reader-script.ts: it tracks reader state with a class on documentElement. */
function isActive(): boolean {
  return document.documentElement.classList.contains('obsidian-reader-active');
}

async function toggle(cssMode: CssMode = 'link'): Promise<boolean> {
  installTrustedTypesPolicy();
  if (cssMode === 'inline') installReaderCss();
  // Toggling off restores the page via reload, so read state before calling.
  const wasActive = isActive();
  const active = await Reader.toggle(document);
  if (!wasActive) {
    document.documentElement.classList.toggle('obsidian-reader-active', active);
  }
  return active;
}

// Idempotent: Kotlin re-injects on every onPageFinished, and SPA navigation can fire it twice.
if (!window.obsidianReaderInitialized) {
  window.obsidianReaderInitialized = true;
  window.__clipper = { Reader, toggle, isActive, installReaderCss, installTrustedTypesPolicy, browser };
  // Sets the dayjs locale and resolves the UI language; failure is not fatal, getMessage
  // falls back to English.
  initializeI18n().catch((error: unknown) => {
    console.warn('[clipper] i18n init failed', error);
  });
}
