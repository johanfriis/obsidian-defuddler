// Spike only — throwaway. See the playbook's M2.0 note.
//
// Upstream's `background.ts` is 1109 lines of browser-chrome management (context menus, tab
// lifecycle, action popup behaviour, webRequest). A single-tab Android app has none of that.
// What the UI actually needs from it is a message responder, which is what this is.
//
// The point of the spike: find out how many actions the clip + settings paths really touch.

import browser from 'webextension-polyfill';

/** There is exactly one tab, and it is the page WebView. */
const TAB_ID = 1;

/** Set by the spike host page; in the app this is the page WebView's current URL. */
declare const __spikePageUrl: string;

const pageUrl = typeof __spikePageUrl === 'string' ? __spikePageUrl : 'about:blank';

const seen = new Set<string>();

type Msg = { action?: string; [k: string]: unknown };

/** Hand the page document to the extraction path. In the app this is a cross-WebView hop. */
async function getPageContent(): Promise<unknown> {
  try {
    const { extractFromDocument } = await import('./fake-content');
    const out = await extractFromDocument();
    console.info('[spike-bg] extraction ok, wordCount=', (out as { wordCount?: number }).wordCount);
    return out;
  } catch (error) {
    console.error('[spike-bg] extraction THREW:', error);
    return { success: false, error: String(error) };
  }
}

browser.runtime.onMessage.addListener(async (raw: unknown) => {
  const msg = (raw ?? {}) as Msg;
  const action = msg.action ?? '(none)';
  if (!seen.has(action)) {
    seen.add(action);
    console.info('[spike-bg] first call:', action);
    (globalThis as Record<string, unknown>).__spikeActions = [...seen];
  }

  switch (action) {
    case 'getActiveTab':
      return { tabId: TAB_ID };

    case 'getTabInfo':
      return { success: true, tab: { id: TAB_ID, url: pageUrl, title: document.title } };

    case 'sendMessageToTab': {
      const inner = (msg.message ?? {}) as Msg;
      if (inner.action === 'getPageContent') return await getPageContent();
      // Everything else is highlighter/reader state the spike does not host.
      return { success: true };
    }

    case 'openObsidianUrl':
      // In the app this is shouldOverrideUrlLoading -> startActivity. Here, just record it:
      // the spike's whole question about saving is whether the URI is built correctly.
      (globalThis as Record<string, unknown>).__spikeObsidianUrl = msg.url;
      // Persisted because upstream's popup closes itself after a successful clip, taking any
      // in-memory record with it. (That self-close is itself a finding for the app.)
      try {
        localStorage.setItem('spike:lastObsidianUrl', String(msg.url));
      } catch {
        /* ignore */
      }
      console.info('[spike-bg] obsidian URL:', msg.url);
      return { success: true };

    case 'openOptionsPage':
    case 'openSettings':
      location.href = 'settings.html';
      return { success: true };

    // Fire-and-forget notifications with no meaningful reply.
    case 'contentScriptLoaded':
    case 'ensureContentScriptLoaded':
    case 'forceInjectContentScript':
    case 'sidePanelOpened':
    case 'sidePanelClosed':
    case 'activeTabChanged':
    case 'readerModeChanged':
    case 'highlighterModeChanged':
    case 'updateHasHighlights':
    case 'highlightsCleared':
      return { success: true };

    default:
      console.warn('[spike-bg] UNHANDLED action:', action, msg);
      return { success: false, error: `spike background does not implement "${action}"` };
  }
});

export {};
