# Android Web Clipper for Obsidian — Build Playbook

This is the live, step-by-step guide from empty repo to finished app. It builds on the
[Implementation Plan](<Android Web Clipper for Obsidian — Implementation Plan.md>) (architecture and
rationale) and the [Initial Brief](<Android Web Clipper for Obsidian — Initial Brief.md>) (problem and
decision), and it **supersedes the plan's Milestones section**. The three `Obsidian Web Clipper UI - *.jpg`
screenshots are the UI reference throughout.

**Definition of done for v1:** Johan shares a link from any app on the Find N6 → the reader opens →
one tap opens the clip sheet → the note lands in the vault shaped by his template, with his usual vault
automations firing. Happy path well under 15 seconds.

## Pinned upstream (verified 2026-08-30)

| What | Pin | Notes |
|---|---|---|
| `obsidianmd/obsidian-clipper` | commit `9aa509b8f2801b08d974fb59f026df6f9a12e496` (main, 2026-08-03, "Bump deps") | MIT. **Not on npm** (registry returns 404) → consumed as git submodule. |
| `defuddle` | `0.19.3` (npm latest, published 2026-08-22) | MIT. Upstream declares `^0.19.2`, so 0.19.3 is compatible. `dist/index.full.js` is the self-contained UMD bundle. |

Bumping either pin follows the procedure in §14 — never casually.

---

## 0. How to use this playbook

- Work proceeds milestone by milestone; each milestone is a numbered task list plus an **acceptance
  checklist**. A milestone is done when every acceptance box is checked on the device.
- **`GATE` markers are stop points**: work pauses and Johan decides, with the options and trade-offs
  listed at the gate. Outcomes are recorded in §2 so later sessions don't re-litigate.
- This is a living document. Sessions executing a milestone check off tasks, record gate outcomes and
  measurements (e.g. the `content=` size limit from M0), and correct anything reality disproves.
- A fresh implementation session should read §1 (decisions), §2 (gate outcomes), §3 (upstream ground
  truth), and the milestone it is executing. The Implementation Plan is background reading.
- Expected effort: one milestone ≈ one to a few focused sessions. M0 is timeboxed to ~1 day.

## 1. Decisions log

Settled decisions. Items marked *(default)* were taken by Claude with Johan's standing option to veto;
everything else was decided by Johan explicitly.

| # | Decision | Rationale |
|---|---|---|
| D1 | Dedicated Android app, not a browser extension | Mobile browsers relay `obsidian://` unreliably; a first-class app fires the intent itself (Brief). |
| D2 | Save via `obsidian://new`, clipboard-first; `content=` and SAF as fallbacks | Lets Obsidian run its usual import triggers (Brief). Fallback order confirmed at G0. |
| D3 | Three-layer architecture: upstream clip engine (dependency) + vendored reader/highlighter + native Kotlin/Compose shell | See Implementation Plan §Architecture. |
| D4 | Reader (M1) before clip/save (M2) | Johan's call, 2026-08-30. The reading experience is part of the daily driver, not polish. |
| D5 | v1 = M0 + M1 + M2 + M3 (templates incl. import and URL auto-selection). Post-v1 order: highlighter → reader style settings → in-app login/polish | Johan's call, 2026-08-30. |
| D6 | Dev environment: Android Studio + physical device; **macOS and Windows are both first-class dev machines** | Johan's call. Hard constraint: Gradle wrapper + Node scripts only, no bash-only tooling. |
| D7 | Reference device: Oppo Find N6 — Android 16, ColorOS, foldable | Reader must work on cover and inner displays. |
| D8 | Highlighter (when it lands, M4) is in-session only — no cross-visit persistence | One-shot clip flow doesn't need the desktop extension's cross-visit storage. Flag to change. |
| D9 | Single configured vault in v1 *(default)* | Screenshot 3's vault dropdown becomes a settings value; multi-vault only if ever needed. |
| D10 | Clip sheet allows editing both properties and note body *(default)* | Matches desktop clipper. |
| D11 | `minSdk 31`, `targetSdk 36` | Sole target is the Find N6 on Android 16, so reach is irrelevant; 31 drops the `PendingIntent` mutability and pre-scoped-storage compat branches. Target current Android 16. |
| D12 | Sideload-only distribution *(default)* | Personal keystore; no Play Store steps anywhere in this playbook. |
| D13 | Bookmark-only fallback ships in M2, not polish *(default)* | Graceful failure is part of a trustworthy save pipeline. |
| D14 | Extraction regression harness starts in M1 *(default)* | Every submodule bump is guarded from the beginning. |
| D15 | Project license MIT; `THIRD_PARTY_LICENSES` shipped in APK; no Obsidian trademarks in shipped branding | See §17. |
| D16 | Templates are authored/edited in the desktop clipper and imported here as JSON *(default)* | v1 imports and selects templates; it does not include a template editor. |
| D17 | Track the current stable toolchain (AGP/Gradle/JDK) rather than pinning to an older one or shimming | Standard tools at their sanctioned versions beat local workarounds; migrations are cheapest taken early. Toolchain versions live in `android/gradle/libs.versions.toml`, `android/gradle/wrapper`, `android/gradle/gradle-daemon-jvm.properties` and `mise.toml`. |

