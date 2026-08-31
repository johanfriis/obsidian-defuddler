# Android Web Clipper for Obsidian — Build Playbook

This is the live, step-by-step guide from empty repo to finished app, and **the authoritative document**
— milestones, acceptance criteria, decisions, the save recipe and the dev loop all live here. Two
companions hold what this one deliberately does not:

- [Architecture & Rationale](<Android Web Clipper for Obsidian — Architecture & Rationale.md>) — the
  *why* behind the three-layer design and what upstream actually ships.
- [Problem & UI Reference](<Android Web Clipper for Obsidian — Problem & UI Reference.md>) — the problem
  statement, the scope guard, and the **legend for the three `Obsidian Web Clipper UI - *.jpg`
  screenshots** referenced throughout this document (see §16).

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
  truth), and the milestone it is executing. Architecture & Rationale is background reading; Problem &
  UI Reference is where every "screenshot N" reference resolves.
- **Where things stand (2026-08-31): M0 is complete and GATE G0 is closed, passed.** Phase 0 done;
  Spikes A and B both pass on the Find N6; both G0 trade-offs signed off (D20 inline CSS, D21 Trusted
  Types); B4 folded into M1.7 per D22. §2's findings correct several earlier assumptions, including
  one carried since the original brief (now Problem & UI Reference) — read them before M1, especially
  the M1.6 settle-time finding, which invalidates the "short delay" that task currently specifies.
  **Resume at M1 (§7).** Read §5's status block first for the `just`-based dev loop, which post-dates
  the original text of this playbook.
- Expected effort: one milestone ≈ one to a few focused sessions. M0 is timeboxed to ~1 day.

## 1. Decisions log

Settled decisions. Items marked *(default)* were taken by Claude with Johan's standing option to veto;
everything else was decided by Johan explicitly.

