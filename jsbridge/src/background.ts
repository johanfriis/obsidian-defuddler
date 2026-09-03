// The UI WebView's stand-in for the extension's background service worker (playbook D31, M2.2).
//
// **Why we do not port upstream's `background.ts`.** It is 1109 lines, and its API profile is 19×
// `tabs.sendMessage`, 8× `tabs.query`, plus `contextMenus`, `webRequest`, `scripting.executeScript`
// and `action.setPopup` — browser-chrome management for a world of many tabs, extension actions and
// context menus. This app has one page, no chrome and no menus. What upstream's *UI* actually needs
// from its background is a message responder, so that is what this is.
//
// Two kinds of action arrive here:
//
//   - ones this module answers itself, because the answer is a fact about our single-tab world
//     (`getActiveTab`, `getTabInfo`), and
//   - ones only Kotlin can service, because they touch the *other* WebView or the OS
//     (`sendMessageToTab`, `openObsidianUrl`). Those are forwarded over the bridge.
//
// It registers as the document's *background stand-in* rather than as a `runtime.onMessage`
// listener, because those are different things and the difference bites. Chrome never delivers a
// `runtime.sendMessage` back to its sender; the shim keeps that rule, so this handler is consulted
// on the way out and page listeners are only reached by messages arriving from elsewhere. Anything
// this module returns `undefined` for falls through to Kotlin.

import { registerBackground, receiveFromNative } from '../shim/browser';

/** There is exactly one tab. Kotlin owns it; this is its id everywhere in the UI's world. */
export const TAB_ID = 1;

type Message = { action?: string; [key: string]: unknown };

/** What Kotlin tells the UI WebView about the page WebView, set before the page is shown. */
interface PageContext {
  url: string;
  title: string;
}

/**
 * The page context arrives as query parameters on the UI page's own URL.
 *
 * It cannot be a build-time define (the URL changes per clip) and it cannot be an
 * `evaluateJavascript` call after load, because upstream's popup asks for `getTabInfo` from its own
 * DOMContentLoaded handler and would race us. A query parameter is read synchronously before any of
 * that, and it is upstream's own convention — `Reader.toggleReaderPageIframe` passes `readerUrl`
 * exactly this way, and `core/popup.ts` already falls back to reading it.
 */
const params = new URLSearchParams(location.search);

const page: PageContext = {
  url: params.get('readerUrl') ?? '',
  title: params.get('pageTitle') ?? '',
};

/**
 * Actions that are notifications rather than questions: upstream fires them and ignores the reply.
 * Answering `{ success: true }` keeps its `await` from hanging without inventing a result.
 */
const ACKNOWLEDGED = new Set([
  'contentScriptLoaded',
  'ensureContentScriptLoaded',
  'forceInjectContentScript',
  'sidePanelOpened',
  'sidePanelClosed',
  'activeTabChanged',
  'readerModeChanged',
  'highlighterModeChanged',
  'updateHasHighlights',
  'highlightsCleared',
]);

/**
 * Actions only Kotlin can service. Returning `undefined` from the listener lets the shim fall
 * through to `AndroidBridge.postMessage`, which is the existing path to Kotlin — so this set is
 * documentation as much as logic.
 */
const FOR_KOTLIN = new Set([
  'sendMessageToTab',
  // The reader toolbar's Obsidian button. Upstream means "open the clipper as an in-page iframe";
  // Kotlin opens our bottom sheet instead. Redirected rather than removed (M2.6) — it is the
  // one-tap clip from inside the reader, and it is why there is no shell bar (D33).
  'toggleIframe',
  // Content-script questions the extension's background would forward to the tab. The router
  // does the forwarding; listing them here is documentation, since falling through is the default.
  // The highlighter, including `getHighlighterMode` and `toggleHighlighterMode`. Upstream keeps
  // that state in its background, per tab; we do not, because the page already holds the only real
  // answer in a body class, and Kotlin reads it there (M2.7). Routing them through `content.ts`
  // instead was the bug: its `getHighlighterMode` handler answers by asking the background
  // (content.ts ~L316), so the question bounced straight back out and nothing ever answered it.
  'getHighlighterMode',
  'toggleHighlighterMode',
  'setHighlighterMode',
  'getHighlighterState',
  'getReaderModeState',
  'toggleReaderMode',
  'openObsidianUrl',
  'openOptionsPage',
  'openSettings',
  'saveFile',
  'saveMarkdownToFile',
  'copyMarkdownToClipboard',
  'fetchProxy',
]);

