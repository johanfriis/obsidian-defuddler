# Android Web Clipper for Obsidian — Implementation Plan

## Context

Johan uses hundreds of open browser tabs as an unstructured memory palace. He wants a frictionless, one-link-at-a-time way to move a page from Android into his Obsidian vault, with the same quality of experience as the official desktop Web Clipper: clean reader view, highlighting, editable properties, template-driven notes.

Browser-extension approaches fail on Android because they depend on the mobile browser relaying `obsidian://` to the OS — an inconsistently implemented handoff. A dedicated app removes that link: the app receives the share intent itself and fires the `obsidian://` intent as a first-class Android app, which is a far more reliable path than browser → OS.

The outcome: an Android app that appears in the share sheet, opens the shared link in a full reader view, lets Johan highlight and adjust metadata, and clips into his vault via `obsidian://new`.

## Findings that revise the brief

Researched against upstream on 2026-08-30. Four things change the shape of the work:

1. **Not Readability + Turndown.** The clipper migrated to [defuddle](https://github.com/kepano/defuddle) (kepano's own extractor). `defuddle@0.19.3`, MIT, published 2026-08-22. `dist/index.full.js` is a **760 KB self-contained UMD bundle** — droppable into `assets/` with no build chain. One `parse()` with `separateMarkdown: true` returns clean HTML, markdown, metadata (title/author/published/description/domain/image/wordCount) and the clipper's template variables.

2. **Upstream already ships a headless clip engine.** `src/api.ts` → `dist/api.mjs`, built by `scripts/build-api.mjs` with `platform: 'neutral'`. It is explicitly environment-agnostic and exports `clip()`, `matchTemplate()`, `createSelectorProcessor()`, `createAsyncResolver()`. That covers template compilation, variables, filters, URL/schema.org triggers, frontmatter and note naming — **full template parity from a supported entry point, no fork**.

3. **The reader is one call on a plain Document.** `src/reader-script.ts` shows the entire integration is `Reader.toggle(document)`. Coupling is shallow: `reader.ts` is 2805 lines with only **18** `browser.*` references; `highlighter.ts` 1438 lines / 18 refs; `highlighter-overlays.ts` 743 lines / **0** refs. All funnel through three modules (`browser-polyfill`, `storage-utils`, `i18n`) that can be aliased — the exact pattern `build-api.mjs` already uses with `cli-stubs.ts`.

4. **`obsidian-clipper` is NOT on npm.** (`registry.npmjs.org/obsidian-clipper` → 404, despite the `exports` field.) We consume it as a **pinned git submodule plus a build step**, not a package dependency.

## Answering the brief's "thin web wrapper" question

Johan's instinct — run upstream unmodified in a WebView — is right about the *valuable* parts and wrong about the shell. A pure wrapper would mean faking a background service worker, a separate popup context, `storage.sync`, extension i18n, and shipping a 48 KB desktop-shaped settings page. Not worth it.

**Hybrid, in three layers:**

| Layer | Source | Relationship |
|---|---|---|
| **A. Clip engine** — templates, variables, filters, triggers, frontmatter | `obsidian-clipper/src/api.ts` + `defuddle/full` | **Dependency.** Built by upstream's own script. Zero patches. |
| **B. Reader + highlighter** — the UI in screenshots 1 & 2 | `reader.ts`, `highlighter.ts`, `highlighter-overlays.ts`, `reader.scss`, `highlighter.scss` | **Vendored + shimmed.** ~5000 lines, ~36 API touchpoints, all behind 3 aliasable modules. |
| **C. App shell** — share target, setup, clip sheet, save pipeline | New Kotlin / Jetpack Compose | **Ours.** ~1500 lines. |

**Recommendation on the clip sheet (screenshot 3): build it native, don't vendor `popup.html`.** It is a properties form, a template dropdown and a button — Compose does that better on mobile, and the popup is the piece most entangled with cross-context extension messaging. Layer A gives us its entire brain (`clip()` returns `{noteName, frontmatter, content, properties}`); we only supply the face. The reader/highlighter are the opposite case — pure DOM code with a huge amount of hard-won polish — so those we reuse.

## Architecture

### Flow

```
Share sheet (text/plain URL)
  → ShareReceiverActivity
  → ReaderActivity (WebView, persistent CookieManager, real Chrome UA)
      → load URL → inject clipper-bundle.js
      → Reader.toggle(document)          [screenshot 1 toolbar appears]
      → highlighter + reader settings     [screenshots 1 & 2]
  → "Clip" → JS bridge → clip({ html, url, template, parser })
  → Compose bottom sheet: properties, folder, template, note name  [screenshot 3]
  → SavePipeline
```

### Save pipeline (`obsidian://` primary, per Johan's decision)

1. Compose note = `frontmatter + content` from `ClipResult`.
2. Write to the **Android system clipboard** via `ClipboardManager` in Kotlin (deterministic; do not rely on the WebView's `navigator.clipboard`).
3. Build `obsidian://new?vault=<enc>&file=<enc path>&clipboard=true`, plus `append`/`prepend`/`overwrite` from the template's behavior and `silent=true` if configured. This mirrors `src/utils/obsidian-note-creator.ts`, which is clipboard-first with a `content=` legacy fallback.
4. `startActivity(Intent(ACTION_VIEW, uri))`.
5. **Fallback:** `content=` in the URI (legacy mode) when clipboard mode is off or failed. No SAF write path and no size threshold — see Build Playbook D2/D18 and the G0 Spike A findings. If `content=` also fails, report the failure to Johan rather than saving by another route.

Johan's vault is on device storage, so a SAF fallback would be *possible* — but it is deliberately not used. Note that the original argument for this (SAF bypasses Obsidian's new-file triggers) does **not** hold: G0/A5 measured that `obsidian://new` bypasses Templater's on-create trigger too, so neither path fires it. The deferral rests on cost instead — `SafWriter` would reimplement append/overwrite that Obsidian gives us free, plus tree-URI permission plumbing to build and harden. Deferred, not deleted (Build Playbook D2/D18).

### In-app login (per Johan's answer)

The WebView has its own cookie jar, so paywalled and logged-in pages will not match what Chrome showed. Mitigations, all in Layer C:

- `CookieManager.setAcceptCookie(true)` + `setAcceptThirdPartyCookies`, `flush()` on pause — cookies persist across launches.
- Override the User-Agent: the WebView default contains `; wv`, which some sites block. Use a plain mobile Chrome UA.
- A "Sign in to this site" action that drops out of reader mode into the live page with normal browser chrome, so Johan can log in once per site.
- Graceful failure: if defuddle finds nothing usable, show the raw page and offer a bookmark-only clip (frontmatter + URL, no body).

## Repository layout

```
android/                          Gradle project (Kotlin, Compose, minSdk 31)
  app/src/main/
    java/…/share/ShareReceiverActivity.kt
    java/…/reader/ReaderActivity.kt, ClipperBridge.kt, ReaderWebViewClient.kt
    java/…/clip/ClipSheet.kt, ClipResult.kt
    java/…/save/SavePipeline.kt, ObsidianUri.kt     (SafWriter.kt deferred — D18)
    java/…/settings/                 vault name, reader prefs, templates
    assets/clipper-bundle.js         built artifact, committed
    assets/clipper.css
jsbridge/
  build.mjs                       esbuild: bundles Layer A + Layer B into one IIFE
  shim/browser.ts                 webextension-polyfill shim → Android bridge
  shim/storage.ts                 storage-utils shim → SharedPreferences via bridge
  shim/i18n.ts                    loads _locales/en/messages.json
  vendor/obsidian-clipper/        git submodule, pinned commit
docs/plan/
```

`build.mjs` mirrors `vendor/obsidian-clipper/scripts/build-api.mjs`: same `alias` mechanism, but pointing at our shims instead of `cli-stubs.ts`, `format: 'iife'`, exposing `window.__clipper = { Reader, Highlighter, clip, matchTemplate }`. Commit the built asset so an Android-only checkout builds without Node; a Gradle task regenerates it.

## Milestones

> **Superseded (2026-08-30):** the live milestone cut is in the [Build Playbook](<Android Web Clipper for Obsidian — Build Playbook.md>) — v1 = spike → reader → clip/save → templates; highlighter, reader settings and in-app login follow post-v1. The list below is kept as historical rationale.

**M0 — De-risking spike (do this first, ~1 day).** Two assumptions carry the whole design:
- ~~On-device: does Obsidian Android honour `obsidian://new?…&clipboard=true`?~~ **Answered 2026-08-31 (G0/A1+A2): yes.** The Android 12+ "pasted from clipboard" notification does appear and is not disruptive. Clipboard-first stands.
- In a bare WebView: load `clipper-bundle.js`, call `Reader.toggle(document)` on a real article, confirm screenshot 1's toolbar renders and is usable.

**M1 — Share to reader.** Share target, `ReaderActivity`, cookie/UA setup, bundle injection, reader mode. No clipping yet.

**M2 — Clip and save.** Wire `clip()`, native Compose clip sheet, `SavePipeline` with the fallback chain, vault setup screen.

**M3 — Highlighter.** Vendor `highlighter.ts` + `highlighter-overlays.ts`, back `storage-utils` with real persistence so highlights survive.

**M4 — Reader settings + templates.** Screenshot 2's font/width/theme controls (they are already in `ReaderSettings`); template import from `kepano/clipper-templates`; template management UI.

**M5 — Polish.** Bookmark-only fallback, error states, in-app login flow. (SAF hardening deferred — D18.)

## Licensing

Both `obsidianmd/obsidian-clipper` and `kepano/defuddle` are **MIT** — reuse, modification and redistribution are all permitted. Requirements:

- Retain both MIT notices in a `THIRD_PARTY_LICENSES` file shipped in the APK.
- License this project MIT (compatible, simplest).
- **Trademark carve-out:** the clipper's README excludes "trademarks, icons, marketing copy, and other marketing assets." The Obsidian gem in screenshot 1's toolbar is one of these — the vendored reader assets must have that icon replaced with our own before shipping, and the app must not be named or branded as an official Obsidian product. Lucide icons (the rest of the toolbar) are ISC, fine to ship. `highlight.js` is BSD-3, fine.

## Verification

- **M0 spike, on device:** `adb shell am start -a android.intent.action.VIEW -d "obsidian://new?vault=<vault>&file=Clippings/test&clipboard=true"` after seeding the clipboard, and confirm the note appears in Obsidian.
- **Share intent end-to-end:** `adb shell am start -a android.intent.action.SEND -t text/plain --es android.intent.extra.TEXT "https://stephango.com/obsidian" -n <pkg>/.share.ShareReceiverActivity`
- **Extraction regression:** run the bundle under `vitest` in `jsbridge/` against saved HTML fixtures (a news article, a YouTube page, a GitHub README, a paywalled page) and assert on `clip()` output — catches upstream drift after each submodule bump.
- **Reader in WebView:** `adb logcat` for JS console errors; visually confirm against screenshots 1 and 2.
- **Full manual pass per milestone:** share from Chrome, Firefox and the YouTube app; verify the note lands with correct frontmatter, and that a second clip of the same URL respects the template's overwrite/append behavior.