| # | Decision | Rationale |
|---|---|---|
| D1 | Dedicated Android app, not a browser extension | Mobile browsers relay `obsidian://` unreliably; a first-class app fires the intent itself (Brief). |
| D2 | Save via `obsidian://new`, clipboard-first, with `content=` as the only fallback. No SAF write path. On failure, tell Johan — never save by another route | **Rationale corrected at G0/A5 (2026-08-31).** The Brief's premise — that the URI lets Obsidian run its usual import triggers — is measurably false: Templater's on-create trigger does *not* fire for notes created via `obsidian://new`. The decision stands on what survives: no tree-URI plumbing to build or harden, Obsidian implements dedup/append/overwrite for us, and the note enters Obsidian's index immediately. Failure is reported rather than rerouted, because a save that silently takes a different path is worse than a visible error. |
| D3 | Three-layer architecture: upstream clip engine (dependency) + vendored reader/highlighter + native Kotlin/Compose shell | See [Architecture & Rationale](<Android Web Clipper for Obsidian — Architecture & Rationale.md>). |
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
| D18 | `SafWriter` (M2.4) and SAF hardening (M6.3) deferred, not deleted | Follows from D2: with no SAF save path there is nothing to write or harden. **The original justification (SAF bypasses Obsidian's triggers) turned out not to separate the two options — A5 showed `obsidian://` bypasses them too.** What the deferral now rests on is cost: `SafWriter` reimplements append/overwrite that Obsidian gives us free, plus tree-URI permission plumbing to build and harden. Two accepted trades: (1) `obsidian://` always foregrounds Obsidian (A4) — SAF would have allowed a true background save; (2) the URI contract is now a single point of failure — acceptable because notes are plain markdown in a folder Johan controls, so recovery is manual but never data-loss. |
| D19 | Bundle English UI strings only (`LOCALES = ['en']`) and highlight.js's ~40-language `lib/common` rather than the full ~190 | Johan's call, 2026-08-31, confirming the B1 trims. Both degrade gracefully — `getMessage` falls back to English, `highlightElement` leaves an unregistered language unstyled — and both are one-line reverts in `jsbridge/build.mjs`. |
| D20 | Reader CSS is delivered as an inline `<style>` by default, not upstream's blob-URL `<link>` — for `reader.css` and `highlighter.css` alike | Johan's call, 2026-08-31 at G0. Measured: the blob path is refused by any page with a `style-src` that omits `blob:` (github.com), leaving the reader stripped and unstyled. Inlining costs nothing on pages without CSP, and detecting a refusal in order to fall back is harder than always inlining. Implemented without patching upstream — see `installStyle` in `jsbridge/src/bundle-entry.ts`. |
| D23 | **No generic browser UI, ever.** No URL bar, no back/forward, no tabs, history or downloads. If a page cannot be read without signing in, that is a workaround Johan performs outside the app — or the clip does not happen | Johan's call, 2026-08-31, when the question of pulling M6.1's browsing strip into M1 was raised. He clips from logged-in sites rarely, and a browser surface is far larger than it looks (tabs, downloads, uploads, fullscreen video, permission prompts, PDFs). This bounds M6.1 and overrides the "normal browser chrome" mitigation the Architecture doc used to propose. |
| D21 | Install a pass-through Trusted Types `default` policy before the reader runs | Johan's call, 2026-08-31 at G0. Without it, pages sending `require-trusted-types-for 'script'` (YouTube) kill the reader outright — Defuddle's `innerHTML` and `Reader.apply`'s `DOMParser` both throw and nothing renders. A browser extension never meets this because its content script runs in an isolated world Trusted Types does not police; our main-world injection is policed. **The accepted trade:** the policy switches off the page's own XSS guard for the life of that document. Johan's reasoning — the reader/clip session is ephemeral, the page is one he chose, and we already inject a bundle that rewrites the whole DOM. Only creatable where the page sends no `trusted-types` directive naming allowed policies; where it is refused we log and the page fails visibly. See `installTrustedTypesPolicy` in `jsbridge/src/bundle-entry.ts`. |
| D22 | B4's extraction-quality pass is folded into M1.7's fixture harness rather than run as a throwaway spike *(default)* | B3 already exercised extraction on four real pages including the two hard ones (CSP-strict, Trusted Types), so B4's remaining value is markdown/metadata quality on saved fixtures — which is exactly M1.7's job. Same work, but the output is kept and guards every future submodule bump (D14). M0 therefore ends at G0. Two B3 findings carry into M1.7 as fixture cases: unflattened shadow DOM on github, and the YouTube settle-time question. |
| D17 | Track the current stable toolchain (AGP/Gradle/JDK) rather than pinning to an older one or shimming | Standard tools at their sanctioned versions beat local workarounds; migrations are cheapest taken early. Toolchain versions live in `android/gradle/libs.versions.toml`, `android/gradle/wrapper`, `android/gradle/gradle-daemon-jvm.properties` and `mise.toml`. |

## 2. Gate outcomes

Filled in as gates are passed. Empty = not reached.

| Gate | Question | Outcome | Date |
|---|---|---|---|
| G0 | Does `obsidian://new` + `&clipboard` work on the Find N6? What is the reliable `content=` size limit? Is the vendored reader viable in a WebView? | **CLOSED — passed.** Spikes A and B both pass; the reader renders on all four test pages. Both trade-offs signed off by Johan → D20 (inline CSS) and D21 (Trusted Types). M0 ends here per D22. **Next: M1.** | A: 2026-08-31, B: 2026-08-31, closed: 2026-08-31 |
| G1 | Is reader parity good enough to build on (vs. reworking Layer B)? | — | — |
| G2 | v1 ship review: app name + icon chosen; post-v1 order reconfirmed | — | — |

### G0 / Spike A findings — 2026-08-31, Find N6 (CPH2765), Android 16 / API 36, vault `Sanctum`

- **A1 pass.** `obsidian://new?vault=…&file=…&clipboard` created the note with the clipboard content.
  The Android 12+ "pasted from clipboard" notification does appear; it is not disruptive.
- **A2 pass.** The production-shaped sequence — `setPrimaryClip` then `startActivity` in the same tap —
  works. No focus/timing problem, so D2's clipboard-first path is confirmed end to end.
- **A3 — no practical size ceiling.** `content=` bodies of 2 / 16 / 64 / 128 / 512 KB all landed with
  byte counts matching the payload exactly (no truncation at any size). 1024 KB fails, and fails
  *loudly*: `startActivity` throws and is caught, no note is written, nothing is silently truncated.
  Percent-encoding inflates the body roughly **2.7×** on the way into the parcel, so what hits the
  ~1 MB binder limit is the encoded URI, not the markdown. For scale, 512 KB of markdown is ~80,000
  words; a long feature article is 30–60 KB. **Consequence: no threshold constant.** `SavePipeline`
  tries `content=` and catches, rather than branching on a measured maximum (M2.3).
- **Default behaviour is de-duplicate, not overwrite.** Firing the same `file=` twice yields
  `note 1.md` alongside `note.md`. A4's `overwrite=true` is what changes this.
- **Landmine found, applies to M2.** The spike harness kept the full encoded URI in a
  `rememberSaveable`; at 512 KB that is ~1.4 MB of saved instance state and the activity died with
  `TransactionTooLargeException` in `PendingTransactionActions$StopInfo.run` *after* the note had
  already saved — a crash that looks like a save failure but is not. **Note content must never enter
  saved instance state** in `ReaderActivity`/`SavePipeline`, at any size.
- **Only `md.obsidian` claims the `obsidian://` scheme** on this device, so there is no chooser dialog
  to defeat the silent path.
- **A4 pass, all four behaviours.** Default de-duplicates (`note 1.md` beside `note.md`);
  `overwrite=true` replaces in place; `append=true` extends the existing note; `silent=true` creates the
  note without navigating to it. **`silent` does not mean "without foregrounding Obsidian"** — it
  suppresses opening the new note, nothing more.
- **Any `obsidian://` save foregrounds Obsidian.** There is no variant of this path that saves in the
  background. Accepted by Johan; recorded so M2 does not rediscover it.
- **A5 — the Brief's central premise is false.** Templater's on-create trigger does **not** fire for
  notes created via `obsidian://new`. The Brief preferred the URI over a direct vault write precisely
  because it was assumed to "let Obsidian run its usual import triggers"; it does not. This does not
  favour SAF either — a SAF write bypasses them equally — so it is not a reason to switch, but D2 and
  D18 have been re-argued on honest grounds. **Open question, owned by nothing yet: no save mechanism
  considered so far fires Templater. If trigger-firing ever becomes a real requirement it needs a
  different mechanism entirely, not a different write path.** Johan is content without it for v1.

### G0 / Spike B findings — 2026-08-31 (B1, B2 — build-machine only; B3 still to run on device)

- **B1 pass. The one-alias shim strategy holds.** `webextension-polyfill` is imported from exactly one
  place in the vendored tree (`src/utils/browser-polyfill.ts`), so aliasing that single specifier to
  `jsbridge/shim/browser.ts` covers every `browser.*` call. Plan B from §4 (direct aliases for
  `storage-utils`/`i18n`) is **not needed** — nothing bypasses the polyfill.
- **B2 answered without a spike — the reader does *not* inline its own CSS.** Upstream compiles
  `src/reader.scss` and `src/highlighter.scss` as separate webpack entries into standalone
  `reader.css` / `highlighter.css`, ships them as web-accessible resources, and injects them at
  runtime via `browser.runtime.getURL('reader.css')` into a `<link>` (`utils/reader.ts` ~L2098;
  highlighter.css ~L2486). **Nothing imports them, so esbuild alone would silently miss them** and the
  reader would render unstyled. `build.mjs` therefore compiles both with `sass` and embeds them, and
  the shim's `runtime.getURL` hands them back as blob URLs. A test asserts the CSS is really there,
  because the failure mode is silent.
  - `runtime.getURL` is consequently **load-bearing from the first toggle**, not an M1.3 nicety. Same
    for `flatten-shadow-dom.js`, which `utils/flatten-shadow-dom.ts` injects as a `<script>` on pages
    that use shadow roots. Both are embedded in the bundle.
- **i18n resolves through our shim, not upstream's loader — and that is fine.** Upstream `getMessage`
  first tries `require(\`../_locales/${lang}/messages.json\`)`; esbuild resolves that template as a glob
  and bundles *every* language. Its own `catch` falls through to `browser.i18n.getMessage`, i.e. to
  our shim, so the shim implements substitutions and placeholders properly against the bundled
  `en/messages.json` rather than echoing message keys.
- **Bundle size is on the critical path for B3, not a later optimisation.** Untrimmed the bundle is
  3.3 MB minified / 14 MB with inline sourcemaps — large enough that *how* Kotlin injects it becomes a
  design question. Two trims in `build.mjs`, both graceful degradations, bring prod to 1.2 MB and the
  committed debug artifact to 2.0 MB:
  - `LOCALES = ['en']` — drops ~1 MB of other languages; `getMessage` falls back to English for
    anything unbundled.
  - `HLJS = 'highlight.js/lib/common'` — ~40 mainstream languages instead of ~190, saving ~700 KB.
    `hljs.highlightElement` leaves an unregistered language unstyled rather than throwing.
  - **Both confirmed by Johan 2026-08-31 → D19.**
- **Where the remaining 1.2 MB actually is** (prod, measured from the esbuild metafile): defuddle
  740 KB, upstream+ours 191 KB, highlight.js 160 KB, dayjs 62 KB, dompurify 29 KB, en locale 22 KB.
  **Splitting the bundle into async-loaded chunks was considered and rejected** (2026-08-31): defuddle
  is 61% of the payload and is needed synchronously the moment the reader toggles, so the only real
  deferral candidate is highlight.js at 13%. Against that: the asset is local (no network to overlap),
  esbuild's code splitting requires ESM — which needs script tags or `import()`, both CSP-subject and
  resolved relative to the *page's* origin — and deferring hljs means patching upstream's static
  `import hljs` and its synchronous `highlightElement` call sites, which §14's bump procedure would
  pay for on every submodule bump. One bundle injected via `evaluateJavascript` also keeps the JS
  entirely out of CSP's reach. Revisit only if B3 shows `evaluateJavascript` failing on ~2 MB, and
  then prefer `WebViewAssetLoader` over splitting.
- **Inline sourcemaps are opt-in** (`npm run build:debug`), because they triple the artifact. The
  committed bundle is unminified with `DEBUG_MODE` on, which reads fine in `chrome://inspect` unaided.
- **Named ahead of B3 — page CSP is the live risk.** The reader strips the page's own stylesheets
  (`utils/reader.ts` ~L2084) and injects its own. An extension bypasses page CSP; **a WebView
  injection does not**, so a `style-src`-strict site could leave the reader with content stripped and
  no styles — the worst-looking possible failure. B3 must test a strict-CSP page (github.com)
  alongside `stephango.com/vault`. If it bites, the mitigation is stripping CSP response headers in
  `shouldInterceptRequest`; that is an M1.2 concern, not a reason to redesign Layer B.
- **`android/app/src/main/AndroidManifest.xml` has no `INTERNET` permission.** Spike A never needed
  one. B3 adds it or the WebView loads nothing.

### G0 / Spike B3 findings — 2026-08-31, Find N6 (CPH2765), cover display, Android 16

Harness: `spike/SpikeBActivity.kt` (throwaway). It mirrors its log to logcat (`just log`, or
`adb logcat -s SpikeB`), which is where the full probe JSON is readable — the on-screen pane
ellipsizes.

- **B3 pass. The reader renders in a bare WebView**, on stephango.com, github.com, apnews.com and a
  YouTube watch page. Screenshot 1's toolbar is present and correct (TOC, pen, paperclip, Aa, and the
  Obsidian gem that M1.5 must replace). Layer B proceeds as designed.
