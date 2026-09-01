# Android Web Clipper for Obsidian — Build Playbook

This is the live, step-by-step guide from empty repo to finished app, and **the authoritative document**
— milestones, acceptance criteria, decisions, the save recipe and the dev loop all live here. Two
companions hold what this one deliberately does not:

- [Architecture & Rationale](<Android Web Clipper for Obsidian — Architecture & Rationale.md>) — the
  *why* behind the three-layer design and what upstream actually ships.
- [Problem & UI Reference](<Android Web Clipper for Obsidian — Problem & UI Reference.md>) — the problem
  statement, the scope guard, and the **legend for the three `Obsidian Web Clipper UI - *.jpg`
  screenshots** referenced throughout this document (see §16).

**Definition of done for v1:** Johan shares a link from any app on the Find N6 → the page opens in the
app → one tap turns on the reader (D24) → one tap opens the clip sheet → the note lands in the vault
shaped by his template. Happy path well under 15 seconds.

*(Two corrections since this was first written: the reader is a deliberate tap rather than automatic —
**D24** — and "with his usual vault automations firing" was removed because G0/A5 measured that
`obsidian://new` does not fire Templater's on-create trigger. See **D2** and §2.)*

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
  **Corrections collapse the text to current truth, with a dated pointer at the decision that changed
  it — not strikethrough archaeology left in place.** Git is the archive; where superseded text might
  ever be needed again, name the commit that holds it (the way B3's deleted harness stays readable at
  `819ce26`). The audience is the next agent session, which pays for every dead line it has to parse.
  *(Johan's call, 2026-09-01, at the M1 architecture review.)*
- A fresh implementation session should read §1 (decisions), §2 (gate outcomes), §3 (upstream ground
  truth), and the milestone it is executing. Architecture & Rationale is background reading; Problem &
  UI Reference is where every "screenshot N" reference resolves.
- **Where things stand (2026-09-01): M0 and M1 are built; G0 and G1 are both CLOSED — passed. M2 was
  re-planned the same day around D31 and the next thing that happens is M2.1.** Every M1 task
  (M1.0–M1.8) is implemented and verified on the Find N6; G1 passed on Johan reading real articles on
  the device (§2). Three M1 acceptance boxes carried through the gate honestly unticked — see §7, and
  the carried-forward box in §8.

  **Before writing any M2 code, read D31 — it is the largest decision in this document.** The app
  hosts upstream's own extension UI instead of reimplementing it in Compose. That reverses what §8 and
  §9 used to say, retires D16 and D27 outright, and narrows D14 and D20. The M2.0 spike that proved it
  is in §2; its findings are load-bearing, especially the silent clipboard fallback and the popup's
  `window.close()`.

  Also read D25–D30. D26 (re-extract is not buildable; Reload is the recovery) and D29 (no algorithmic
  darkening) overrule text recorded earlier the same day; D30 settles behaviour flags — executed as
  written, unprompted. §2's G0 findings still correct several older assumptions.

  One constraint M2 inherits, earned rather than assumed: **the bookmark fallback must trigger on
  empty *text*, not an empty content string** (M1.7's Instagram fixture). Upstream has no bookmark
  feature at all — verified, zero hits in `src/` — so M2.5 is genuinely ours to build.

  Read §5's status block for the `just`-based dev loop, which post-dates this playbook's original
  text.
- Expected effort: one milestone ≈ one to a few focused sessions. M0 is timeboxed to ~1 day.

## 1. Decisions log

### Governing principle — defer to the human

*Stated by Johan, 2026-09-01, and it outranks the table below where they conflict.*

**When the machine could decide or the human could, the human decides.** Prefer an action the human
takes over a default the machine applies; prefer leaving them in front of a working page over dropping
them into a broken state they must escape; prefer surfacing a failure over silently choosing a
different route.

This is a principle about *who holds the decision*, not about which outcome is technically better —
and it holds even when the machine's guess would usually be right. D24 is the worked example: reader
mode became a tap rather than an automatic transform, and the argument that carries it is that the
human stays in the loop, **not** the settle-timing rationale (which does not survive scrutiny — see
M1.6). Decisions already consistent with it: D2 (a failed save is reported, never rerouted), M2.5
(a bookmark clip is offered, not substituted), M3.3 (template auto-selection preselects; the manual
override always wins). **D30 marks the principle's edge**: a decision the human took in advance — a
template's `overwrite` flag — is still the human deciding, so executing it unprompted is deference,
and re-confirming it on every clip would be the machine challenging a standing decision.

Settled decisions. Items marked *(default)* were taken by Claude with Johan's standing option to veto;
everything else was decided by Johan explicitly.

| # | Decision | Rationale |
|---|---|---|
| D1 | Dedicated Android app, not a browser extension | Mobile browsers relay `obsidian://` unreliably; a first-class app fires the intent itself (Brief). |
| D2 | Save via `obsidian://new`, clipboard-first, with `content=` as the only fallback. No SAF write path. On failure, tell Johan — never save by another route | **Rationale corrected at G0/A5 (2026-08-31).** The Brief's premise — that the URI lets Obsidian run its usual import triggers — is measurably false: Templater's on-create trigger does *not* fire for notes created via `obsidian://new`. The decision stands on what survives: no tree-URI plumbing to build or harden, Obsidian implements dedup/append/overwrite for us, and the note enters Obsidian's index immediately. Failure is reported rather than rerouted, because a save that silently takes a different path is worse than a visible error. |
| D3 | Three-layer architecture: upstream clip engine (dependency) + vendored reader/highlighter + native Kotlin/Compose shell | See [Architecture & Rationale](<Android Web Clipper for Obsidian — Architecture & Rationale.md>). |
| D4 | Reader (M1) before clip/save (M2) | Johan's call, 2026-08-30. The reading experience is part of the daily driver, not polish. |
| D5 | v1 = M0 + M1 + M2 + M3 (templates incl. import and URL auto-selection). Post-v1 order: highlighter → in-app login/polish; G2 reconfirms | Johan's call, 2026-08-30. Reader style settings were on the post-v1 list until 2026-09-01: screenshot 2 turned out to be upstream's own `Aa` panel, delivered at M1.3 and closed at M1.8 (§12), so there is nothing left to order. |
| D6 | Dev environment: Android Studio + physical device; **macOS and Windows are both first-class dev machines** | Johan's call. Hard constraint: Gradle wrapper + Node scripts only, no bash-only tooling. |
| D7 | Reference device: Oppo Find N6 — Android 16, ColorOS, foldable | Reader must work on cover and inner displays. |
| D8 | Highlighter (when it lands, M4) is in-session only — no cross-visit persistence | One-shot clip flow doesn't need the desktop extension's cross-visit storage. Flag to change. **Weakened by D31 (2026-09-01):** the in-session rule existed to avoid building persistence, but upstream's `highlights-manager.ts` already has it and the storage shim already backs it. Deferring the highlighter is now more work than shipping it. Revisit at M4's start; the pen is one hidden `data-clipper-unbuilt` attribute away. |
| D9 | Single configured vault in v1 *(default)* | Screenshot 3's vault dropdown becomes a settings value; multi-vault only if ever needed. |
| D10 | Clip sheet allows editing both properties and note body *(default)* | Matches desktop clipper. |
| D11 | `minSdk 31`, `targetSdk 36` | Sole target is the Find N6 on Android 16, so reach is irrelevant; 31 drops the `PendingIntent` mutability and pre-scoped-storage compat branches. Target current Android 16. |
| D12 | Sideload-only distribution *(default)* | Personal keystore; no Play Store steps anywhere in this playbook. |
| D13 | Bookmark-only fallback ships in M2, not polish *(default)* | Graceful failure is part of a trustworthy save pipeline. |
| D14 | **The *shim* has tests; extraction quality does not.** The harness starts in M1 *(default)* | Originally "every submodule bump is guarded from the beginning". **Narrowed by Johan, 2026-09-01, at the D31 review:** `extraction.test.ts` pinned word counts, exact author strings and content snapshots — assertions about defuddle's *output quality*, which legitimately shifts per release and which Johan would notice anyway as a template property coming up empty. Pinning them makes bumps noisy without making them safer, and upstream is the better judge. What stays and grows more valuable under D31 is `bootstrap`/`bundle`/`bridge` — tests of **our** code: the bundle builds, the shim's storage/i18n/messaging answer correctly. Fixtures stay on disk as manual reference (Instagram's empty-*text* case is still why M2.5 exists). **Accepted consequence: a submodule bump can break upstream UI that nothing tests.** |
| D15 | Project license MIT; `THIRD_PARTY_LICENSES` shipped in APK; no Obsidian trademarks in shipped branding | See §17. |
| D16 | ~~No template editor in v1~~ **RETIRED by D31 (2026-09-01).** The app ships upstream's editor | The decision priced an editor as expensive work to build. It is not work at all: `settings.html` + `core/settings.ts` + `managers/template-ui.ts` + `utils/import-export.ts` are a complete editor with triggers, behaviour flags and JSON export/import, and M2.0 brought them up under our shim unmodified (§2). Desktop authoring still works and imports the same JSON; it is simply no longer the *only* way. |
| D17 | Track the current stable toolchain (AGP/Gradle/JDK) rather than pinning to an older one or shimming | Standard tools at their sanctioned versions beat local workarounds; migrations are cheapest taken early. Toolchain versions live in `android/gradle/libs.versions.toml`, `android/gradle/wrapper`, `android/gradle/gradle-daemon-jvm.properties` and `mise.toml`. |
| D18 | `SafWriter` (M2.4) and SAF hardening (M6.3) deferred, not deleted | Follows from D2: with no SAF save path there is nothing to write or harden. **The original justification (SAF bypasses Obsidian's triggers) turned out not to separate the two options — A5 showed `obsidian://` bypasses them too.** What the deferral now rests on is cost: `SafWriter` reimplements append/overwrite that Obsidian gives us free, plus tree-URI permission plumbing to build and harden. Two accepted trades: (1) `obsidian://` always foregrounds Obsidian (A4) — SAF would have allowed a true background save; (2) the URI contract is now a single point of failure — acceptable because notes are plain markdown in a folder Johan controls, so recovery is manual but never data-loss. |
| D19 | Bundle English UI strings only (`LOCALES = ['en']`) and highlight.js's ~40-language `lib/common` rather than the full ~190 | Johan's call, 2026-08-31, confirming the B1 trims. Both degrade gracefully — `getMessage` falls back to English, `highlightElement` leaves an unregistered language unstyled — and both are one-line reverts in `jsbridge/build.mjs`. |
| D20 | Reader CSS is delivered as an inline `<style>` by default, not upstream's blob-URL `<link>` — for `reader.css` and `highlighter.css` alike | Johan's call, 2026-08-31 at G0. Measured: the blob path is refused by any page with a `style-src` that omits `blob:` (github.com), leaving the reader stripped and unstyled. Inlining costs nothing on pages without CSP, and detecting a refusal in order to fall back is harder than always inlining. Implemented without patching upstream — see `installStyle` in `jsbridge/src/bundle-entry.ts`. **Scope narrowed by D31 (2026-09-01): this applies to the *page* WebView only.** UI pages served from our own origin are not subject to any page's CSP, so `runtime.getURL` is a plain relative URL there and their CSS is a real `<link>` again. |
| D21 | Install a pass-through Trusted Types `default` policy before the reader runs | Johan's call, 2026-08-31 at G0. Without it, pages sending `require-trusted-types-for 'script'` (YouTube) kill the reader outright — Defuddle's `innerHTML` and `Reader.apply`'s `DOMParser` both throw and nothing renders. A browser extension never meets this because its content script runs in an isolated world Trusted Types does not police; our main-world injection is policed. **The accepted trade:** the policy switches off the page's own XSS guard for the life of that document. Johan's reasoning — the reader/clip session is ephemeral, the page is one he chose, and we already inject a bundle that rewrites the whole DOM. Only creatable where the page sends no `trusted-types` directive naming allowed policies; where it is refused we log and the page fails visibly. See `installTrustedTypesPolicy` in `jsbridge/src/bundle-entry.ts`. |
| D22 | B4's extraction-quality pass is folded into M1.7's fixture harness rather than run as a throwaway spike *(default)* | B3 already exercised extraction on four real pages including the two hard ones (CSP-strict, Trusted Types), so B4's remaining value is markdown/metadata quality on saved fixtures — which is exactly M1.7's job. Same work, but the output is kept and guards every future submodule bump (D14). M0 therefore ends at G0. Two B3 findings carry into M1.7 as fixture cases: unflattened shadow DOM on github, and the YouTube settle-time question. |
| D23 | **No generic browser UI, ever.** No URL bar, no back/forward, no tabs, history or downloads. If a page cannot be read without signing in, that is a workaround Johan performs outside the app — or the clip does not happen | Johan's call, 2026-08-31, when the question of pulling M6.1's browsing strip into M1 was raised. He clips from logged-in sites rarely, and a browser surface is far larger than it looks (tabs, downloads, uploads, fullscreen video, permission prompts, PDFs). This bounds M6.1 and overrides the "normal browser chrome" mitigation the Architecture doc used to propose. |
| D24 | **Reader mode is user-triggered, not automatic.** The shared page loads and renders normally; the app shell shows a "Reader" toggle. Recovery for a too-early tap: Reload → wait → tap Reader again (D26) | Johan's call, 2026-09-01, resolving the M1.6 problem B3 opened. **Rests on the governing principle above**: the toggle keeps Johan in the decision loop instead of the machine mandating a transform that may land him in a broken state. Secondary benefits: a badly extracting page leaves him looking at the real page he can decline to toggle, and an on-page login form becomes usable for free (what remains of M6.1 after D23). **The settle-timing argument does *not* hold and is not what this rests on** — see M1.6. |
| D25 | **Shell chrome is one slim bottom bar: `Reader`, `Reload`, and `Clip` from M2** | Johan's call, 2026-09-01. D24 requires a surface to host the reader toggle and D23 forbids a browser UI, but §16's inventory owned neither — the bar closes that gap. `Reload` is a full page reload, available in both states, added at Johan's request. It is deliberately *not* back/forward/URL/tabs, so D23 holds. After a reload the raw page is showing with the reader off, since D24 forbids auto-toggling. |
| D26 | **No re-extract action; Reload is the recovery for a too-early reader tap** | Johan's call, 2026-09-01, on evidence that M1.6's re-extract is not buildable. `Reader.apply` ends its cleanup with `doc.body.textContent = ''` and stores no copy of the original (`utils/reader.ts` ~L2130); `cleanupScripts` (~L1376) clears every page timer; `restore` (~L2383) recovers the page only by `window.location.reload()`. So once the reader is on, the page's DOM *and* its running scripts are gone: a late-hydrating YouTube transcript can never arrive, and a re-extract would re-parse the reader's own output. The recovery is Reload → wait → tap Reader, which toggling the reader off already does internally. The architecture where re-extract genuinely works — render into a separate document via `Reader.preExtractedContent` / `reader-view.ts` / `toggleReaderPageIframe`, leaving the original page alive and hydrating underneath — is a Layer B rework, **not carried to G1 as an agenda item**; revisit only if reading real articles shows extraction timing is a recurring problem. |
| D27 | **`AndroidBridge` is gated on a per-activity token, handed to the bundle as a closure parameter** *(default)* | `addJavascriptInterface` attaches the bridge to the main world of every page the WebView loads, so a hostile page's script can call it exactly as our bundle does. minSdk 31 means only `@JavascriptInterface` methods are reachable (no reflection), so the exposure is bounded to what we write — but what we write grows a save-to-vault path in M2. The token is passed as a closure parameter by the injection wrapper and never assigned to `window`, which page script could read. **Residual, recorded rather than papered over: anything on `window.__clipper` is reachable by the page, including our storage and `sendMessage`. M2 must never treat an inbound message as authorisation to save** — the save is initiated by a tap on the Kotlin side. **Threat model bounded by Johan (2026-09-01, M1 architecture review): the app is personal-use and he chooses what reaches it, so a hostile page attacking the bridge is out of scope.** Consequence: the wide diagnostic surface on `window.__clipper` (the shim, the installers, the sweep helpers) ships as-is rather than being DEBUG-gated — do not re-propose trimming it. **The tap-only save rule is RETIRED (Johan, 2026-09-01, at the D31 review): "I am not worried about a hostile page clipping to my vault… if the webclipper UI is able to call out to the obsidian vault without hitting the Kotlin bridge, then I am fine with that."** It was overspecified and it blocked D31 — under D31 the save is a tap inside upstream's own sheet, so no Kotlin-side tap exists to gate on. The save leaves via `window.open('obsidian://…')` and `shouldOverrideUrlLoading`, touching no bridge method at all. **The per-activity token stays** — it costs nothing and still bounds what page script can do to storage. |
| D28 | **The committed `clipper-bundle.js` is the production build** — minified, `DEBUG_MODE` off. `just jsbuild-debug` is a local-only override | Johan's call, 2026-09-01, closing M1.4's open question. There is one `assets/` directory, so whatever is committed is what a release APK ships; committing the debug build meant shipping ~800 KB of extra bytes with verbose logging on. The cost is B2's deliberate choice of an unminified artifact for unaided `chrome://inspect` reading — recovered by `just jsbuild-debug` (and `jsbuild-debug-map` for sourcemaps). Note `just jsverify` rebuilds `--prod` in place before diffing: a *committed* debug artifact fails it, while an uncommitted local one is silently rebuilt back to prod and passes. The rejected alternative was a Gradle-driven `--prod` build on the release variant, which would have made release builds require Node — something §14 promises they never do. **Consequence for the test suite:** it builds `--prod` to `jsbridge/.tmp/` via `--outfile`, so running tests exercises exactly what ships and can never leave a debug artifact in the tree. |
| D29 | **No algorithmic darkening. The raw page renders as authored, and the reader is told the app's theme directly** *(default)* | **Reverses the mechanism recorded under M1.8 earlier the same day (2026-09-01), on Johan's report that a raw page in dark mode was "almost unreadable".** `setAlgorithmicDarkeningAllowed` is the only switch that makes a WebView report `prefers-color-scheme: dark`, which is why it appeared to be the answer — it is what made the reader go dark. But WebView only defers to a page's own dark theme when the page declares `color-scheme`; stephango drives its theme from JS and declares nothing, so it was machine-darkened into dark-grey text on a dark background. Measured worse than the light page it replaced. The reader now learns the theme from a `darkMode` closure parameter and answers `prefers-color-scheme` itself (`installColorSchemeBridge`), so both surfaces are right: raw pages exactly as their authors drew them, reader properly dark. A site that picks its theme from the same query now gets to apply *its own* dark stylesheet — the thing algorithmic darkening was a poor substitute for. Johan's explicit Light/Dark choice in the `Aa` panel is untouched; it never consults the query. |
| D30 | **Template behaviour flags are executed as written — `overwrite=true` replaces the existing note, no existence check, no confirmation** | Johan's call, 2026-09-01, closing M2.3's open question. A template is a standing human decision: its creator chose that modality for a reason (and importing one is adopting it — M3.2), so it is respected, not continually challenged. This *is* the governing principle rather than an exception — deciding in advance is still the human deciding; see the principle's note above. Safety context from A4: the no-flag default de-duplicates (`note 1.md` beside `note.md`), so replacement only ever happens where a template explicitly asks for it. |
| D31 | **The app hosts upstream's extension; it does not reimplement its UI.** Two WebViews — the page WebView as today, plus a UI WebView on a `WebViewAssetLoader` origin serving upstream's own `popup.html` / `side-panel.html` / `settings.html`. The shim becomes the extension runtime | Johan's call, 2026-09-01, at the M2 planning review: *"if I could have the Obsidian Web Clipper in an android app, then I would be happy"*. §8 previously had M2.2 building a Compose `ModalBottomSheet` and M2.3 porting the save recipe by hand — **both reimplement code the submodule already contains.** `src/popup.html` + `src/core/popup.ts` *is* screenshot 3, element for element; `src/utils/obsidian-note-creator.ts` *is* §3's save recipe, which §3 already told us to mirror rather than improvise. **M2.0's spike (§2) brought the clip sheet, the save path, the settings page and the template editor up against our shim with zero changes to upstream source.** The mapping is direct: content script → page WebView (already how M1 works); popup/settings → UI WebView on our origin (the `chrome-extension://` analogue); `browser.storage`/`i18n`/`runtime` → the shim (already built); `browser.tabs` → trivial, there is exactly one tab and Kotlin owns it; `obsidian://` → `shouldOverrideUrlLoading` → `startActivity`. **Upstream's `background.ts` is NOT ported** — 1109 lines of browser-chrome management (context menus, tab lifecycle, `webRequest`, `action.setPopup`) that a single-tab app has no use for. We write a small responder for the ~15 actions the clip and settings paths actually send. That is B1's one-alias shim move, one layer up. Kotlin shrinks to: share intent, two WebViews, message routing, intent dispatch, first-run vault name. **Retires D16 and D27's tap-only rule; narrows D14 and D20; weakens D8. Accepted cost, eyes open: a submodule bump can break upstream UI nothing tests (D14), and we inherit upstream features wholesale rather than picking them.** |
| D32 | **Reader stays in the page WebView.** It is not moved to the UI origin, and there is no second reader implementation | Johan's call, 2026-09-01: *"if possible, don't fork the reader"*. Upstream's `reader-page` / `core/reader-view.ts` entry would render the reader as its own document — the architecture D26 describes as the dormant Layer B rework, which would make re-extract buildable. Tempting, but the injected reader works, G1 passed on it, and moving it doubles D31's blast radius. **One implementation, where it is.** Revisit only after the UI WebView lands; if it lands well, D26's rework becomes cheap rather than speculative. |

## 2. Gate outcomes

Filled in as gates are passed. Empty = not reached.

| Gate | Question | Outcome | Date |
|---|---|---|---|
| G0 | Does `obsidian://new` + `&clipboard` work on the Find N6? What is the reliable `content=` size limit? Is the vendored reader viable in a WebView? | **CLOSED — passed.** Spikes A and B both pass; the reader renders on all four test pages. Both trade-offs signed off by Johan → D20 (inline CSS) and D21 (Trusted Types). M0 ends here per D22. **Next: M1.** | A: 2026-08-31, B: 2026-08-31, closed: 2026-08-31 |
| G1 | Is reader parity good enough to build on (vs. reworking Layer B)? | **CLOSED — passed.** Johan read real articles on the Find N6 and ruled the reader good enough to build on. Layer B stays as designed; D26's rework path (render into a separate document) stays dormant unless real reading shows extraction timing recurring. Three M1 acceptance boxes were still unticked at the gate (the three apps' own share sheets, the transcript on device since B3, cookies against a real login) — carried into M2's device work as background checks, Johan's call. **Next: M2.** | 2026-09-01 |
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
  words; a long feature article is 30–60 KB. **Consequence: no threshold constant** — try and catch,
  never a magic maximum. Under D31 the try/catch is upstream's `saveToObsidian`; what M2.3 owns is
  catching the `startActivity` throw and reporting it (D2).
- **Default behaviour is de-duplicate, not overwrite.** Firing the same `file=` twice yields
  `note 1.md` alongside `note.md`. A4's `overwrite=true` is what changes this.
- **Landmine found, applies to M2.** The spike harness kept the full encoded URI in a
  `rememberSaveable`; at 512 KB that is ~1.4 MB of saved instance state and the activity died with
  `TransactionTooLargeException` in `PendingTransactionActions$StopInfo.run` *after* the note had
  already saved — a crash that looks like a save failure but is not. **Note content must never enter
  saved instance state** in `ReaderActivity` or anything it hosts, at any size. **Still live under
  D31** — the note now lives in the UI WebView's JS heap rather than Kotlin, which sidesteps the
  original crash, but any Kotlin that touches note text (the clipboard write, M2.3) must stay out of
  `rememberSaveable`.
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

Harness: `spike/SpikeBActivity.kt` (throwaway; **deleted by M1.0** — read it at commit `819ce26`
if the detail is ever needed). It mirrored its log to logcat (`just log`, or
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
  *(Refined at M1.7, 2026-09-01: the transcript is present in the **server HTML** — Defuddle's
  `YoutubeExtractor` parses it from inline player JSON, and a `curl` capture with no JavaScript
  executed yields it in full. So the timing below is not the transcript data arriving late over the
  network; it is a property of the live WebView that remains unidentified. The measurement stands.)*

  | settle | transcript |
  |---|---|
  | 6 s | absent |
  | 15 s | heading + 2144 chars |
  | 30 s | heading + 2144 chars |

  **`YoutubeExtractor: failed to parse inline JSON` is a red herring — it appears in the successful
  runs too**, so it is a non-fatal step in a fallback chain, not a cause. (An earlier reading of this
  session treated it as the cause and wrongly concluded the transcript was broken; the correction is
  recorded here so nobody re-derives it.)
- **Consequence for M1.6.** On YouTube the needed settle is somewhere between 6 and 15 seconds — far
  beyond any delay worth blocking the reader on, and beyond a realistic tap (2–5 s) too, so neither
  a fixed delay nor the user-triggered toggle clears it. The two mechanisms proposed here at the
  time (a prominent re-extract; extraction waiting on a readiness signal) both died at D26 — the
  recovery is Reload → wait → tap Reader again.
- **The interactive transcript layer never wires**, separately from the content. `reader-transcript.ts`
  builds a pinned player, auto-scroll and clickable segments, all of which need a
  `.youtube.transcript` element (`wireTranscript`'s first guard, line 52). No element on the rendered
  page carries any `transcript`/`youtube`/`player` class — the transcript arrives as a plain
  `<h2>Transcript</h2>` plus timestamped paragraphs. Content and interactivity fail independently, so
  do not conflate them. **M1 acceptance ("shows the transcript in reader when available") is met by
  the content; the interactive layer is a nice-to-have — flag for M5 if it is ever wanted.**
- **SPA reloads fire `onPageFinished` repeatedly** — github fired it four times for one navigation.
  The bundle's `obsidianReaderInitialized` guard held every time (each re-injection returned
  `"object"` and did not replace the surface): re-injection is safe. Re-extract itself cannot exist
  (D26); Reload carries that case.

**Both G0 trade-offs settled by Johan, 2026-08-31 — G0 is closed:**

1. ~~**Make the Trusted Types default policy permanent?**~~ **Yes → D21.** Johan: the reader/clip
   session is ephemeral, so the reduced XSS guard on a page he chose is an acceptable cost.
2. ~~**Is `inline` the right default for reader CSS?**~~ **Yes → D20**, extended to `highlighter.css`
   at Johan's request.

### M2.0 / extension-host spike findings — 2026-09-01, build machine (desktop Chromium)

Harness: `jsbridge/spike/` + `spike/build-ui.mjs` (throwaway, same convention as B3's
`SpikeBActivity.kt`). It builds upstream's `popup.html`, `side-panel.html` and `settings.html` as if
served from our own origin, with a fake background responder and an off-screen fixture frame standing
in for the page WebView. **Run it with `node spike/build-ui.mjs --page <fixture>.html`, serve
`.spike-ui/`, open `popup.html`.** This spike answered D31; delete it once M2.2 lands for real.

- **Pass — upstream's UI runs on our shim with zero changes to upstream source.** The only edits are
  two lines of HTML rewriting (drop the extension's `browser-polyfill.min.js` tag) and 26 lines added
  to `shim/browser.ts`. `core/popup.ts` and `core/settings.ts` compile through the existing
  `webextension-polyfill` alias untouched.
- **The clip sheet is screenshot 3, live and functional.** Template dropdown, note name, all seven
  typed properties with the right icons, values populated from real Defuddle extraction — including
  the filter chain `{{author|split:", "|wikilink|join}}` rendering as `[[Steph Ango]]`. Markdown body,
  folder field, "Add to Obsidian" with its secondary-action dropdown.
- **The save path produced a correct URI** — `obsidian://new?file=Clippings%2FHow%20I%20use%20Obsidian`
  plus YAML frontmatter (title, source, author list, published, created, description, tags) and the
  markdown body. §3's recipe, executed by upstream's own `saveToObsidian`, not ported.
- **`settings.html` renders completely** — General / Reader / Highlighter / Interpreter / Properties,
  and a **Vaults** field, which is D9's vault name as an upstream setting we no longer have to build.
- **The template editor works**: template name, triggers (M3's URL auto-selection), the Behavior
  dropdown (D30's flags), `{{title}}` note-name formatting, and JSON Export/Import (M3.2). **This is
  what retires D16.**

**Two real shim gaps, both fixed** (`shim/browser.ts`, +26 lines; suite still 52/52 green):

- **`storage.<area>.onChanged` was absent entirely.** The reader never subscribed; `core/popup.ts`
  does, and died on an undefined `addListener` before rendering anything. Now fires Chrome's
  `{ key: { oldValue, newValue } }` shape, and only reads old values when a listener exists so it adds
  no bridge round-trips.
- **`runtime.onUpdateAvailable` was absent.** It can never fire on Android, but upstream subscribes
  unconditionally and an undefined member is a TypeError at boot.

Still missing, both small: `browser.commands.getAll` (settings' Hotkeys section) and
`getHighlighterMode` (needs the real content script — M4 territory).

**Three findings that change what M2 must build:**

1. **`navigator.clipboard.writeText` failed and upstream silently rerouted to `content=`.** The URI
   above is the *fallback* path — whole note in the URI, no `&clipboard`. `tryClipboardWrite` catches
   the failure and switches route without telling anyone, **which is exactly what D2 forbids**. Now
   confirmed empirically rather than predicted. Fix: back `copyToClipboard` with Kotlin's
   `ClipboardManager` (A2 proved that path) or make the fallback loud. *Caveat: the spike environment
   lacked focus/user-gesture, so a real WebView may succeed — but the silent reroute is in the code
   either way.*
2. **The popup calls `window.close()` after a successful clip.** It killed the spike's browser tab
   mid-test. In a WebView that surfaces as `WebChromeClient.onCloseWindow`; the app must dismiss the
   UI WebView on it or be left with a dead sheet.
3. **Defuddle scores partly on layout.** A `display:none` frame extracts **0 words**; the same frame
   off-screen but laid out extracts **1631**. Mostly a harness lesson — it cost an hour here — but it
   bites for real if any WebView ever hosts a page without layout.

**What the spike did *not* prove, stated plainly.** It ran on desktop Chromium, not Android. The
`WebViewAssetLoader` origin, the real cross-WebView `sendMessageToTab` hop (faked here with a
same-origin iframe), CSP behaviour on a device, and bundle size (the spike's 11 MB is unminified with
inline sourcemaps) are all still open. The page was a saved fixture, not a live site. **M2.1 is where
those get answered.**


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

**Restructured by D31 (2026-09-01).** The app is a mini-browser hosting upstream's extension, not a
native app borrowing pieces of it. Two WebViews, mirroring the extension's own split between a content
script and its privileged pages.

```text
Share sheet (text/plain URL)
  → ShareReceiverActivity                       [M1]
  → ReaderActivity
      ├─ PAGE WebView (persistent cookies, Chrome-mobile UA) — the "content script" world
      │    → load URL → inject clipper-bundle.js          [M1]
      │    → Reader.toggle(document)                      [M1 — screenshot 1; stays here, D32]
      │    → content.ts message handlers                  [M2 — getPageContent, highlights]
      │    → highlighter                                  [M4]
      │    → reader style settings (upstream's Aa panel)  [done at M1.3, §12]
      │
      └─ UI WebView on WebViewAssetLoader origin — the "chrome-extension://" world
           → popup.html / side-panel.html   upstream's clip sheet   [M2 — screenshot 3]
           → settings.html                  upstream's settings + template editor  [M2/M3]
           → save: upstream saveToObsidian() → window.open('obsidian://…')

  Kotlin between them: message routing (browser.tabs / the background responder),
  shouldOverrideUrlLoading → startActivity for obsidian://, first-run vault name.
```

**What Kotlin does *not* do any more:** build the clip sheet, compose the note, build the
`obsidian://` URI, or implement template matching. All four are upstream's, exercised in M2.0.

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

**Both duties belong to the *page* WebView only (D31).** They exist because Android has no
isolated-world API: an extension's content script is exempt from page CSP, and `evaluateJavascript`
into the main world is not. On the UI WebView's own origin neither applies — `runtime.getURL` is a
plain relative URL and the CSS is a real `<link>`. §8 carries an open proposal to strip CSP headers on
the page WebView, which would retire both duties there too.

```text
Marked (planned) where the file does not exist yet — everything else is on disk as of 2026-09-01.

android/                              Gradle project (Kotlin, Compose, minSdk 31, targetSdk 36)
  app/src/main/
    java/…/MainActivity.kt            launcher; a "share a link" screen that becomes M2.4's setup
    java/…/share/ShareReceiverActivity.kt, SharedUrl.kt      (URL parsing is JVM-testable)
    java/…/reader/ReaderActivity.kt, ReaderWebViewClient.kt
    java/…/reader/AndroidBridge.kt    the @JavascriptInterface object (token-gated — D27)
    java/…/reader/ClipperBundle.kt    the bundle asset + the JS snippets Kotlin drives it with
    java/…/ui/ClipperTheme.kt         Compose day/night theme (M5.2)
    java/…/ui/ClipperUiWebView.kt     UI WebView + WebViewAssetLoader      (planned — M2, D31)
    java/…/bridge/MessageRouter.kt    routes runtime messages between the two WebViews (planned — M2)
    java/…/settings/                  vault name + first-run prefs         (planned — M2.4)
      (D31 removes four planned files before they were written: ClipSheet.kt, ClipResult.kt,
       SavePipeline.kt, ObsidianUri.kt. All four are upstream's job now. SafWriter stays
       deferred — D18.)
    res/values/themes.xml, res/values-night/themes.xml       the day/night pair (D29 context)
    assets/clipper-bundle.js          built artifact, committed — the PROD build (D28)
  app/src/test/…/share/SharedUrlTest.kt                      JVM unit tests
jsbridge/
  package.json, build.mjs             esbuild + sass via Node API (node build.mjs — cross-platform)
  vitest.config.ts                    serves `virtual:assets`, aliases the polyfill to our shim, and
                                      pulls in upstream's two highlighter suites (M1.7)
  shim/browser.ts                     the webextension-polyfill replacement; bridge-backed storage
  src/bundle-entry.ts                 page-WebView bundle entry — exposes window.__clipper
  src/ui-entry.ts                     UI-WebView entry: our background responder + upstream's
                                      popup/settings pages        (planned — M2, D31)
  src/background.ts                   our ~15-action responder; upstream's 1109-line background.ts
                                      is NOT ported               (planned — M2, D31)
  src/vendor-globals.d.ts             ambients the vendored tree expects (chrome, the polyfill module)
  test/global-setup.ts                builds the bundle once, --prod, to .tmp/ (never the asset)
  test/extraction.test.ts             Defuddle over the fixtures, under jsdom
  test/sandbox.ts                     the linkedom + VM sandbox bundle/bridge tests share
  test/bundle.test.ts, bridge.test.ts, bootstrap.test.ts
  test/fixtures/*.html + README.md    captured pages, and what they cannot prove
  spike/                              M2.0's throwaway extension-host harness (§2); delete at M2.2
  vendor/obsidian-clipper/            git submodule @ pin
docs/plan/                            these documents
LICENSE, .gitignore, .gitattributes
THIRD_PARTY_LICENSES                  (planned — assembled at v1 release, §10/§17)
```

---

## 5. Phase 0 — Environment & repo bootstrap

**Status (2026-08-30, repo-side done by Claude session):** P0.1 done (`.gitattributes` as below plus
`*.jar`/`*.webp` binary entries; `LICENSE` MIT added). P0.5 done — submodule added and pinned at
`9aa509b`; `jsbridge/` has deps installed (defuddle pinned exactly at 0.19.3; vitest 4 / esbuild 0.28 /
sass 1.103 / linkedom 0.18 / typescript 7) and a bootstrap + bundle suite passing via `npm test` (17 tests as of 2026-09-01)
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
just share <url>              # fire a real ACTION_SEND at the app — the fastest M1/M2 loop
just log                      # logcat filtered to this app's pid
just test                     # Android JVM unit tests
just jstest                   # jsbridge vitest suite (ours + upstream's highlighter suites)
just jsbuild                  # rebuild the committed bundle — minified, DEBUG_MODE off (D28)
just jsbuild-debug            # local unminified build for chrome://inspect; never commit it
just jsverify                 # prove the committed bundle matches its sources (§14)
just jscheck                  # typecheck the jsbridge TypeScript
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
  Compose Preview (`HomeScreenPreview` in `MainActivity.kt` is the smoke test that sync, the
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
     ~~Keep the Spike A harness reachable; M2's acceptance list still references it.~~ Both spikes
     were deleted at M1.0: A1–A5 are recorded in §2, and M2's acceptance re-checks them against the
     real `SavePipeline`, not the harness.
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

- **M1.0 — Retire the M0 spikes.** Delete `spike/` (`SpikeBActivity.kt`, `SpikeScreen.kt`) and the
  manifest entry; `MainActivity` stops being the spike chooser. The launcher activity becomes a plain
  "share a link to use this" screen — it is what `just run` lands on, and it grows into M2.4's setup
  screen. Spike A's harness is not preserved: A1–A5 are recorded in §2, and M2.3 rebuilds the save
  path properly.
- **M1.1 — Share target.** `ShareReceiverActivity` with an intent filter for `ACTION_SEND` +
  `text/plain`. Extract the first `http(s)` URL from `EXTRA_TEXT` (apps commonly share `"Title\nURL"`;
  the YouTube app shares title + short link). Keep `EXTRA_SUBJECT` as a title hint. No URL found →
  polite toast, finish.

  **Trap, hit and fixed on 2026-09-01 — do not re-introduce it.** `ShareReceiverActivity` is the
  *root* of the task a share creates, so `android:excludeFromRecents` on it governs the whole task,
  `ReaderActivity` included. The reader then disappears from the app switcher the moment Johan
  switches apps, and cannot be returned to — the launcher icon opens `MainActivity` in a different
  task, so it presents exactly as *"the clipper closes when I switch apps"*. It was added to keep
  the invisible trampoline out of Recents; `android:noHistory` already does that, and is what
  remains. Diagnosed from a full logcat capture: 19 `isExcludeFromRecents … res:true` verdicts, and
  the app process still alive throughout — **nothing crashed**.
- **M1.2 — ReaderActivity + WebView config.** JS on, DOM storage on; `CookieManager`: accept cookies +
  third-party for the WebView, `flush()` in `onPause` (login sessions survive relaunch);
  User-Agent = current Chrome-mobile string with no `; wv` token (constant, overridable in settings
  later); `WebView.setWebContentsDebuggingEnabled(true)` in debug builds. Loading and error states
  (offline, HTTP errors) with retry.

  **Shell bar (D25).** One slim bottom bar, present whether or not the reader is on: `Reader`
  (toggle) and `Reload` (full page reload); `Clip` joins them in M2. No URL bar, no back/forward
  buttons, no tabs — D23 holds. System Back walks WebView history where it exists and otherwise
  finishes the activity; that is an OS gesture, not chrome.
- **M1.3 — Production shim. DONE (2026-09-01), verified on device.** `shim/browser.ts` backs
  `storage` with `AndroidBridge` (`getItem/setItem/removeItem/keys/clear`, one SharedPreferences file
  with the area as key prefix — `sync:reader_settings`) and forwards `runtime.sendMessage` up as JSON;
  `__clipper.receive(json)` is the entry point for events coming down. Every call carries the D27
  token. `session` deliberately never reaches the bridge — it is per-document state by definition.
  With no bridge (vitest, or the bundle evaluated anywhere else) storage falls back to in-memory maps.
  - **`jsbridge/test/bridge.test.ts` is the executable spec for `AndroidBridge.kt`**: it evaluates the
    bundle inside the same wrapper the device uses, against a fake bridge. Argument order or token
    discipline drifting on either side fails there rather than on the phone.
  - Measured on the Find N6: upstream's `Aa` panel wrote `fontSize` 16 → 18 through the bridge into
    `shared_prefs/clipper-storage.xml`, and a cold relaunch read it back.
- **M1.4 — Production bundle. DONE (2026-09-01).** SCSS compiled, sourcemaps
  opt-in via `build:debug`, output committed, `npm run build` / `npm run verify` (`just jsbuild` /
  `just jsverify`) in place since M0.
  - **Lucide turned out to be a non-issue.** The reader builds its toolbar SVGs inline with its own
    `createSVG`; `lucide` is imported only by `core/settings.ts` and `core/highlights.ts`, which are
    extension pages we do not bundle. Measured from the esbuild metafile: **lucide contributes 0
    bytes**, as do the `src/icons/*.png` extension icons. Nothing to wire in.
  - **Which bundle does a release APK ship? Settled → D28: the committed artifact is the
    production build** (1210 KB minified, down from 1995 KB). `npm run build` and `just jsbuild`
    now mean `--prod`; `just jsbuild-debug` is the local Layer B override and `just jsverify` will
    call it dirty, which is the point. `build.mjs` gained `--outfile` so the test suite builds
    `--prod` to `jsbridge/.tmp/` instead of overwriting the committed asset — previously every
    `npm test` left a debug bundle in the tree. All 32 JS tests pass against the minified build,
    which is also the evidence that minification does not disturb the `__clipper` surface.

- **M1.5 — Trademark sweep. DONE (2026-09-01), verified on device.** `sweepBranding` replaces the gem
  after `Reader.apply` builds the toolbar — a post-hoc DOM swap, not a submodule patch, so §14's bump
  procedure stays a version change (the same discipline `installStyle` follows). The mark is matched
  by reading each toolbar `svg`'s `viewBox` for `0 0 256 256` — the gem is the only 256-grid icon
  among 24-grid lucide shapes — rather than by an attribute selector, which is case-sensitive against
  SVG and unsupported outright by linkedom.
  - **Sweep of the rest of the tree: the gem is the only mark that reaches the bundle.** It appears in
    `utils/reader.ts`, `settings.html` and `highlights.html`; the latter two are extension pages we do
    not bundle, and `src/icons/*.png` contribute 0 bytes. The gem's path data still exists as a string
    inside the bundle because it is upstream source we do not patch — it is never rendered, and an
    unrendered string is not branding.
  - **Unbuilt controls are hidden, not no-op'd** (M1.6's open choice): a visible button that does
    nothing is exactly what the governing principle warns against. `hideUnbuiltControls` marks the pen
    (M4) and both `addToObsidian` buttons (M2) via the aria-labels upstream gives them, read back
    through the same `getMessage` that rendered them, so it tracks upstream's strings rather than
    hardcoding English. The clip dropdown and the `Aa` panel's "Settings" row (which opens the
    *extension's* options page) go by CSS, their classes being unique. **The toolbar in M1 is
    therefore TOC + `Aa`, both fully working.**
- **M1.6 — Injection and the reader toggle. DONE (2026-09-01).** On `onPageFinished`: inject the
  bundle (idempotent — upstream already guards with `obsidianReaderInitialized`; B3 saw github fire
  `onPageFinished` four times for one navigation and the guard held). **Do not toggle automatically
  (D24).** The page renders normally and the shell offers a "Reader" toggle; `__clipper.toggle()`
  runs when Johan taps. A too-early tap is recovered with the shell bar's **Reload** → wait → tap
  **Reader** again; re-extract cannot exist, and D26 holds the receipts. Unbuilt toolbar controls
  are hidden, not no-op'd — settled and implemented at M1.5.

  **The settle problem does not go away, and a tap does not solve it.** B3 measured the YouTube
  transcript absent at a 6 s settle and present at 15 s. Realistic tap latency — see the page, find
  the button, press it — is roughly 2–5 s, i.e. *below* the value already known to fail. So a
  user-triggered toggle buys less time than it appears to, and on a fast tap YouTube will still
  extract without its transcript. **The exact threshold between 6 s and 15 s is deliberately left
  unmeasured** (Johan, 2026-09-01): it is a function of network conditions, device power and YouTube's
  own latency, so a number measured on one setup would not generalise and would invite building
  against it. Do not re-propose narrowing it — the 6 s/15 s bracket is all the precision this needs.
- **M1.7 — Fixture harness. DONE (2026-09-01).** `test/extraction.test.ts` runs Defuddle over five
  captured pages and snapshots the result; `test/fixtures/README.md` records how each was captured
  and what it cannot prove. 52 tests across 6 files (as of 2026-09-01).
  - **jsdom, not linkedom.** Defuddle needs more DOM than linkedom provides, and upstream's own
    DOM-dependent tests declare `@vitest-environment jsdom` for the same reason. linkedom stays where
    it suffices — the bundle tests, which only evaluate and probe.
  - **Upstream's `highlighter.test.ts` and `highlighter-overlays.test.ts` now run in our harness**,
    aliased to *our* shim rather than upstream's mock, which required teaching `vitest.config.ts` to
    serve `virtual:assets` (the shim imports it; `build.mjs` supplies it via an esbuild plugin, so
    without this the shim cannot be imported outside a bundle at all). 14 upstream tests, guarding M4
    before it is built and first to break if a bump reworks the highlighter.
  - **Fixtures are `curl` captures with the app's UA, and that bounds them.** github's shadow DOM is
    simply not in the bytes — 0 `attachShadow`, 0 declarative `<template shadowroot>` — because the
    live page attaches its roots from script. **B3's shadow-DOM finding cannot be reproduced by any
    `curl` fixture** and stays a device-only check.
  - **Correction to a B3 reading: the YouTube transcript is in the server HTML.** Defuddle's
    `YoutubeExtractor` parses it out of the inline player JSON, not the rendered page, so a capture
    with no JavaScript executed yields title, author, embed *and* the full transcript — the fixture
    guards the transcript path properly. What this does **not** overturn is B3's measurement (absent
    at a 6 s settle, present at 15 s): both are true, so whatever governs the timing is a property of
    the live WebView, not of when the transcript data arrives. That mechanism is **not identified**,
    and nothing here changes D26 — Reload remains the recovery.
  - **Two flakes were found and fixed while building it**, both worth naming because a harness that
    fails at random is worse than no harness. (1) Each suite rebuilt the bundle to the *same* scratch
    path and vitest runs files in parallel, so a suite could read a half-written bundle — the build
    moved to a `globalSetup` that runs once. (2) Defuddle takes ~4.3 s on the 864 KB apnews fixture
    against vitest's 5 s default timeout, and a loaded machine tipped it over; `testTimeout` is now
    30 s. Both surfaced as an intermittent whole-suite skip.
  - **The hostile fixture is a real page, and its failure shape matters.** Instagram served to a
    logged-out client gives Defuddle a title, `wordCount` 0, and ~22 KB of markup containing not one
    readable character. **So M2.5's bookmark fallback must trigger on empty *text*, never on an empty
    content string** — that check would not fire here.
- **M1.8 — Foldable pass. DONE (2026-09-01), by Johan on the device.** Fold and unfold mid-article
  "worked perfectly": the `configChanges` declaration (`orientation|screenSize|screenLayout|
  smallestScreenSize|keyboardHidden|density|uiMode`) keeps the activity from being recreated, so the
  WebView and the rendered reader survive the fold intact.

  The pass turned up two defects that had nothing to do with folding, both since fixed:
  - **Dark mode had no effect on the app at all** — and it was three independent omissions from
    M1.2, not one: `themes.xml` hardcoded `Theme.Material.Light` (which also sets
    `android:isLightTheme=true`, the flag WebView reads to decide whether a page may go dark); both
    activities called bare `MaterialTheme { }`, which silently means `lightColorScheme()` always;
    and the WebView never opted into algorithmic darkening, so it reported
    `prefers-color-scheme: light` regardless of the system. Fixed with a `values-night` theme, a
    `ClipperTheme` composable, and — at first — `setAlgorithmicDarkeningAllowed`. **That third part
    was wrong and is reversed by D29**: it fixed the reader and broke every raw page whose dark
    support WebView cannot detect. M5.2's original instinct to keep darkening off was right; what it
    lacked was the other half, telling the reader the theme directly.
  - **"The clipper closes when I switch apps"** — see the M1.1 trap above. Not a crash: the process
    was still alive; the task was merely excluded from Recents and therefore unreachable.
  - **YouTube looked badly rendered before the reader is toggled, and this one is not a bug of
    ours.** A debug layout probe (`ClipperBundle.LAYOUT_PROBE_JS`, logged under `Reader` — the same
    discipline as B3's probe) reports `innerWidth 350`, `dpr 3.25`, `scrollWidth 350` against
    `clientWidth 351`: nothing overflows. **The cover screen is simply 350 CSS px wide**
    (1140 physical ÷ 3.25), where most phones report 390–430, and YouTube's own title element clips
    itself at that width — Chrome on this screen does the same. Two guesses were wrong on the way
    here (`useWideViewPort`, then deferred `loadUrl`), which is why the probe exists now.
    `useWideViewPort`/`loadWithOverviewMode` were set anyway and kept: a WebView that ignores a
    page's `<meta viewport>` is wrong regardless of whether it caused this.

  Also added while chasing that one, and worth keeping although it was **not** the cause:
  `onRenderProcessGone` is now handled. A client that does not override it lets the framework kill
  the *app* process when the renderer dies, which looks exactly like a crash and leaves no Java
  stack trace. It now shows the error pane with Reload instead.

### Acceptance

Status as of 2026-09-01. Boxes are ticked only where the thing was actually observed, not where it
is merely believed to work.

- [ ] Sharing from Chrome, Firefox, and the YouTube app opens the reader on the shared page.
  *Partly: the share path is exercised constantly via `just share` (a real `ACTION_SEND` intent), and
  Johan has shared from a browser. Not yet tried from all three apps' own share sheets — ColorOS
  ordering means the app may need pinning in the sheet first (§14).*
- [x] Reader matches screenshot 1: typography, TOC button works, toolbar present (unbuilt buttons
  handled per M1.6), no Obsidian gem icon. *Verified on device; the toolbar is TOC + `Aa`, the rest
  hidden until their milestones (M1.5).*
- [ ] YouTube watch page shows the transcript in reader when available (upstream `reader-transcript.ts`).
  *Guarded by a fixture (M1.7) but **not re-verified on device** since M0's B3 run.*
- [ ] Cookies persist across app relaunches (visit a login-walled site, relaunch, still signed in).
  *The plumbing is in (`setAcceptCookie`, third-party cookies, `flush()` in `onPause`) but has never
  been exercised against a real login.*
- [x] Fixture suite green; `npm run verify` proves the committed bundle matches sources. *52 tests,
  6 files as of 2026-09-01; `jsverify` exits 0.*
- [x] Foldable pass (M1.8) holds. *Johan, 2026-09-01: fold/unfold mid-article works perfectly. The
  two defects the pass surfaced were unrelated to folding and are fixed — see M1.8.*
- [x] **GATE G1:** Johan reads a few real articles and rules the reader good enough to build on.
  *Passed 2026-09-01 — recorded in §2. The three unticked boxes above carried through the gate
  deliberately; they are background checks for M2's device work, not blockers.*

## 8. M2 — Clip & Save (v1)

**Rewritten 2026-09-01 under D31.** This section used to describe building a Compose clip sheet and
porting the save recipe into Kotlin. Both were reimplementations of code the submodule already
contains, and M2.0 proved that code runs on our shim (§2). The milestone is now about *hosting* it.
The Kotlin here is plumbing; the clipper is upstream's.

### Tasks

- **M2.1 — UI WebView on our own origin.** A second WebView served by `WebViewAssetLoader` from app
  assets, hosting upstream's `popup.html` / `side-panel.html`. This is the `chrome-extension://`
  analogue: our origin, our CSP, so nothing a page sends can refuse our stylesheets or scripts.
  `build.mjs` grows entries for the UI pages beside the existing page bundle (upstream's own
  `webpack.config.js` already declares them, so the entry list is a transcription). Add `androidx.webkit`
  — not currently a dependency — for `WebViewAssetLoader`.
- **M2.2 — Background responder + message routing.** Our own small module answering the ~15 actions the
  clip and settings paths send (`getActiveTab`, `getTabInfo`, `sendMessageToTab`, `openObsidianUrl`,
  `openOptionsPage`, `fetchProxy`, the fire-and-forget notifications). **Upstream's `background.ts` is
  not ported — D31.** `browser.tabs` is backed by the single page WebView. Kotlin routes
  `sendMessageToTab` across the two WebViews; M2.0 faked this hop with a same-origin iframe, so this is
  the first place the spike's result is genuinely re-tested.
- **M2.3 — Save, via upstream.** `saveToObsidian()` builds the URI; `openObsidianUrl` reaches
  `window.open('obsidian://…')`; `ReaderWebViewClient.shouldOverrideUrlLoading` (which does not exist
  yet) catches non-`http(s)` schemes and fires `startActivity`. No `ObsidianUri.kt`, no `SavePipeline.kt`.
  Two things M2.0 found that this task owns:
  - **Back `copyToClipboard` with Kotlin's `ClipboardManager`, or make its failure loud.** Upstream's
    `tryClipboardWrite` silently reroutes to a full `content=` URI when the clipboard write fails —
    D2 forbids exactly that. Measured in the spike, not hypothesised.
  - **Handle `onCloseWindow`.** Upstream's popup calls `window.close()` after a successful clip.
    Dismiss the UI WebView on it, or the sheet is left dead on screen.
  Behaviour flags are executed as written (D30) — upstream already does this; do not add a prompt.
  A3's landmine still stands: **note content must never enter saved instance state**, at any size.
- **M2.4 — First-run setup.** The one genuinely app-level screen: vault name (must match Obsidian's
  exactly) and default folder. *Upstream's `settings.html` already has a Vaults field and a default-folder
  setting, so this is a first-run convenience over upstream's store, not a parallel one.* `SafWriter`
  and the tree-URI plumbing stay deferred (D18).
- **M2.5 — Bookmark-only fallback (D13).** **The one clip feature upstream does not have** — verified,
  zero hits for "bookmark" in `src/`. When extraction yields nothing usable, offer a one-tap bookmark
  clip: frontmatter (title, source, created, tags) + URL, no body. **Trigger on empty *text*, never on
  an empty content string** — M1.7's Instagram fixture returns markup with no readable character.
- **M2.6 — Sweep the surfaces we do not want.** Upstream's popup ships eight actions; three go, using
  M1.5's existing `data-clipper-unbuilt` mechanism: `embedded-mode` (toggles popup-vs-iframe; we have
  only one context), `reader-mode` (duplicates the shell bar's toggle — two controls for one state
  will eventually disagree), and `interpreter` (fully built, needs an API key and paid calls; it is
  `display:none` until enabled, so it costs nothing to carry switched off). **Everything else stays** —
  `show-variables`, `saveFile`, `share`, `copyToClipboard`, and the settings link.
- **M2.7 — Shim gaps.** `browser.commands.getAll` (settings' Hotkeys section) and `getHighlighterMode`.
  `storage.onChanged` and `runtime.onUpdateAvailable` were already fixed during M2.0.

### Open, not decided

- **CSP stripping on the page WebView.** Intercept the main document in `shouldInterceptRequest`, refetch
  it, and return it without `Content-Security-Policy` headers. This is as close to an extension's
  isolated world as Android allows: it would make D20 and D21 belt-and-braces instead of load-bearing,
  and it is the **only** known fix for `flatten-shadow-dom.js` being refused by GitHub's `script-src`
  (G0/B3). Cost: we own redirects, content-encoding, and cookie parity between OkHttp and
  `CookieManager` — and cookies are already an unticked M1 box. **Do this after M2.1–M2.3 land; they are
  independent.**

### Acceptance

- [ ] Upstream's clip sheet opens over a live page in the app and populates from that page's extraction
  (not a fixture — M2.0 only proved the fixture case).
- [ ] Article, YouTube page, and extraction-hostile page all land in the vault correctly (the last as a
  bookmark note).
- [ ] Note name, folder, properties, and body edits in the sheet are reflected in the saved note.
- [ ] Re-clipping the same URL respects the template behavior (A4 semantics); a template with
  `overwrite=true` replaces the note in place, unprompted (D30).
- [ ] A very large note (>512 KB) saves via the clipboard path; with clipboard artificially disabled the
  failure is **reported**, not silently rerouted to `content=` (D2 — M2.0 measured the silent reroute).
- [ ] The sheet closes cleanly after a save (`onCloseWindow`) and the app returns to the page.
- [ ] Backgrounding the app mid-clip with a large note does not crash it — note content stays out of
  saved instance state (G0 landmine).
- [ ] Second clip started from the share sheet while Obsidian is foregrounded works (round-trip focus).
- [ ] `settings.html` opens from the sheet and its Reader/Properties sections work against the shim.
- [ ] Carried from M1 through G1 (§7): sharing from Chrome's, Firefox's and the YouTube app's own share
  sheets; the YouTube transcript in reader on device; cookies surviving a relaunch against a real login.
  Observe opportunistically during M2's device work.

## 9. M3 — Templates (v1)

**Rewritten 2026-09-01 under D31 — most of this milestone arrived with M2.** M2.0 brought up upstream's
template editor under our shim: template name, triggers, the Behavior dropdown, `{{title}}` note-name
formatting, and JSON Export/Import, all working (§2). `core/popup.ts` already imports
`findMatchingTemplate`, `template-manager`, `template-compiler` and `property-types-manager`, and the
spike watched the filter chain `{{author|split:", "|wikilink|join}}` render as `[[Steph Ango]]` from a
real page. **There is no template store, no importer, no management UI and no editor to build.**

### Tasks

- **M3.1 — Verify auto-selection on device.** `matchTemplate` runs inside upstream's popup already;
  confirm a trigger URL preselects the right template on the Find N6 and that the manual override wins.
- **M3.2 — Import path on Android.** Upstream's `showTemplateImportModal` expects a desktop file picker.
  Check what it does in a WebView; if it needs help, wire SAF to it — **do not** write a parallel
  importer. Paste-JSON already works and may be enough.
- **M3.3 — Daily-note behaviors.** `append-daily`/`prepend-daily` route to `obsidian://daily?` per §3.
  Upstream implements this; test it with a template that uses it.
- **M3.4 — Bundle Johan's defaults.** Ship his real templates as the initial store so a fresh install is
  useful before any import.

### Acceptance

- [ ] Johan's real desktop templates import cleanly and auto-select on their trigger URLs.
- [ ] A YouTube link picks the video template (if imported); unknown sites fall back to default.
- [ ] Template filters/variables produce identical output to desktop for one shared test page (compare
  the two notes).
- [ ] Editing a template in the app's own settings page persists across a cold relaunch.
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
- **M4.2** ~~Storage shim policy per D8: highlights live in-memory per reader session.~~ **Reconsider at
  M4's start (D31/D8, 2026-09-01):** upstream's `highlights-manager.ts` already implements persistence
  and the storage shim already backs it, so the in-session rule now costs more to enforce than to drop.
  The pen itself is one `data-clipper-unbuilt` attribute away in `bundle-entry.ts`.
- **M4.3** Wire highlights into `clip()` so the template's highlights variable populates the note;
  verify against a fixture.
- **M4.4** Acceptance: highlight three passages on the Find N6 (touch selection, both displays), clip,
  see them in the note; leaving the reader discards them (D8).

## 12. M5 — Reader style settings (post-v1)

**Delivered by M1.3 (2026-09-01). There is no UI left to build here.**

Screenshot 2 *is* upstream's `Aa` panel — Johan's correction, 2026-09-01. Problem & UI Reference's
legend says so ("the *Reader* style sheet at the bottom of the screen: font size, colour and
similar"), and M5.1 has said so since this playbook was written; a session reading "sheet" as a
bespoke design of ours got it wrong and the correction is recorded here so it is not re-derived.

The panel works in our WebView — font size, width, line height, appearance, theme and font — and now
persists, because `Reader.saveSettings` writes `reader_settings` through the bridge into
SharedPreferences. Verified on the Find N6 across a cold relaunch. **What remains is M5.2 alone, and
it is a check for a defect rather than anything to build.**

- ~~**M5.1** Enable the Aa button; screenshot 2's sheet is upstream UI (`reader-settings.ts`) — it
  should work once `storage` round-trips through SharedPreferences.~~ **Done at M1.3**, exactly as
  predicted: the sheet is upstream's, and it started persisting the moment storage reached
  SharedPreferences. Font size, width, spacing and theme all apply and survive a cold relaunch.
- ~~**M5.2** Theme interplay: reader dark/light/auto vs. the app's own theme and Android's
  algorithmic darkening (keep darkening off for the reader WebView; the reader owns its colors).~~
  **Done at M1.8 (2026-09-01).** Dark mode did nothing at all until then — three omissions, listed
  under M1.8. **This task's instinct to keep darkening off was right, and a first attempt that
  enabled it was reversed the same day — see D29.** Allowing it does make the reader's dark CSS
  engage, but it machine-darkens any raw page whose dark support WebView cannot detect, which is how
  a readable light page became unreadable. The reader is told the app's theme directly instead.
  **M5 is now closed entirely.**
- **M5.3** Acceptance: set a non-default style, kill the app, share a new link — style stuck.
  **Met on 2026-09-01** (fontSize 16 → 18, verified across a force-stop).

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
case-only filename distinctions. The committed bundle is the production build (D28), so a local
`just jsbuild-debug` must be rebuilt with `just jsbuild` before committing. `.gitattributes` from P0.1 handles line endings; on Windows also
`git config core.longpaths true` before cloning (deep submodule paths). Android builds never require
Node (committed bundle); touching `jsbridge/` requires running `npm run build` and committing the
asset in the same commit — `npm run verify` is the honesty check.

**Submodule bump procedure.** (1) Read upstream diff since the pin, especially `src/utils/reader*`,
`highlighter*`, `api.ts`, `obsidian-note-creator.ts`, `build-api.mjs`, **and — since D31 —
`core/popup.ts`, `core/settings.ts`, `managers/template-*`, `content.ts` and `background.ts`'s message
contract**; (2) bump the pinned commit; (3) `just jsbuild`; (4) `just jstest` — this proves *our*
shim still answers what upstream asks of it (D14), and upstream's own `highlighter.test.ts` /
`highlighter-overlays.test.ts` run against our shim, catching Layer B drift; (5) manual smoke on
device: share → read → **open the clip sheet → open settings → edit a template** → clip. **This step
is not optional and got longer under D31**: nothing automated covers upstream's UI, and the fixtures
are `curl` captures that cannot see anything a page's script builds (github's shadow DOM is absent
from them entirely; see `test/fixtures/README.md`). A new action appearing in upstream's background
contract shows up here as a `[bg] UNHANDLED action:` warning, so watch the log during the smoke pass;
(6) commit submodule ref + rebuilt bundle together, noting the new pin in §Pinned upstream.

Two contracts a bump can break silently, both guarded by tests rather than by reading:
`test/bridge.test.ts` is the executable spec for `AndroidBridge.kt`, and `bundle.test.ts` asserts the
inline-CSS ids upstream guards on (D20) and the branding sweep's anchor (M1.5).

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
| Upstream drift breaks extraction or highlighter on bump | Pinned submodule; upstream's own tests in our harness; §14 procedure. **Extraction-quality snapshots dropped (D14, 2026-09-01)** — defuddle's output legitimately shifts per release and shows up as a template property coming up empty, which is the nature of web clipping rather than a regression to pin | Accepted |
| **Upstream drift breaks the clipper *UI* on bump (D31)** | Nothing automated covers this — accepted with eyes open. Mitigation is the pin itself plus a manual pass over the clip sheet and settings page after any bump; §14's procedure gains that step | — |
| Sites block the WebView UA or bot-detect | Chrome-mobile UA (M1.2), cookie persistence, bookmark fallback (M2.5). **No browsing/login UI to fall back on — D23**, so a hard-blocked site is accepted as a bookmark clip | M2 |
| SPA/JS-heavy pages extract poorly | Tap the reader once the page has settled; recover a too-early tap with Reload → wait → tap again (D25/D26). Bookmark fallback for pages that never extract | M1/M2 |
| Intent URI size limits truncate `content=` saves | A3 measured no truncation up to 512 KB; oversized fails loudly, never silently | M0 |
| Windows dev friction (paths, EOL, drivers) | §14 parity rules, P0.1 gitattributes, P0.3 driver note | Phase 0 |
| Obsidian changes `obsidian://` behavior | Recipe lives in upstream's `obsidian-note-creator.ts` (D31 — no `ObsidianUri.kt` any more) + §3 documents the contract. Accepted single point of failure per D18 — notes are plain markdown in a folder Johan controls, so recovery is manual but never data-loss | — |

## 16. UI inventory — every visible element has one owner

| Element (screenshot) | Owner |
|---|---|
| Shell bottom bar — `Reader` toggle, `Reload` (D25; no screenshot — post-dates them) | M1 |
| Shell bottom bar — `Clip` (D25) | M2 |
| Reader typography, layout, TOC button (1) | M1 |
| Highlighter pen button (1) | M4 |
| Copy/save popup button (1) | Renders M1; both actions are upstream's under D31 — M2 only backs `copyToClipboard` with Kotlin's ClipboardManager (§2's silent-fallback finding) |
| Aa reader-style button (1) + the style sheet it opens (2) | **Done at M1.3** — both are upstream's own panel, persisted through the bridge. Nothing left in §12's M5 but the M5.2 theme check |
| Clipper button — gem replaced (1) → clip sheet (3) | M2 — opens upstream's `popup.html` (D31) |
| Template dropdown w/ auto-select (3) | **Upstream's**, working since M2.0; M3 verifies on device |
| Properties editor, body editor, note name (3) | **Upstream's**, working since M2.0 (D31) |
| Vault selector (3) | **Upstream's** — `settings.html` has a Vaults field; D9 still means one vault |
| Folder field (3) | **Upstream's**, working since M2.0 |
| "Add to Obsidian" (3) | **Upstream's**; Kotlin only catches the `obsidian://` intent (M2.3) |
| Settings page + template editor (no screenshot) | **Upstream's** `settings.html` — retires D16 |

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
