// Entry point for android/app/src/main/assets/clipper-bundle.js.
//
// Kotlin injects this file into the page and then drives it through `window.__clipper`.
// Layer B (reader) only for now; Layer A (`clip()`) joins it in M2.

import { Reader } from '../vendor/obsidian-clipper/src/utils/reader';
// Upstream's content script, imported for its side effects: it registers the
// `browser.runtime.onMessage` listener that answers `getPageContent` — the question the clip sheet
// asks this document through Kotlin (M2.2). It is an IIFE with its own generation guard, so a
// second injection yields to the newer instance rather than double-answering.
import '../vendor/obsidian-clipper/src/content';
// Upstream's reader entry. It is what answers `toggleReaderMode`, which is how the *popup's* Reader
// button reaches this page (D33) — our own `__clipper.toggle()` is the shell's route, not the
// clipper UI's. It guards on `window.obsidianReaderInitialized`, the same flag this file sets
// below, so it has to be imported here at the top: set the flag first and this import becomes a
// silent no-op with a Reader button that does nothing.
import '../vendor/obsidian-clipper/src/reader-script';
import { initializeI18n } from '../vendor/obsidian-clipper/src/utils/i18n';
import browser, { bundledAssets, hasNativeBridge, receiveFromNative } from '../shim/browser';

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
  /** Whether the reader actually built its container (as opposed to merely being toggled). */
  rendered: () => boolean;
  /** Answers `prefers-color-scheme` with the app's theme; see the function's comment. */
  installColorSchemeBridge: (dark: boolean) => void;
  installReaderCss: () => boolean;
  installHighlighterCss: () => boolean;
  installTrustedTypesPolicy: () => string;
  /** Replaces the Obsidian mark in the reader toolbar; returns how many it found (M1.5). */
  sweepBranding: (doc: Document) => number;
  /** Marks the toolbar buttons whose milestones have not landed; returns how many (M1.6). */
  hideUnbuiltControls: (doc: Document) => number;
  /** Entry point for events sent down from Kotlin via evaluateJavascript (M1.3). */
  receive: (json: string) => void;
  /** Whether storage and messaging are really reaching Kotlin, or falling back to in-memory.
   *  Read from chrome://inspect when the reader behaves as if it has no settings. */
  hasNativeBridge: boolean;
  /** The shim standing in for webextension-polyfill. Exposed so B3 can inspect storage and
   *  asset resolution from chrome://inspect, and so tests can exercise runtime.getURL. */
  browser: typeof browser;
}

// Ids upstream guards on before injecting its own blob <link> (utils/reader.ts). Pre-installing
// an element under each id makes upstream skip the blob path entirely.
const READER_STYLE_ID = 'obsidian-reader-styles';
const HIGHLIGHTER_STYLE_ID = 'obsidian-highlighter-stylesheet';

/**
 * Delivers a bundled stylesheet as an inline `<style>` instead of upstream's blob-URL `<link>`.
 *
 * Upstream is a browser extension, so its `chrome-extension://` stylesheets are exempt from the
 * page's CSP. We have no such exemption and a blob URL is just another URL to `style-src` —
 * github.com sends `default-src 'none'; style-src 'unsafe-inline' …`, which refuses the blob but
 * permits an inline style. Measured on device: with the blob path the reader strips the page's
 * styles and gets nothing back (§2, B3).
 *
 * No monkeypatching required: upstream keeps any element carrying these ids through its strip
 * pass, and only creates its own `<link>` when `getElementById(id)` finds nothing. Pre-inserting
 * the style makes upstream skip the blob path on its own, so this keeps working across submodule
 * bumps unless upstream changes that contract — which the tests would catch.
 *
 * Returns false if the style was already present.
 */
function installStyle(id: string, asset: string, extra = ''): boolean {
  if (document.getElementById(id)) return false;
  const style = document.createElement('style');
  style.id = id;
  style.textContent = (bundledAssets[asset] ?? '') + extra;
  (document.head ?? document.documentElement).appendChild(style);
  return true;
}

/** reader.css — guarded by upstream's `obsidian-reader-styles` id. */
function installReaderCss(): boolean {
  return installStyle(READER_STYLE_ID, 'reader.css', UNBUILT_CONTROLS_CSS);
}

/**
 * highlighter.css — guarded by `Reader.ensureHighlighterCSS`'s `obsidian-highlighter-stylesheet`
 * id. Not needed until M4 turns the pen on, but installed alongside reader.css so the highlighter
 * is not the one thing still refused on a CSP-strict page (§2, B3 follow-up).
 */