- **`evaluateJavascript` handles the ~2 MB bundle comfortably** — 42–222 ms per injection across all
  pages, no failures. **The injection question is closed: no `WebViewAssetLoader`, no chunking, no
  externals.** Reading the asset off disk is ~20–40 ms, done once. This also means the *JavaScript* is
  entirely out of CSP's reach, since `evaluateJavascript` is neither a script element nor a
  page-initiated `eval` — only the reader's own injected sub-resources are policed.
- **Page CSP blocks the reader's stylesheet, exactly as predicted.** On github.com
  (`style-src 'unsafe-inline' github.githubassets.com`, no `blob:`) the console shows *"Loading the
  stylesheet 'blob:…' violates …"*, and the probe reports `htmlBg: rgba(0, 0, 0, 0)` — the page's own
  styles stripped and nothing to replace them. On stephango/apnews (no CSP) the same path gives
  `htmlBg: rgb(255, 255, 255)` and `reader.css rules=331`.
- **The inline-CSS path fixes it, with no patching of upstream.** `toggle('inline')` pre-installs
  reader.css as `<style id="obsidian-reader-styles">`; upstream's strip pass preserves that id and its
  own `<link>` is only created when no such element exists, so it skips the blob path by itself. On
  github the probe then reports `readerStyleTag: STYLE(63384)`, `htmlBg: rgb(255, 255, 255)` and
  `<inline> rules=331` — an identical rule count to the blob path elsewhere. **Recommendation: make
  `inline` the default in M1** rather than a fallback; it costs nothing on pages without CSP.