## 2. Gate outcomes

Filled in as gates are passed. Empty = not reached.

| Gate | Question | Outcome | Date |
|---|---|---|---|
| G0 | Does `obsidian://new` + `&clipboard` work on the Find N6? What is the reliable `content=` size limit? Is the vendored reader viable in a WebView? | — | — |
| G1 | Is reader parity good enough to build on (vs. reworking Layer B)? | — | — |
| G2 | v1 ship review: app name + icon chosen; post-v1 order reconfirmed | — | — |

## 3. Ground truth: upstream integration points

Verified against the pinned commit on 2026-08-30 so future sessions have receipts without re-fetching.

**Layer A — clip engine.** `src/api.ts` exports `clip(options: ClipOptions): Promise<ClipResult>`,
`matchTemplate(templates, url, schemaOrgData?)`, `createSelectorProcessor(doc)`,
`createAsyncResolver(doc)`, plus the `Template`/`Property` types and a `DocumentParser` interface (the
seam where defuddle plugs in). Built by upstream's own `scripts/build-api.mjs`:

```text
esbuild src/api.ts → dist/api.mjs
  platform: neutral, format: esm
  external: defuddle, defuddle/full, dayjs
  alias:    webextension-polyfill → src/utils/cli-stubs.ts
  define:   DEBUG_MODE=false
```

That alias line is the pattern our whole shim strategy copies. `npm run build:api` runs it.

**Layer B — reader/highlighter.** `src/reader-script.ts` confirms the entire integration is
`Reader.toggle(document)` (from `src/utils/reader.ts`); an `obsidian-reader-active` class on
`documentElement` tracks state, and toggling off restores the page via reload. Companion modules:
`src/utils/highlighter.ts`, `src/utils/highlighter-overlays.ts` (both with upstream vitest tests we can
run), `src/core/reader-view.ts`, `src/managers/reader-settings.ts`, and — a gift for the video use case —
`src/utils/reader-transcript.ts` (YouTube transcripts in reader). Styles: `src/reader.scss`,
`src/highlighter.scss`, `src/styles/reader/*.scss` partials.

**Save recipe.** `src/utils/obsidian-note-creator.ts` builds URIs exactly as follows — mirror it, don't
improvise:

- `obsidian://new?file=<enc(folderPath + '/' + sanitizeFileName(noteName))>` — the `file` param carries
  the folder path; there is no separate folder param.
- Behavior flags from the template: `&append=true` | `&prepend=true` | `&overwrite=true`.
- `&vault=<enc(vaultName)>`; `&silent=true` if the silent-open setting is on.
- Clipboard mode: append **bare `&clipboard`** (no `=true`) *plus* `&content=<enc(short error message)>`
  — Obsidian reads the clipboard and shows `content` only if it can't.
- Legacy mode: `&content=<enc(full note)>`, no `&clipboard`.
- `append-daily` / `prepend-daily` behaviors use **`obsidian://daily?`** instead of `obsidian://new`.
- Note text is always `frontmatter + content` from the clip result.

**Upstream toolchain facts.** `npm test` = vitest; deps include `linkedom` (DOM for Node tests),
`dompurify`, `highlight.js`, `lucide`, `lz-string`, `dayjs`. All reusable for our harness and bundle.

## 4. Architecture recap and repository layout

