// Spike only — throwaway.
//
// Stands in for the content script's `getPageContent` handler (upstream content.ts ~L199).
// In the app this runs in the *page* WebView and the response crosses to the UI WebView; here
// it runs against a fixture loaded into a hidden same-origin iframe, which is close enough to
// answer the question the spike is asking (does the clip sheet populate?).

import Defuddle from 'defuddle';

function getDomain(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}

/** The fixture document the spike is clipping, loaded by the host page. */
function pageDocument(): Document {
  const frame = document.getElementById('spike-page') as HTMLIFrameElement | null;
  return frame?.contentDocument ?? document;
}

// Spike debugging hook.
(globalThis as Record<string, unknown>).__spikeProbe = async () => {
  const doc = pageDocument();
  const d = new Defuddle(doc, { url: doc.URL });
  const r = await d.parseAsync().catch((e: unknown) => ({ error: String(e) }));
  return {
    url: doc.URL,
    docTitle: doc.title,
    bodyLen: doc.body?.innerHTML.length,
    articleTags: doc.querySelectorAll('article').length,
    pTags: doc.querySelectorAll('p').length,
    result: {
      title: (r as any).title,
      wordCount: (r as any).wordCount,
      contentLen: (r as any).content?.length,
      error: (r as any).error,
    },
  };
};

/**
 * Wait for the stand-in page to finish loading.
 *
 * In the app this is free: the page WebView has long since loaded by the time anyone taps Clip.
 * Here the popup starts extracting at its own DOMContentLoaded, which beats the fixture frame,
 * and Defuddle on a half-built document returns 0 words rather than an error.
 */
async function pageReady(): Promise<void> {
  const frame = document.getElementById('spike-page') as HTMLIFrameElement | null;
  if (!frame) return;
  if (frame.contentDocument?.readyState === 'complete') return;
  await new Promise<void>((resolve) => {
    frame.addEventListener('load', () => resolve(), { once: true });
    setTimeout(resolve, 5000);
  });
}

export async function extractFromDocument(): Promise<unknown> {
  await pageReady();
  const doc = pageDocument();
  const url = doc.URL;
  const defuddle = new Defuddle(doc, { url });
  const defuddled = await defuddle.parseAsync().catch(() => defuddle.parse());

  return {
    author: defuddled.author,
    content: defuddled.content,
    description: defuddled.description,
    domain: getDomain(url),
    extractedContent: { ...defuddled.variables },
    favicon: defuddled.favicon,
    fullHtml: doc.documentElement.outerHTML,
    highlights: [],
    image: defuddled.image,
    language: defuddled.language || '',
    parseTime: defuddled.parseTime,
    published: defuddled.published,
    schemaOrgData: defuddled.schemaOrgData,
    selectedHtml: '',
    site: defuddled.site,
    title: defuddled.title,
    wordCount: defuddled.wordCount,
    metaTags: defuddled.metaTags || [],
  };
}