- **Trusted Types — a second CSP-family blocker, not previously on the radar.** YouTube sends
  `require-trusted-types-for 'script'`. Without a policy the reader dies outright: *"Defuddle Error in
  async extraction: Failed to set the 'innerHTML' property"* and *"Reader Error during apply: Failed
  to execute 'parseFromString' on 'DOMParser'"*, with `toolbar: false` — nothing renders. An extension
  never meets this because its content script runs in an isolated world that Trusted Types does not
  police; our main-world injection is policed. `installTrustedTypesPolicy()` (bundle-entry.ts) creates
  a pass-through `default` policy, which YouTube permits because it sends no `trusted-types` directive
  naming allowed policies. With it, YouTube renders fully — title, author, date, player.
- **`highlighter.css` now inlines too (D20), verified on device.** `Reader.ensureHighlighterCSS`
  guards on `obsidian-highlighter-stylesheet` exactly as the reader guards on its own id, so the same
  `installStyle` call covers it. Re-run on github: `links: []`, `sheets: ["<inline> rules=331",
  "<inline> rules=39"]` — **no CSS is refused on a CSP-strict page any more.** Done ahead of M4 so the
  highlighter is not the one thing still broken when the pen is turned on.
- **Still blocked on github:** `flatten-shadow-dom.js` is refused by `script-src` and there is no
  equivalent trick — it must be a `<script>` the page executes. Upstream's `script.onerror` resolves
  the promise, so it degrades rather than hangs, but shadow-DOM pages will not be flattened, which may
  cost extraction quality. Carried into M1.7's fixtures per D22.
