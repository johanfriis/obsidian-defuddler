# Android Web Clipper for Obsidian — Context & Decision

## Links

- https://stephango.com/obsidian-web-clipper
- https://github.com/kepano/clipper-templates/
- https://obsidian.md/help/web-clipper
- https://github.com/obsidianmd/obsidian-clipper

## Problem

Johan is a heavy tab hoarder (hundreds of tabs on mobile + desktop, used as an unstructured "memory palace" for in-progress research, reference videos, articles to read). Goal: a frictionless, one-by-one way to send a link from Android to a permanent, structured location — his Obsidian vault. Ideally, mimicing the features of the official Obsidian Web Clipper on desktop. Bulk import is explicitly *not* a requirement; curated, single-item capture is fine.

## Root cause diagnosed

Every browser-extension-based approach on Android depends on the browser correctly relaying Obsidian's `obsidian://` URI to the OS as an intent, so Obsidian's app can open and receive the clipped content. This handoff is the fragile, inconsistently-implemented link across mobile browsers.

## Decision

Build a small, dedicated Android app that replicates what the Obsidian Web Clipper does, potentially **writing directly to the vault folder instead of relying on the **`obsidian://`** handoff.** If possible, using the URI would be ideal, as that let’s Obsidian run it’s usual import triggers.

### Proposed shape

1. **Android share target** — app appears in the system share sheet for any link. Standard, low-risk boilerplate.
2. **Content extraction** — fetch the page and run it through Mozilla's Readability.js + Turndown.js (the same libraries Obsidian's own Web Clipper bundles) inside a hidden WebView, to get clean Markdown. Reuse rather than reimplement — Obsidian Web Clipper is open source.
3. Display this markdown in a “Reader” view, displaying actions to highlight, copy, style and clip (See items marked in red in “Obsidian Web Clipper UI - 1” screenshot.
4. **Save to Obsidian** — either via Android's Storage Access Framework, write the resulting `.md` file directly into the vault folder, or trigger an import via `obsidian://` URI targets.

### Description of screenshots

1. This shows a web page opened in the “Reader” view of the Obsidian Web Clipper on mobile, inside firefox. The buttons at the top are added by the clipper, and allows the user to manipulate the clipper. The first button (to the left) shows a table of contents, the second (first in the right group) activates the highlighter, the third button renders a small popup that allows the user to copy the article to clipboard or save it as a file, the fourth opens a UI for changing how the reader mode is rendering it’s contents (shown in screenshot 2) and the final button opens the clipper UI itself, allowing the user to edit metadata and content as well as trigger the clip action itself.
2. This shows the “Reader” style at the bottom of the screen, allowing the user to change things like font size, color etc … We can explore this in detail in another pass
3. This shows the clipper ui itself, allowing editing of metadata and content as well as the button to trigger the clip itself.

## Considerations

1. ensure that the original web clipper has a license that allows us to replicate a lot of it for our own purposes. Make sure that any license we add to our project is compatible with the original licenses.