function installHighlighterCss(): boolean {
  return installStyle(HIGHLIGHTER_STYLE_ID, 'highlighter.css');
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

// --- M1.5: trademark sweep, and controls whose milestones have not landed ---

/**
 * Upstream's toolbar carries the Obsidian gem on its "add to Obsidian" button. Upstream's MIT
 * grant excludes trademarks, icons and marketing (playbook §17), so the mark cannot ship in ours.
 *
 * Swapped in the DOM rather than patched in the submodule: the same discipline `installStyle`
 * follows, so §14's bump procedure stays a version change rather than a rebase. The mark is
 * matched on its own `viewBox`, which is what identifies it — the gem is the only 256-grid icon
 * in a toolbar of 24-grid lucide shapes.
 *
 * The path data still exists as a string inside the bundle, because it is upstream source we do
 * not patch. It is never rendered, and an unrendered string is not branding — what §17 governs is
 * what the app presents as.
 */
const OBSIDIAN_MARK_VIEWBOX = '0 0 256 256';

/** Neutral placeholder in the 24-grid stroke style of the toolbar's other icons. Final icon at G2. */
const PLACEHOLDER_MARK =
  '<path d="M12 5v14"/><path d="M5 12h14"/>';

function sweepBranding(doc: Document): number {
  // Read the attribute rather than selecting on it: attribute selectors against SVG elements are
  // case-sensitive in the DOM and unsupported outright by linkedom, which is what the tests run
  // on. Walking the toolbar is a handful of nodes and behaves identically in both.
  const marks = [...doc.querySelectorAll('.obsidian-reader-nav svg')].filter(
    (svg) => svg.getAttribute('viewBox') === OBSIDIAN_MARK_VIEWBOX,
  );
  marks.forEach((mark) => {
    const replacement = doc.createElementNS('http://www.w3.org/2000/svg', 'svg');
    replacement.setAttribute('width', '18');
    replacement.setAttribute('height', '18');
    replacement.setAttribute('viewBox', '0 0 24 24');
    replacement.setAttribute('fill', 'none');
    replacement.setAttribute('stroke', 'currentColor');
    replacement.setAttribute('stroke-width', '1.75');
    replacement.setAttribute('stroke-linecap', 'round');
    replacement.innerHTML = PLACEHOLDER_MARK;
    mark.replaceWith(replacement);
  });
  return marks.length;
}

/**
 * Hides the toolbar controls whose milestones have not arrived (M1.6's "hidden or no-op" — hidden
 * is what looks less broken; a visible button that does nothing is exactly the failure the
 * governing principle warns about).
 *
 * The buttons are indistinguishable by class — pen, clip, `Aa` and the gem all carry
 * `obsidian-reader-settings-trigger nav-btn` or a subset — so they are matched on the aria-label
 * upstream gives them, read back through the *same* `getMessage` that rendered it. That tracks
 * upstream's own strings instead of hardcoding "Highlighter", and it is why this cannot be pure
 * CSS. Each milestone un-ships one line:
 *   - `highlighter` — the pen. M4.
 * `addToObsidian` left this list at M2.6: both the paperclip and the gem carry that label, and the
 * gem's `toggleIframe` is now routed to our clip sheet, so it works. That button is *the* one-tap
 * clip from inside the reader, which is what let the shell bar go (D33).
 * The `Aa` panel's own "Settings" row is hidden by CSS: it opens the extension's options page,
 * which upstream builds a link for that we cannot serve from inside the page. Settings is reached
 * from the clip sheet's gear instead.
 * The TOC and `Aa` are left alone: both are upstream features that already work here, and `Aa` now
 * persists its settings through the bridge (M1.3).
 */
const UNBUILT_LABEL_KEYS = ['highlighter'];

const UNBUILT_CONTROLS_CSS = `
[data-clipper-unbuilt] { display: none !important; }
.obsidian-reader-settings-link-button { display: none !important; }
`;

function hideUnbuiltControls(doc: Document): number {
  const unbuilt = new Set(
    UNBUILT_LABEL_KEYS.map((key) => browser.i18n.getMessage(key)).filter(Boolean),
  );
  let hidden = 0;
  doc.querySelectorAll('.obsidian-reader-nav button').forEach((button) => {
    const label = button.getAttribute('aria-label');
    if (label && unbuilt.has(label)) {
      button.setAttribute('data-clipper-unbuilt', '');
      hidden += 1;
    }
  });
  return hidden;
}

/**
 * The app's own dark-mode state, handed in as a closure parameter by the Kotlin injection wrapper
 * (undefined anywhere else, e.g. in tests).
 */
declare const __clipperDarkMode: boolean | undefined;

/**
 * Makes `prefers-color-scheme` answer with the app's theme.
 *
 * Upstream's reader resolves its `auto` appearance through
 * `matchMedia('(prefers-color-scheme: dark)')`. In a WebView that query reports `light` no matter
 * the system setting unless algorithmic darkening is enabled — and enabling that mangles raw pages
 * whose dark support WebView cannot detect, which is measurably worse than leaving them light
 * (see ReaderActivity). So the app tells us its theme and we answer the query ourselves.
 *
 * Only the `prefers-color-scheme` query is intercepted; every other query passes through to the
 * real implementation untouched. The page sees this too, which is a feature rather than a leak: a
 * site that picks its theme from the same query gets to apply *its own* dark stylesheet, which is
 * exactly the outcome algorithmic darkening was a poor substitute for.
 *
 * Johan's explicit Light/Dark choice in the reader's Aa panel still wins — that path never consults
 * the media query at all.
 */
function installColorSchemeBridge(dark: boolean): void {
  const real = window.matchMedia.bind(window);
  const patched = (query: string): MediaQueryList => {
    const list = real(query);
    if (!/prefers-color-scheme/i.test(query)) return list;
    const wants = /dark/i.test(query) ? dark : !dark;
    return new Proxy(list, {
      get(target, prop, receiver) {
        if (prop === 'matches') return wants;
        const value = Reflect.get(target, prop, receiver);
        return typeof value === 'function' ? value.bind(target) : value;
      },
    });
  };
  window.matchMedia = patched as typeof window.matchMedia;
}

/** Mirrors reader-script.ts: it tracks reader state with a class on documentElement. */
function isActive(): boolean {
  return document.documentElement.classList.contains('obsidian-reader-active');
}

/** The action Kotlin listens for. Ours, not upstream's — see `toggle`. */
const READER_APPLIED = 'clipperReaderApplied';

/**
 * Whether the reader really built something, as opposed to having merely been asked to.
 *
 * Deliberately not the `obsidian-reader-active` class: `Reader.apply` catches its own errors, so
 * on a page where extraction dies the class is set while nothing was rendered. The container only
 * exists if apply got far enough to construct it.
 */
function readerRendered(): boolean {
  return !!document.querySelector('.obsidian-reader-container');
}

// 'inline' is the default per Johan's call at G0 (2026-08-31): it costs nothing on pages without
// CSP, and detecting a CSP refusal in order to fall back is harder than simply always inlining.
// 'link' stays available for diagnosing whether a page is CSP-restricted at all.
async function toggle(cssMode: CssMode = 'inline'): Promise<boolean> {
  installTrustedTypesPolicy();
  if (cssMode === 'inline') {
    installReaderCss();
    installHighlighterCss();
  }
  // Toggling off restores the page via reload, so read state before calling.
  const wasActive = isActive();
  const active = await Reader.toggle(document);
  if (!wasActive) {
    document.documentElement.classList.toggle('obsidian-reader-active', active);
    sweepBranding(document);
    hideUnbuiltControls(document);
    // Tell Kotlin the apply finished, and whether anything was actually built (M1.3). Upstream
    // only ever announces the *off* direction (`readerModeChanged`, isActive: false), and
    // `Reader.apply` swallows its own errors — so it resolves whether or not it rendered. The
    // container is the honest signal, and pushing it here is what lets the shell bar stop polling.
    browser.runtime
      .sendMessage({ action: READER_APPLIED, rendered: readerRendered() })
      .catch(() => {});
  }
  return active;
}

// Idempotent: Kotlin re-injects on every onPageFinished, and SPA navigation can fire it twice.
//
// Guarded on our own surface rather than on `obsidianReaderInitialized`, because that flag now has
// two owners: upstream's reader-script sets it from the import above, which runs first, so guarding
// on it here skipped this block entirely and left `window.__clipper` undefined — the bridge, the
// toggle and the reader all gone, with no error. The flag still marks "the reader machinery is
// installed"; `__clipper` marks "our surface is installed", and this block is what installs it.
if (!window.__clipper) {
  window.obsidianReaderInitialized = true;
  // Before anything reads the query — upstream's reader consults it during apply.
  if (typeof __clipperDarkMode === 'boolean') installColorSchemeBridge(__clipperDarkMode);
  window.__clipper = {
    Reader,
    toggle,
    isActive,
    rendered: readerRendered,
    installColorSchemeBridge,
    installReaderCss,
    installHighlighterCss,
    installTrustedTypesPolicy,
    sweepBranding,
    hideUnbuiltControls,
    receive: receiveFromNative,
    hasNativeBridge,
    browser,
  };
  // Sets the dayjs locale and resolves the UI language; failure is not fatal, getMessage
  // falls back to English.
  initializeI18n().catch((error: unknown) => {
    console.warn('[clipper] i18n init failed', error);
  });
}