- **The YouTube transcript works — but extraction timing decides whether it is there.** Measured by
  varying the settle between page load and toggle, everything else identical:

  | settle | transcript |
  |---|---|
  | 6 s | absent |
  | 15 s | heading + 2144 chars |
  | 30 s | heading + 2144 chars |

  **`YoutubeExtractor: failed to parse inline JSON` is a red herring — it appears in the successful
  runs too**, so it is a non-fatal step in a fallback chain, not a cause. (An earlier reading of this
  session treated it as the cause and wrongly concluded the transcript was broken; the correction is
  recorded here so nobody re-derives it.)
- **Consequence for M1.6, and it is a sharp one.** M1.6 currently says "settle briefly (rAF + short
  delay for SPA hydration)". On YouTube the needed settle is somewhere between 6 and 15 seconds — far
  beyond any delay worth blocking the reader on. So the fixed delay cannot be the mechanism that makes
  YouTube work: either the re-extract action carries it (and needs to be prominent, not a hidden
  fallback), or extraction waits on a readiness signal rather than a timer. **Design input for M1.6,
  not a bug.**
- **The interactive transcript layer never wires**, separately from the content. `reader-transcript.ts`
  builds a pinned player, auto-scroll and clickable segments, all of which need a
  `.youtube.transcript` element (`wireTranscript`'s first guard, line 52). No element on the rendered
  page carries any `transcript`/`youtube`/`player` class — the transcript arrives as a plain
  `<h2>Transcript</h2>` plus timestamped paragraphs. Content and interactivity fail independently, so
  do not conflate them. **M1 acceptance ("shows the transcript in reader when available") is met by
  the content; the interactive layer is a nice-to-have — flag for M5 if it is ever wanted.**
- **SPA reloads fire `onPageFinished` repeatedly** — github fired it four times for one navigation.
  The bundle's `obsidianReaderInitialized` guard held every time (each re-injection returned
  `"object"` and did not replace the surface). M1.6's re-extract action still needs to exist, but
  re-injection itself is safe.

**Both G0 trade-offs settled by Johan, 2026-08-31 — G0 is closed:**

1. ~~**Make the Trusted Types default policy permanent?**~~ **Yes → D21.** Johan: the reader/clip
   session is ephemeral, so the reduced XSS guard on a page he chose is an acceptable cost.
2. ~~**Is `inline` the right default for reader CSS?**~~ **Yes → D20**, extended to `highlighter.css`
   at Johan's request.

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
  → SavePipeline: clipboard → obsidian://new → content= → report failure   [M2]
```

**Shim strategy (refines the plan):** upstream already funnels every extension API through
`webextension-polyfill`, and its own `build-api.mjs` swaps that one module for stubs. We do the same with
one alias — `webextension-polyfill → jsbridge/shim/browser.ts` — implementing three capability areas:
`storage` (backed by SharedPreferences via the JS bridge), `i18n.getMessage` (backed by bundled
`src/_locales/en/messages.json`), and `runtime` messaging (an event bus to/from Kotlin:
`sendMessage` → `AndroidBridge.postMessage(json)`; Kotlin dispatches inbound events via
`evaluateJavascript`). **Plan B (direct `storage-utils`/`i18n` aliases) proved unnecessary** — B1
verified nothing in the vendored tree bypasses `browser-polyfill.ts`, so the one alias covers
everything (§2).

Two further duties fall on this layer, both discovered at G0 and both non-obvious because a browser
extension never needs them (§2, and Architecture & Rationale's *What we are not*):

- `runtime.getURL` is backed by a build-time asset map, and **CSS is delivered inline** rather than
  through the blob URLs upstream uses, because page CSP refuses them (D20).
- A **pass-through Trusted Types default policy** is installed before the reader runs, or pages
  enforcing Trusted Types kill extraction outright (D21).

```text
android/                              Gradle project (Kotlin, Compose, minSdk 31, targetSdk 36)
  app/src/main/
    java/…/share/ShareReceiverActivity.kt
    java/…/reader/ReaderActivity.kt, ClipperBridge.kt, ReaderWebViewClient.kt
    java/…/clip/ClipSheet.kt, ClipResult.kt
    java/…/save/SavePipeline.kt, ObsidianUri.kt      (SafWriter.kt deferred — D18)
    java/…/settings/                  vault name, prefs, template store
    assets/clipper-bundle.js          built artifact, committed
jsbridge/
  package.json, build.mjs             esbuild + sass via Node API (node build.mjs — cross-platform)
  shim/browser.ts                     the webextension-polyfill replacement
  src/bundle-entry.ts                 bundle entry — exposes window.__clipper
  src/vendor-globals.d.ts             ambients the vendored tree expects (chrome, the polyfill module)
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
screen so the first install can exercise A2/A3/A4 immediately.