```text
Share sheet (text/plain URL)
  → ShareReceiverActivity                       [M1]
  → ReaderActivity (WebView: persistent cookies, Chrome-mobile UA)
      → load URL → inject clipper-bundle.js     [M1]
      → Reader.toggle(document)                 [M1 — screenshot 1]
      → highlighter                             [M4]
      → reader style settings                   [M5 — screenshot 2]
  → "Clip" → JS bridge → clip({...})            [M2]
  → Compose clip sheet                          [M2/M3 — screenshot 3]
  → SavePipeline: clipboard → obsidian://new → content= → SAF   [M2]
```

**Shim strategy (refines the plan):** upstream already funnels every extension API through
`webextension-polyfill`, and its own `build-api.mjs` swaps that one module for stubs. We do the same with
one alias — `webextension-polyfill → jsbridge/shim/browser.ts` — implementing three capability areas:
`storage` (backed by SharedPreferences via the JS bridge), `i18n.getMessage` (backed by bundled
`src/_locales/en/messages.json`), and `runtime` messaging (an event bus to/from Kotlin:
`sendMessage` → `AndroidBridge.postMessage(json)`; Kotlin dispatches inbound events via
`evaluateJavascript`). Only if some module bypasses the polyfill do we add direct aliases for
`storage-utils`/`i18n` — treat that as plan B, discovered during M0/M1.

```text
android/                              Gradle project (Kotlin, Compose, minSdk 31, targetSdk 36)
  app/src/main/
    java/…/share/ShareReceiverActivity.kt
    java/…/reader/ReaderActivity.kt, ClipperBridge.kt, ReaderWebViewClient.kt
    java/…/clip/ClipSheet.kt, ClipResult.kt
    java/…/save/SavePipeline.kt, ObsidianUri.kt, SafWriter.kt
    java/…/settings/                  vault name, tree URI, prefs, template store
    assets/clipper-bundle.js          built artifact, committed
jsbridge/
  package.json, build.mjs             esbuild via Node API (node build.mjs — cross-platform)
  shim/browser.ts                     the webextension-polyfill replacement
  test/fixtures/*.html                saved pages + expected clip output
  test/*.test.ts                      vitest + linkedom
  vendor/obsidian-clipper/            git submodule @ pin
docs/plan/                            these documents
LICENSE, THIRD_PARTY_LICENSES, .gitignore, .gitattributes
```

---

## 5. Phase 0 — Environment & repo bootstrap

**Status (2026-08-30, repo-side done by Claude session):** P0.1 done (`.gitattributes` as below plus
`*.jar`/`*.webp` binary entries; `LICENSE` MIT added). P0.5 done — submodule added and pinned at
`9aa509b`; `jsbridge/` has deps installed (defuddle pinned exactly at 0.19.3; vitest 4 / esbuild 0.28 /
sass 1.103 / linkedom 0.18 / typescript 7) and a 3-test bootstrap suite passing via `npm test`
(scoped by `vitest.config.ts` so upstream's vendored tests don't run by accident — M1.7 wires those in
deliberately). §3's upstream receipts re-verified against the pinned checkout. P0.6 done — scaffold at
`android/` (package `it.slowmail.obsidianreader`, wrapper committed, Gradle 9.5.0 / AGP 9.3.2 /
Kotlin 2.2.21 / Compose BOM 2026.02.01, daemon toolchain JDK 25, configuration cache on), with the
M0 Spike A harness (§6) already wired as the main
screen so the first install can exercise A2/A3/A4 immediately. **Caveat:** the cloud session could not
run an Android build (`dl.google.com` blocked there — Kotlin sources syntax-checked with a standalone
compiler instead), so the first `gradlew assembleDebug` on a real machine is the actual build
verification; if a pinned androidx/AGP version fails to resolve, nudge it in
`android/gradle/libs.versions.toml`. Remaining (machine-side): P0.2 Android Studio, P0.3 phone setup,
P0.4 Node, then the acceptance list.

### Tasks

- **P0.1 — Git.** `git init`; `.gitignore` for Android Studio + Gradle + Node
  (`.gradle/`, `build/`, `local.properties`, `.idea/` except shared bits, `node_modules/`, `.DS_Store`);
  `.gitattributes` for cross-platform sanity:

  ```text
  * text=auto eol=lf
  *.bat text eol=crlf
  gradlew text eol=lf
  *.jpg -text
  *.png -text
  ```

