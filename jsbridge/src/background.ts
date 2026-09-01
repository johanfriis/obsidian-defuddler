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
  // Content-script questions the extension's background would forward to the tab. The router
  // does the forwarding; listing them here is documentation, since falling through is the default.
  'getHighlighterMode',
  'setHighlighterMode',
  'toggleHighlighterMode',
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

export function installBackground(): void {
  // Kotlin's way in, under the same name the page WebView uses, so the router has one call site for
  // both documents. Without it a reply from Kotlin lands on nothing and every request this document
  // makes waits out the shim's timeout — a sheet that renders but stays empty.
  (window as unknown as { __clipper: { receive: (json: string) => void } }).__clipper = {
    receive: receiveFromNative,
  };

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