**Status (2026-08-31, machine-side): Phase 0 complete.** P0.2/P0.3/P0.4 done and the acceptance list
verified on the Mac. The scaffold's first real `assembleDebug` passed (the 2026-08-30 caveat about the
cloud session being unable to build is retired — no version nudging was needed). Toolchain was then
migrated to current stable per D17: AGP 9.3.2, Gradle 9.5.0, JDK 25, Compose BOM 2026.02.01,
configuration cache on, daemon toolchain committed at `android/gradle/gradle-daemon-jvm.properties`.
**M0 is complete and GATE G0 is closed (§2, §6); a fresh session resumes at M1 (§7).**

**Local dev loop — `just` at the repo root.** A `justfile` and `mise.toml` were added after this
playbook was first written; they are the primary interface and a fresh session should prefer them over
raw Gradle/adb invocations.

```text
mise trust && mise install    # provisions JDK 25 + Node 22 (mise refuses untrusted configs)
just setup                    # submodule, android/local.properties, npm deps
just doctor                   # verifies toolchain, SDK, adb, submodule, deps, attached device
just run                      # assembleDebug + installDebug + launch on the phone
just log                      # logcat filtered to this app's pid
just jstest                   # jsbridge vitest suite
just jsbuild                  # rebuild android/.../assets/clipper-bundle.js from the submodule
just jsverify                 # prove the committed bundle matches its sources (§14)
just inspect                  # prints the chrome://inspect steps for WebView debugging (Layer B)
```

`ANDROID_HOME` is exported by `mise.toml`; `adb` is not assumed to be on PATH anywhere.

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
  **Open `android/`, not the repo root.** Studio expects the Gradle project at the project root; opening
  the repo root and trying to link the subfolder leaves the Gradle tool window greyed out and no run
  configuration. The cost is that `jsbridge/` and `docs/` are not in Studio's tree — which is fine,
  since Layer B work happens in an editor plus `chrome://inspect` (§14), not in Studio.
  Studio is *optional*: the whole build/install/run loop is `just` (see §5 status). Keep Studio for
  Compose Preview (`SpikeScreenPreview` in `spike/SpikeScreen.kt` is the smoke test that sync, the
  Android facet and the Compose plugin are all wired) and the Kotlin debugger.
- **P0.3 — Phone setup (Find N6 / ColorOS).** Settings → About device → Version → tap the build/version
  number 7× to unlock developer options (they appear under Settings → Additional settings). Enable
  **USB debugging** and **Install via USB**. ColorOS may nag about "monitoring" on each connection —
  accept once per machine. Verify with `adb devices` showing the device as `device`, not `unauthorized`.
  Windows note: if the device doesn't enumerate, install the OPPO USB driver (or the generic ADB driver
  via Windows Update) — macOS needs nothing.
- **P0.4 — Node LTS** (≥20) on the dev machine — pinned in `mise.toml` (currently 22.22.2) and
  installed by `mise install`. Only required when rebuilding `clipper-bundle.js`; the committed artifact
  keeps Android-only checkouts fully buildable without Node.
- **P0.5 — Submodule + deps.**
  `git submodule add https://github.com/obsidianmd/obsidian-clipper jsbridge/vendor/obsidian-clipper`,
  then pin: `git -C jsbridge/vendor/obsidian-clipper checkout 9aa509b8f2801b08d974fb59f026df6f9a12e496`.
  In `jsbridge/`: `npm init -y`, `npm i -D esbuild sass vitest linkedom typescript` and
  `npm i defuddle@0.19.3 dayjs`.
- **P0.6 — App scaffold.** New Android Studio project: "Empty Activity" (Compose), Kotlin DSL, package
  `it.slowmail.obsidianreader` (final name at G2 — package id is internal and can stay regardless of
  branding), `minSdk 31`, `targetSdk 36`. Commit the wrapper (`gradlew` + `gradlew.bat`).

### Acceptance

- [x] Scaffolded app builds from CLI (`just build`) and from Android Studio, installs on the Find N6,
  and launches. *(macOS verified 2026-08-31; Windows unverified — that machine hasn't entered the
  picture yet.)*
- [x] `adb devices` works; `git status` clean on a fresh `git clone --recursive` with the submodule at
  the pinned `9aa509b`. *(Both verified 2026-08-31.)*
- [x] `npm test` runs in `jsbridge/` — 3 tests passing (`just jstest`).

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
- **A3.** ~~Probe `content=` limits and record the reliable maximum.~~ **Done 2026-08-31 — see §2.**
  No practical ceiling: clean up to 512 KB, loud catchable failure at 1024 KB. The ~500 KB figure in the
  original plan was wrong — it is the limit for Intent *extras*, whereas this payload rides in the data
  URI. Outcome: no threshold constant; `SavePipeline` tries and catches.