- **P0.2 — Android Studio**, current stable, on the Mac now and the Windows machine when it enters the
  picture (nothing else in this playbook differs between them beyond what §14 lists). It bundles the JDK
  and SDK manager; install the Android 16 (API 36) platform + build tools when prompted.
- **P0.3 — Phone setup (Find N6 / ColorOS).** Settings → About device → Version → tap the build/version
  number 7× to unlock developer options (they appear under Settings → Additional settings). Enable
  **USB debugging** and **Install via USB**. ColorOS may nag about "monitoring" on each connection —
  accept once per machine. Verify with `adb devices` showing the device as `device`, not `unauthorized`.
  Windows note: if the device doesn't enumerate, install the OPPO USB driver (or the generic ADB driver
  via Windows Update) — macOS needs nothing.
- **P0.4 — Node LTS** (≥20) on the dev machine. Only required when rebuilding `clipper-bundle.js`; the
  committed artifact keeps Android-only checkouts fully buildable without Node.
- **P0.5 — Submodule + deps.**
  `git submodule add https://github.com/obsidianmd/obsidian-clipper jsbridge/vendor/obsidian-clipper`,
  then pin: `git -C jsbridge/vendor/obsidian-clipper checkout 9aa509b8f2801b08d974fb59f026df6f9a12e496`.
  In `jsbridge/`: `npm init -y`, `npm i -D esbuild sass vitest linkedom typescript` and
  `npm i defuddle@0.19.3 dayjs`.
- **P0.6 — App scaffold.** New Android Studio project: "Empty Activity" (Compose), Kotlin DSL, package
  `it.slowmail.obsidianreader` (final name at G2 — package id is internal and can stay regardless of
  branding), `minSdk 31`, `targetSdk 36`. Commit the wrapper (`gradlew` + `gradlew.bat`).

### Acceptance

- [ ] Scaffolded app builds from CLI (`./gradlew assembleDebug` / `gradlew.bat assembleDebug`) and from
  Android Studio, installs on the Find N6, and launches.
- [ ] `adb devices` works; `git status` clean on a fresh clone with submodule (`git clone --recursive`).
- [ ] `npm test` runs (trivial placeholder test) in `jsbridge/`.

## 6. M0 — De-risking spike (timeboxed ~1 day) — ends at GATE G0

Three spikes, throwaway code allowed, findings recorded in §2. These validate the two assumptions the
whole design stands on.

### Spike A — the save path, on the real phone

- **A1.** Manually copy a paragraph of text on the phone, then from the dev machine:

  ```bash
  adb shell "am start -a android.intent.action.VIEW -d 'obsidian://new?vault=VAULTNAME&file=Clippings/spike-a1&clipboard'"
  ```

  Confirm the note appears in Obsidian with the clipboard content. Note the Android 16 clipboard-access
  toast behavior.
- **A2.** Production-shaped variant: a scratch Compose button that does
  `ClipboardManager.setPrimaryClip(...)` then `startActivity(Intent(ACTION_VIEW, uri))` in the same tap.
  This is the exact sequence `SavePipeline` will use — if A1 passes but A2 fails (focus/timing), we need
  to know now.
- **A3.** Probe `content=` limits (legacy fallback): fire URIs with 2 KB / 16 KB / 64 KB / 128 KB bodies
  from the scratch activity until it breaks (binder transactions hard-fail around ~500 KB; the practical
  ceiling is what we measure). **Record the reliable maximum in §2.**
- **A4.** Verify `&append=true`, `&overwrite=true`, and `&silent=true` behave as documented against an
  existing note.
- **A5.** Confirm whatever vault automations Johan relies on (e.g. Templater folder templates) fire the
  same way they do for desktop-clipper notes.

### Spike B — the reader, in a bare WebView

- **B1.** First rough cut of `jsbridge/build.mjs`: esbuild via Node API, entry = a tiny
  `bundle-entry.ts` that imports `Reader` from the submodule and exposes
  `window.__clipper = { Reader }`; `format: 'iife'`; alias `webextension-polyfill` → a shim of
  hardcoded stubs (storage returns `{}`, `getMessage` returns the key, runtime messaging is a no-op).
  Bundle defuddle and dayjs in (no externals).
