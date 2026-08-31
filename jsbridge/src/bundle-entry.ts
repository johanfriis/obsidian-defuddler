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

/** Mirrors reader-script.ts: it tracks reader state with a class on documentElement. */
function isActive(): boolean {
  return document.documentElement.classList.contains('obsidian-reader-active');
}

async function toggle(cssMode: CssMode = 'link'): Promise<boolean> {
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
  window.__clipper = { Reader, toggle, isActive, installReaderCss, browser };
  // Sets the dayjs locale and resolves the UI language; failure is not fatal, getMessage
  // falls back to English.
  initializeI18n().catch((error: unknown) => {
    console.warn('[clipper] i18n init failed', error);
  });
}