- **A4.** ~~Verify `&append=true`, `&overwrite=true`, and `&silent=true` behave as documented.~~
  **Done 2026-08-31 — pass, see §2.** Note `silent` suppresses *opening* the new note; it does not stop
  Obsidian being foregrounded.
- **A5.** ~~Confirm whatever vault automations Johan relies on fire the same way they do for
  desktop-clipper notes.~~ **Done 2026-08-31 — they do not.** Templater's on-create trigger does not
  fire for `obsidian://new` notes. See §2; D2/D18 re-argued as a result.

### Spike B — the reader, in a bare WebView

- **B1.** ~~First rough cut of `jsbridge/build.mjs` … alias `webextension-polyfill` → a shim of
  hardcoded stubs.~~ **Done 2026-08-31 — see §2.** Went further than "hardcoded stubs" in two places
  because B2 made them load-bearing rather than optional: `runtime.getURL` is backed by a real asset
  map, and `i18n.getMessage` by the bundled `en/messages.json`. Both are already in their M1.3 shape;
  what remains stubbed for M1.3 is `storage` (in-memory, needs SharedPreferences) and `runtime`
  messaging (a local event bus, needs the Kotlin `AndroidBridge`). `window.__clipper` exposes
  `{ Reader, toggle, isActive, browser }` — `browser` is the shim itself, so B3 can poke storage and
  asset resolution from `chrome://inspect`.
- **B2.** ~~Determine how reader styles are delivered and replicate.~~ **Answered 2026-08-31 by reading
  upstream, no spike needed — see §2.** CSS ships separately (`reader.css` / `highlighter.css`) and is
  injected at runtime through `runtime.getURL`; `build.mjs` compiles both with `sass` and embeds them.
- **B3.** ~~Scratch activity with a WebView.~~ **Done 2026-08-31 — pass, see §2.** Original text: load
  `https://stephango.com/vault`, run the bundle, call `__clipper.toggle()`. Confirm screenshot 1's
  toolbar renders and scrolling/TOC work. Inspect via `chrome://inspect` on the dev machine.
  Three things B1/B2 put on this spike's list (all §2):
  1. Add `INTERNET` to the manifest first — it isn't there.
  2. Test a **strict-CSP page (github.com)** alongside stephango.com. The reader strips the page's
     stylesheets and injects its own through a blob URL, which page CSP can block where an extension
     would not. Mitigation if it bites: strip CSP response headers in `shouldInterceptRequest`.
  3. Decide how Kotlin injects a ~2 MB bundle — `evaluateJavascript` with the whole source, or a
     `<script src>` served by `WebViewAssetLoader` (which has the same CSP exposure as (2)).
     Keep the Spike A harness reachable; M2's acceptance list still references it.
- **B4.** ~~Same page through `defuddle` full bundle: eyeball markdown + metadata quality on 2–3 real
  pages.~~ **Not run as a spike — folded into M1.7 per D22.** B3 already exercised extraction on four
  real pages including the two hard ones, so what remained was markdown/metadata quality against saved
  fixtures, which is M1.7's job and keeps the output instead of throwing it away. Two B3 findings go
  in as fixture cases: unflattened shadow DOM on github, and the YouTube settle-time question.

### GATE G0 — CLOSED, PASSED (2026-08-31)

**Outcome: A1/A2 passed and B3 renders a usable reader, so both green branches were taken** —
clipboard-first stays the primary save path (D2 confirmed), and Layer B proceeds as designed → M1.
Two trade-offs surfaced along the way and were signed off by Johan: **D20** (inline CSS) and **D21**
(Trusted Types). Full findings in §2. The table below is kept as the decision record.

| Finding | Consequence |
|---|---|
| A1/A2 pass | **Taken.** Clipboard-first stays the primary save path (D2 confirmed). |
| Clipboard path fails | Not taken. |
| B3 renders usable reader | **Taken.** Layer B proceeds as designed → M1. |
| B3 unusable/broken | Not taken. Options had been, best first: (1) upstream's own standalone reader page — see below; (2) deeper shimming; (3) a native-lite reader. **Option (1) remains the documented fallback if page CSP ever defeats the live-page path on a site that matters.** |

