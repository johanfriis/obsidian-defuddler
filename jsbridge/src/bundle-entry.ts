// Entry point for android/app/src/main/assets/clipper-bundle.js.
//
// Kotlin injects this file into the page and then drives it through `window.__clipper`.
// Layer B (reader) only for now; Layer A (`clip()`) joins it in M2.

import { Reader } from '../vendor/obsidian-clipper/src/utils/reader';
import { initializeI18n } from '../vendor/obsidian-clipper/src/utils/i18n';
import browser from '../shim/browser';

declare global {
  interface Window {
    __clipper?: ClipperBundle;
    obsidianReaderInitialized?: boolean;
  }
}

interface ClipperBundle {
  Reader: typeof Reader;
  toggle: () => Promise<boolean>;
  isActive: () => boolean;
  /** The shim standing in for webextension-polyfill. Exposed so B3 can inspect storage and
   *  asset resolution from chrome://inspect, and so tests can exercise runtime.getURL. */
  browser: typeof browser;
}

/** Mirrors reader-script.ts: it tracks reader state with a class on documentElement. */
function isActive(): boolean {
  return document.documentElement.classList.contains('obsidian-reader-active');
}

async function toggle(): Promise<boolean> {
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
  window.__clipper = { Reader, toggle, isActive, browser };
  // Sets the dayjs locale and resolves the UI language; failure is not fatal, getMessage
  // falls back to English.
  initializeI18n().catch((error: unknown) => {
    console.warn('[clipper] i18n init failed', error);
  });
}
