# Android Web Clipper for Obsidian — Problem & UI Reference

**What this document is for.** Two things that stay true regardless of implementation: *why* this
project exists (and what is deliberately out of scope), and the **legend for the three UI screenshots**
that the [Build Playbook](<Android Web Clipper for Obsidian — Build Playbook.md>) references throughout
— every "screenshot 1/2/3" in that document resolves here.

It began life as the initial brief. The parts that were proposals have been superseded and are
summarised as pointers at the bottom rather than deleted, so the original reasoning stays visible next
to what replaced it. **Nothing below the "Superseded" heading should be treated as a plan.**

## Links

- https://stephango.com/obsidian-web-clipper
- https://github.com/kepano/clipper-templates/
- https://obsidian.md/help/web-clipper
- https://github.com/obsidianmd/obsidian-clipper

## Problem

Johan is a heavy tab hoarder (hundreds of tabs on mobile + desktop, used as an unstructured "memory
palace" for in-progress research, reference videos, articles to read). Goal: a frictionless, one-by-one
way to send a link from Android to a permanent, structured location — his Obsidian vault. Ideally,
mimicing the features of the official Obsidian Web Clipper on desktop.

**Scope guard: bulk import is explicitly *not* a requirement.** Curated, single-item capture is fine.

**Scope guard: this is not a browser.** No URL bar, back/forward, tabs, history or downloads — the app
receives a shared link and reads it. A page that cannot be reached without signing in is a workaround
Johan performs elsewhere, or a clip that does not happen. *(Build Playbook **D23**.)*

## Root cause diagnosed

Every browser-extension-based approach on Android depends on the browser correctly relaying Obsidian's
`obsidian://` URI to the OS as an intent, so Obsidian's app can open and receive the clipped content.
This handoff is the fragile, inconsistently-implemented link across mobile browsers. A dedicated app
removes it: the app fires the intent itself, as a first-class Android app.

*(This is the reasoning behind Build Playbook D1.)*

## Description of screenshots

Referenced as "screenshot 1/2/3" throughout the Build Playbook, and mapped to owning milestones in its
§16 UI inventory. Image files sit beside this document.

1. **`Obsidian Web Clipper UI - 1.jpg`** — a web page opened in the "Reader" view of the Obsidian Web
   Clipper on mobile, inside Firefox. The buttons at the top are added by the clipper and let the user
   manipulate it. Left to right: **table of contents**; **highlighter** (first in the right group); a
   **copy/save popup** for copying the article to the clipboard or saving it as a file; **reader style
   settings** (opens screenshot 2); and finally the **clipper UI** itself (opens screenshot 3), for
   editing metadata and content and triggering the clip.
2. **`Obsidian Web Clipper UI - 2.jpg`** — the "Reader" style sheet at the bottom of the screen: font
   size, colour and similar.
3. **`Obsidian Web Clipper UI - 3.jpg`** — the clipper UI itself: editing of metadata and content, plus
   the button that triggers the clip.

---

## Superseded — kept for provenance, not for guidance

- **The original decision** was to build a dedicated Android app, "potentially writing directly to the
  vault folder instead of relying on the `obsidian://` handoff", on the grounds that "using the URI
  would be ideal, as that let's Obsidian run it's usual import triggers."
  **That premise is false.** G0/A5 measured that Templater's on-create trigger does *not* fire for
  notes created via `obsidian://new`. The URI path was kept anyway, on different grounds — see Build
  Playbook **D2** and **D18**, and the G0 findings in its §2.
- **The original "proposed shape"** described extraction via Mozilla's Readability.js + Turndown.js.
  **Upstream no longer uses those** — it migrated to [defuddle](https://github.com/kepano/defuddle),
  and upstream also ships a headless clip engine we consume directly. See *Findings that revise the
  brief* in [Architecture & Rationale](<Android Web Clipper for Obsidian — Architecture & Rationale.md>).
  The share-target and reader-view items from that list survive as playbook M1.
- **The licensing question** ("ensure the original web clipper's license allows replication, and that
  ours is compatible") is resolved: everything is MIT, project licensed MIT, with a trademark carve-out
  for Obsidian's gem icon and branding. See Build Playbook **§17** and **D15**.