**Upstream ships two reader paths, not one** (found 2026-08-31 while comparing our WebView against the
extension's privileges). Besides toggling on the live page — what B3 tests — `src/reader.html` +
`src/core/reader-view.ts` render at *the extension's own origin*: fetch the target URL, `DOMParser` it
into a detached document, run Defuddle on that, set `Reader.preExtractedContent`, render. `reader.css`
loads there as a plain same-origin `<link>`.

Why this matters for us: **the page-CSP risk is a property of the live-page path only.** A
`WebViewAssetLoader` page of our own has no third-party CSP to fight, and the reader's stylesheet
stops needing a blob URL. What it costs is a fetcher — the extension routes through its background
worker (`proxyFetch` → `fetchProxy`, backed by `<all_urls>`) because an extension page has no CORS
exemption either; ours would be Kotlin using `CookieManager`'s cookies. It also gives up
browse-then-toggle, which M6.1's login flow wants regardless. Not a reason to change course now — B3
tests the live-page path as planned — but it is the first fallback if CSP bites, ahead of any
hand-written reader.

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
  `obsidianReaderInitialized`; B3 saw github fire `onPageFinished` four times for one navigation and
  the guard held), then `__clipper.toggle()`.
  **Revised by B3 (§2): a short settle delay cannot be the mechanism.** YouTube needs 6–15 s before
  the transcript is extractable — far beyond anything worth blocking the reader on. So either the
  "re-extract" action carries this case and must be prominent rather than a hidden fallback, or
  extraction waits on a readiness signal instead of a timer. Decide when building M1.6; do not just
  pick a bigger number. Toolbar buttons
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
  `silent`, bare `&clipboard` + short-error `content=`; (4) `startActivity`. Fallback: full
  `content=` when clipboard mode is off/failed. No size threshold — A3 found no practical ceiling and
  the oversized case throws catchably, so try and catch rather than pre-checking a magic number. If
  that catch fires, surface the failure to Johan (D2); do not save by another route.
- **M2.4 — Setup screen.** First-run setup: vault name (typed, must match Obsidian's vault name
  exactly), default folder ("Clippings"), silent-open toggle.
  *`SafWriter` and the `ACTION_OPEN_DOCUMENT_TREE` / `takePersistableUriPermission` plumbing are
  deferred per D18* — with no SAF save path there is nothing to write. If the `content=` ceiling ever
  becomes a real annoyance, this is where the writer would go back in.
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
- [ ] A very large note (>512 KB) saves via the clipboard path; with clipboard artificially disabled
  the `content=` path reports a clear failure rather than saving silently or truncating (D2).
- [ ] Backgrounding the app mid-clip with a large note does not crash it — note content stays out of
  saved instance state (G0 landmine).
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
  `highlighter.css` delivery is already handled — inlined since G0 per D20, verified on a CSP-strict
  page — so M4 does not need to revisit it.
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

- **M6.1** *Cut to almost nothing by D23.* No URL bar, no back/forward, no browsing surface. What may
  still be worth having is a "show the page as-is" toggle that stops applying reader mode to the
  already-loaded page — enough to log in via a form on that page, since cookies persist (M1.2) and
  this is once per site. If even that drifts toward browser chrome, drop it: per D23 a login-walled
  page is Johan's workaround to perform elsewhere, not a feature to build.
- **M6.2** Error-state pass: offline, timeouts, HTTP errors, extraction failures — every path ends in
  either a usable reader, a bookmark offer, or a clear retry.
- **M6.3** *Deferred (D18).* SAF hardening — detect revoked/moved tree permission and re-prompt instead
  of failing silently. Only relevant if the SAF writer returns.
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
`just inspect` prints the steps; `just log` tails logcat filtered to the app, and `adb logcat -s
chromium` catches JS console output in a pinch.

**Driving the share target from the dev machine** (once M1.1 lands) — faster than sharing by hand from
a browser on every iteration:

```bash
adb shell am start -a android.intent.action.SEND -t text/plain \
  --es android.intent.extra.TEXT "https://stephango.com/obsidian" \
  -n it.slowmail.obsidianreader/.share.ShareReceiverActivity
```

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
| Android/ColorOS blocks the clipboard handoff to Obsidian | Fallback to `content=` (A1/A2 passed at G0, so not currently a live risk) | G0 |
| Vendored reader breaks or fights the WebView | Timeboxed spike before any investment; native-lite fallback named at G0 | G0/G1 |
| Upstream drift breaks extraction or highlighter on bump | Pinned submodule; fixture snapshots + upstream tests in our harness; §14 procedure | M1.7 onward |
| Sites block the WebView UA or bot-detect | Chrome-mobile UA (M1.2), cookie persistence, bookmark fallback (M2.5). **No browsing/login UI to fall back on — D23**, so a hard-blocked site is accepted as a bookmark clip | M2 |
| SPA/JS-heavy pages extract poorly | Settle delay + re-extract action (M1.6), bookmark fallback | M1/M2 |
| Intent URI size limits truncate `content=` saves | A3 measured no truncation up to 512 KB; oversized fails loudly, never silently | M0 |
| Windows dev friction (paths, EOL, drivers) | §14 parity rules, P0.1 gitattributes, P0.3 driver note | Phase 0 |
| Obsidian changes `obsidian://` behavior | Recipe isolated in `ObsidianUri.kt` + §3 documents the contract. Accepted single point of failure per D18 — notes are plain markdown in a folder Johan controls, so recovery is manual but never data-loss | — |

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