- **B2.** Determine how reader styles are delivered (does `Reader` inject its own `<style>`, or does the
  extension ship CSS separately?) and replicate: either import compiled SCSS as text into the bundle or
  load a `clipper.css` asset alongside. Record the answer in §2.
- **B3.** Scratch activity with a WebView (JS + DOM storage on, remote debugging on): load
  `https://stephango.com/vault`, run the bundle, call `__clipper.Reader.toggle(document)`. Confirm
  screenshot 1's toolbar renders and scrolling/TOC work. Inspect via `chrome://inspect` on the dev
  machine.
- **B4.** Same page through `defuddle` full bundle: eyeball markdown + metadata quality on 2–3 real
  pages (one news article, one YouTube page, one GitHub README).

### GATE G0 — decide with Johan

| Finding | Consequence |
|---|---|
| A1/A2 pass | Clipboard-first stays the primary save path (D2 confirmed). |
| Clipboard path fails | Primary becomes `content=` under the A3 limit, SAF above it; revisit D2. |
| B3 renders usable reader | Layer B proceeds as designed → M1. |
| B3 unusable/broken | Stop. Options: deeper shimming, or a native-lite reader (defuddle output in our own template) — decide before any M1 work. |

## 7. M1 — Share → Reader (v1)

### Tasks

- **M1.1 — Share target.** `ShareReceiverActivity` with an intent filter for `ACTION_SEND` +
  `text/plain`. Extract the first `http(s)` URL from `EXTRA_TEXT` (apps commonly share `"Title\nURL"`;
  the YouTube app shares title + short link). Keep `EXTRA_SUBJECT` as a title hint. No URL found →
  polite toast, finish.
- **M1.2 — ReaderActivity + WebView config.** JS on, DOM storage on; `CookieManager`: accept cookies +
  third-party for the WebView, `flush()` in `onPause` (login sessions survive relaunch);
  User-Agent = current Chrome-mobile string with no `; wv` token (constant, overridable in settings
  later); `WebView.setWebContentsDebuggingEnabled(true)` in debug builds. Loading and error states
  (offline, HTTP errors) with retry.
- **M1.3 — Production shim.** Replace B1's hardcoded stubs with the real `shim/browser.ts` per §4:
  bridge-backed `storage`, JSON-backed `i18n`, event-bus `runtime`. Kotlin side: a
  `@JavascriptInterface` object (`AndroidBridge`) with `getItem/setItem` (SharedPreferences) and
  `postMessage` (events up), plus an `evaluateJavascript` dispatcher (events down).