/** Actions seen at least once, for the log line the §14 bump smoke pass watches. */
const seen = new Set<string>();

/**
 * Controls upstream ships that this app cannot honour, hidden rather than left to fail (M2.6).
 *
 * Only one: `embedded-mode` toggles the popup between an extension popup and an in-page iframe, and
 * there is exactly one context here, so it has nothing to switch to. Everything else stays —
 * including the interpreter, which is `display:none` until it is given an API key and so costs
 * nothing to carry, and the reader toggle, which is now the *only* reader toggle (D33).
 */
const UNSUPPORTED_CONTROLS = ['embedded-mode'];

/**
 * Controls that must not merely be hidden but *gone*, because upstream guards on their presence.
 *
 * Only one: settings' Hotkeys section. There are no browser command shortcuts on Android, so the
 * section could never list anything — and `browser.commands` is the one member of the extension API
 * the shim does not implement, so `getCommands()` (`utils/hotkeys.ts` ~L20) threw a TypeError on
 * every load of the page. Removing `#hotkeys-subsection` takes `#keyboard-shortcuts-list` with it,
 * and upstream's own `if (!shortcutsList) return` (`general-settings.ts` ~L299) then skips the
 * whole routine — so the section goes *and* the error goes, without a `commands` stub that would
 * only ever answer with an empty list. D33's rule: get rid of what we cannot support.
 *
 * This runs before upstream's `DOMContentLoaded` handler because module scripts execute after the
 * document is parsed but before that event fires, and `installBackground()` is imported first.
 */
const REMOVED_CONTROLS = ['hotkeys-subsection'];

function hideUnsupportedControls(): void {
  for (const id of UNSUPPORTED_CONTROLS) {
    const el = document.getElementById(id);
    if (el) (el as HTMLElement).style.display = 'none';
  }
  for (const id of REMOVED_CONTROLS) {
    document.getElementById(id)?.remove();
  }
}

export function installBackground(): void {
  // Kotlin's way in, under the same name the page WebView uses, so the router has one call site for
  // both documents. Without it a reply from Kotlin lands on nothing and every request this document
  // makes waits out the shim's timeout — a sheet that renders but stays empty.
  (window as unknown as { __clipper: { receive: (json: string) => void } }).__clipper = {
    receive: receiveFromNative,
  };

  // Upstream's popup builds its header before this runs in some paths and after in others, so do
  // it on both edges rather than guessing which.
  hideUnsupportedControls();
  document.addEventListener('DOMContentLoaded', hideUnsupportedControls);

  registerBackground((raw: unknown) => {
    const message = (raw ?? {}) as Message;
    const action = message.action;
    if (!action) return undefined;

    if (!seen.has(action)) {
      seen.add(action);
      if (DEBUG_MODE) console.info('[bg]', action);
    }

    switch (action) {
      case 'getActiveTab':
        return Promise.resolve({ tabId: TAB_ID });

      case 'getTabInfo':
        return Promise.resolve({
          success: true,
          tab: { id: TAB_ID, url: page.url, title: page.title },
        });


      default:
        if (ACKNOWLEDGED.has(action)) return Promise.resolve({ success: true });
        if (FOR_KOTLIN.has(action)) return undefined;
        // A new action means upstream grew one across a submodule bump. Loud on purpose: §14's
        // smoke pass tells the reader to watch for exactly this line.
        console.warn('[bg] UNHANDLED action:', action);
        return undefined;
    }
  });
}

/** Kotlin updates the page context when the page WebView navigates. */
export function setPageContext(next: Partial<PageContext>): void {
  if (typeof next.url === 'string') page.url = next.url;
  if (typeof next.title === 'string') page.title = next.title;
}