- **M1.4 — Production bundle.** `build.mjs` final form: SCSS compiled (per B2's answer), lucide icons
  in, sourcemaps in debug, output committed to `android/app/src/main/assets/clipper-bundle.js`. Add
  `npm run build` and `npm run verify` (rebuild + `git diff --exit-code` on the asset).
- **M1.5 — Trademark sweep.** Replace the Obsidian gem icon in the vendored toolbar with a placeholder
  (final icon at G2). Grep vendored assets for other Obsidian marks. Lucide icons stay (ISC).
- **M1.6 — Injection.** On `onPageFinished`: inject bundle (idempotent — upstream already guards with
  `obsidianReaderInitialized`), settle briefly (rAF + short delay for SPA hydration), then
  `Reader.toggle(document)`. Provide a "re-extract" action for pages that hydrate late. Toolbar buttons
  whose milestones haven't arrived (pen → M4, Aa → M5) are hidden or no-op with a "coming later" toast —
  decide which looks less broken when wiring.
- **M1.7 — Fixture harness.** `jsbridge/test/`: save 4–5 fixture pages (news article, YouTube watch
  page, GitHub README, stephango post, one known-hostile page), run extraction under vitest + linkedom,
  snapshot the output. Also wire upstream's own `highlighter.test.ts` / `highlighter-overlays.test.ts`
  to run against our bundle config — they guard M4 in advance.
- **M1.8 — Foldable pass.** Reader on cover screen, on inner screen, and across a fold/unfold
  mid-article (activity recreation must not lose the page or the reader state — re-toggling on recreate
  is acceptable if it's not visually jarring).

### Acceptance

- [ ] Sharing from Chrome, Firefox, and the YouTube app opens the reader on the shared page.
- [ ] Reader matches screenshot 1: typography, TOC button works, toolbar present (unbuilt buttons
  handled per M1.6), no Obsidian gem icon.
- [ ] YouTube watch page shows the transcript in reader when available (upstream `reader-transcript.ts`).
- [ ] Cookies persist across app relaunches (visit a login-walled site, relaunch, still signed in).
- [ ] Fixture suite green; `npm run verify` proves the committed bundle matches sources.
- [ ] Foldable pass (M1.8) holds.
- [ ] **GATE G1:** Johan reads a few real articles and rules the reader good enough to build on.

## 8. M2 — Clip & Save (v1)

### Tasks

- **M2.1 — ClipperBridge.** JS side gathers `{ html: documentElement.outerHTML, url, schemaOrgData }`
  and calls `clip()` (Layer A) with the live document as parser input, exactly per `ClipOptions` in
  `src/api.ts`; result (`ClipResult`: note name, frontmatter, content, properties) crosses to Kotlin as
  JSON via `AndroidBridge.postMessage`. Expose upstream's `sanitizeFileName` on the bundle so Kotlin
  never reimplements it.
- **M2.2 — Clip sheet (screenshot 3).** Compose `ModalBottomSheet`: template dropdown (default-only
  until M3), editable note name, editable typed properties list (text/list/date icons per screenshot),
  editable body (D10), folder field (defaulted from settings), "Add to Obsidian" button. Vault label
  from settings (D9).
- **M2.3 — SavePipeline.** Kotlin port of the §3 save recipe, in order: (1) compose
  `frontmatter + content`; (2) `ClipboardManager.setPrimaryClip` (plain, not sensitive-flagged);
  (3) build `obsidian://new` URI — `file` = folder + sanitized name, behavior flags, `vault`, optional
  `silent`, bare `&clipboard` + short-error `content=`; (4) `startActivity`. Fallbacks: full
  `content=` when note ≤ the A3 limit and clipboard mode is off/failed; SAF write above it.
- **M2.4 — SafWriter + setup screen.** First-run setup: pick vault folder via
  `ACTION_OPEN_DOCUMENT_TREE`, `takePersistableUriPermission`, prefill vault name from the tree's folder
  name (editable — must match Obsidian's vault name exactly), default folder ("Clippings"), silent-open
  toggle. `SafWriter` implements create/overwrite/append via `DocumentFile` (append = read + concat +
  rewrite), optional `obsidian://open` after a SAF save.
- **M2.5 — Bookmark-only fallback (D13).** When extraction yields nothing usable, offer a one-tap
  bookmark clip: frontmatter (title, source, created, tags) + URL, no body. Also reachable explicitly
  from the reader menu ("Clip as bookmark").
- **M2.6 — Fixtures for clip output.** Extend M1.7: assert full `clip()` output (frontmatter + body)
  against expected `.md` files per fixture.

### Acceptance

- [ ] Article, YouTube page, and extraction-hostile page all land in the vault correctly (the last as a
  bookmark note).
- [ ] Note name, folder, properties, and body edits in the sheet are reflected in the saved note.
- [ ] Re-clipping the same URL respects the template behavior (A4 semantics).
- [ ] A note larger than the A3 limit saves via the clipboard path; with clipboard artificially
  disabled it saves via SAF and appears in Obsidian.
- [ ] Vault automations fire (A5 re-check with real clips).
- [ ] Second clip started from the share sheet while Obsidian is foregrounded works (round-trip focus).

## 9. M3 — Templates (v1)

### Tasks

- **M3.1 — Template store.** Templates as JSON files in app storage, schema = upstream `Template` type
  (same shape the desktop clipper exports). Bundle a default template replicating screenshot 3's
  properties (title, source, author, published, created, description, tags).
- **M3.2 — Import.** SAF file picker (multi-select) + paste-JSON, validating against the `Template`
  shape. Reuse upstream import/validation code if the bundle can expose it; otherwise validate
  minimally and let `clip()` be the real arbiter. Templates from `kepano/clipper-templates` import the
  same way (they're the same JSON).
- **M3.3 — Auto-selection.** On page load, run `matchTemplate(templates, url, schemaOrgData)` and
  preselect in the clip sheet; manual override via the dropdown always wins.
- **M3.4 — Management UI.** Settings screen: list, set default, delete, read-only inspect. No editor
  (D16 — author on desktop, export, import here).
- **M3.5 — Daily-note behaviors.** `append-daily`/`prepend-daily` route to `obsidian://daily?` per §3;
  test with a template that uses them.

### Acceptance

- [ ] Johan's real desktop templates import cleanly and auto-select on their trigger URLs.
- [ ] A YouTube link picks the video template (if imported); unknown sites fall back to default.
- [ ] Template filters/variables produce identical output to desktop for one shared test page (compare
  the two notes).
- [ ] **v1 is now feature-complete → §10.**

## 10. v1 release checklist — includes GATE G2

- [ ] **GATE G2 (Johan):** choose app name + icon — must not read as an official Obsidian product and
  must not use Obsidian's gem or wordmark (§17); reconfirm post-v1 order (D5).
- [ ] Swap M1.5's placeholder for the real icon; set `applicationId`, app label, versionName `1.0`.
- [ ] `THIRD_PARTY_LICENSES` assembled per §17 and shipped in the APK (viewable from settings).
- [ ] Release keystore generated and backed up; signing config reads credentials from
  `local.properties`/env so it works identically on macOS and Windows.
- [ ] R8/proguard: keep rules for `@JavascriptInterface` members; release build tested on device —
  share → clip → note in vault.
- [ ] Tag `v1.0.0`; keep the APK somewhere retrievable (GitHub release on a private repo is fine).

## 11. M4 — Highlighter (post-v1)

- **M4.1** Enable the toolbar pen; verify `highlighter.ts` + `highlighter-overlays.ts` behave in the
  WebView (they're already in the bundle and their upstream tests already run — M1.7).
- **M4.2** Storage shim policy per D8: highlights live in-memory per reader session, cleared on exit.
- **M4.3** Wire highlights into `clip()` so the template's highlights variable populates the note;
  verify against a fixture.
- **M4.4** Acceptance: highlight three passages on the Find N6 (touch selection, both displays), clip,
  see them in the note; leaving the reader discards them (D8).

## 12. M5 — Reader style settings (post-v1)

- **M5.1** Enable the Aa button; screenshot 2's sheet is upstream UI (`reader-settings.ts`) — it should
  work once `storage` round-trips through SharedPreferences. Verify font size/width/spacing/theme
  apply and persist across sessions.
- **M5.2** Theme interplay: reader dark/light/auto vs. the app's own theme and Android's algorithmic
  darkening (keep darkening off for the reader WebView; the reader owns its colors).
- **M5.3** Acceptance: set a non-default style, kill the app, share a new link — style stuck.

## 13. M6 — In-app login & polish (post-v1)

- **M6.1** "Open original page" action: exits reader into normal browsing (visible URL bar strip,
  back/forward), user logs in, "back to reader" re-extracts. Cookies already persist (M1.2), so this is
  once per site.
- **M6.2** Error-state pass: offline, timeouts, HTTP errors, extraction failures — every path ends in
  either a usable reader, a bookmark offer, or a clear retry.
- **M6.3** SAF hardening: detect revoked/moved tree permission and re-prompt instead of failing silently.
- **M6.4** Share-without-URL (plain text selection shared to the app): offer a quick-note clip into the
  vault. Nice-to-have; drop if it drags.
- **M6.5** Settings export/import (templates + prefs as one JSON) for phone migration.
- **M6.6** Submodule bump rehearsal: run §14's procedure once end-to-end and fix whatever chafes.

## 14. Cross-cutting engineering notes

**macOS/Windows parity (D6).** Everything invoked cross-platform: Gradle via wrapper, JS via
`node build.mjs` / npm scripts (esbuild's JS API — no shell scripting inside), no symlinks, no
case-only filename distinctions. `.gitattributes` from P0.1 handles line endings; on Windows also
`git config core.longpaths true` before cloning (deep submodule paths). Android builds never require
Node (committed bundle); touching `jsbridge/` requires running `npm run build` and committing the
asset in the same commit — `npm run verify` is the honesty check.

**Submodule bump procedure.** (1) Read upstream diff since the pin, especially `src/utils/reader*`,
`highlighter*`, `api.ts`, `obsidian-note-creator.ts`, `build-api.mjs`; (2) bump the pinned commit;
(3) `npm run build`; (4) `npm test` — fixture snapshots catch extraction drift, upstream's highlighter
tests catch Layer B drift; (5) manual smoke: share → read → clip on device; (6) commit submodule ref +
rebuilt bundle together, noting the new pin in §Pinned upstream.

**WebView debugging.** `setWebContentsDebuggingEnabled(true)` (debug builds) + `chrome://inspect` on
the dev machine gives full DevTools against the phone — the primary tool for all Layer B work.
`adb logcat -s chromium` catches JS console output in a pinch.

**Foldable matrix (D7).** Test grid for anything touching the reader: cover screen portrait, inner
screen, fold/unfold mid-session, split-screen with Obsidian (share from a split browser is a realistic
flow). Compose handles resizing; the WebView must reflow without losing scroll position badly.

**ColorOS notes.** Dev options per P0.3. ColorOS's aggressive background management is irrelevant here
(everything is foreground), but its share sheet may bury the app initially — pinning the app in the
share sheet is a Johan-side one-time step. If the share target ever stops appearing after an OS update,
check ColorOS's "recommended sharing" settings first.

## 15. Risk register

| Risk | Mitigation | Retired by |
|---|---|---|
| Android/ColorOS blocks the clipboard handoff to Obsidian | Measured fallbacks: `content=` under the A3 limit, SAF above | G0 |
| Vendored reader breaks or fights the WebView | Timeboxed spike before any investment; native-lite fallback named at G0 | G0/G1 |
| Upstream drift breaks extraction or highlighter on bump | Pinned submodule; fixture snapshots + upstream tests in our harness; §14 procedure | M1.7 onward |
| Sites block the WebView UA or bot-detect | Chrome-mobile UA (M1.2), cookie persistence, login flow (M6.1), bookmark fallback (M2.5) | M2/M6 |
| SPA/JS-heavy pages extract poorly | Settle delay + re-extract action (M1.6), bookmark fallback | M1/M2 |
| Intent URI size limits truncate `content=` saves | A3 measurement; clipboard-first; SAF above limit | M0/M2 |
| Windows dev friction (paths, EOL, drivers) | §14 parity rules, P0.1 gitattributes, P0.3 driver note | Phase 0 |
| Obsidian changes `obsidian://` behavior | Recipe isolated in `ObsidianUri.kt` + §3 documents the contract; SAF path is Obsidian-independent | — |

## 16. UI inventory — every visible element has one owner

| Element (screenshot) | Owner |
|---|---|
| Reader typography, layout, TOC button (1) | M1 |
| Highlighter pen button (1) | M4 |
| Copy/save popup button (1) | Renders M1; copy action M2 (Kotlin clipboard); save-as-file M6 |
| Aa reader-style button (1) + style sheet (2) | M5 |
| Clipper button — gem replaced (1) → clip sheet (3) | M2 |
| Template dropdown w/ auto-select (3) | M3 |
| Properties editor, body editor, note name (3) | M2 |
| Vault selector (3) | Settings value (D9), shown in sheet M2 |
| Folder field (3) | M2 |
| "Add to Obsidian" (3) | M2 |

## 17. Licensing & branding

Ours: **MIT** (`LICENSE` at repo root). Shipped third-party notices (`THIRD_PARTY_LICENSES`):

| Component | License | Shipped? |
|---|---|---|
| obsidian-clipper (vendored reader/highlighter + api) | MIT | Yes |
| defuddle | MIT | Yes |
| dayjs, lz-string | MIT | Yes |
| dompurify | Apache-2.0 OR MPL-2.0 → use Apache-2.0 notice | Yes |
| highlight.js | BSD-3-Clause | Yes |
| lucide | ISC | Yes |
| webextension-polyfill | MPL-2.0 | **No — replaced by our shim; keep it that way** |
| linkedom, vitest, esbuild, sass | ISC/MIT | Dev-only, not shipped |

**Trademark carve-out** (upstream README excludes trademarks/icons/marketing from the MIT grant): the
Obsidian gem icon is swept out of vendored assets in M1.5; the shipped app name, icon, and store-free
presence must not present as an official Obsidian product (G2 decision). Naming the *repo*
`obsidian-reader` is fine; the shipped label is what matters.
