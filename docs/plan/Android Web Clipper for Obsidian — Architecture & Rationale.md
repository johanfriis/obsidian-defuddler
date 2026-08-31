# Android Web Clipper for Obsidian — Architecture & Rationale

**What this document is for.** The *why* behind the architecture: what upstream actually ships (as
researched against the pinned checkout), why the app is a three-layer hybrid rather than a web wrapper,
and the reasoning behind decisions the [Build Playbook](<Android Web Clipper for Obsidian — Build Playbook.md>)
only states. Playbook **D3** points here.

**It is not a plan and not a spec.** Anything operational — milestones, repo layout, the save recipe,
licensing obligations, acceptance criteria — lives in the Build Playbook and is *deliberately not
duplicated here*, because keeping two copies in sync is how they drift apart. Pointers at the bottom.

For the problem statement, scope guard and screenshot legend, see
[Problem & UI Reference](<Android Web Clipper for Obsidian — Problem & UI Reference.md>).

## Context

Johan wants a frictionless, one-link-at-a-time way to move a page from Android into his Obsidian vault,
with the same quality of experience as the official desktop Web Clipper: clean reader view,
highlighting, editable properties, template-driven notes. Browser extensions fail on Android because
they depend on the browser relaying `obsidian://` to the OS — an inconsistently implemented handoff. A
dedicated app receives the share intent itself and fires the intent as a first-class app.

The outcome: an app that appears in the share sheet, opens the shared link in a full reader view, lets
Johan highlight and adjust metadata, and clips into his vault via `obsidian://new`.

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

## Why the WebView needs its own login story

The WebView has its own cookie jar, so paywalled and logged-in pages will not match what Chrome showed. Mitigations, all in Layer C:

- `CookieManager.setAcceptCookie(true)` + `setAcceptThirdPartyCookies`, `flush()` on pause — cookies persist across launches.
- Override the User-Agent: the WebView default contains `; wv`, which some sites block. Use a plain mobile Chrome UA.
- A "Sign in to this site" action that drops out of reader mode into the live page with normal browser chrome, so Johan can log in once per site.
- Graceful failure: if defuddle finds nothing usable, show the raw page and offer a bookmark-only clip (frontmatter + URL, no body).

## Where everything else lives

Deliberately not duplicated here — the Build Playbook is authoritative for all of it:

| Looking for | Go to |
|---|---|
| Flow diagram (share → reader → clip → save) | Playbook §4 |
| `obsidian://` URI recipe and upstream receipts | Playbook §3 |
| Save pipeline, fallback behaviour, why no SAF | Playbook M2.3, **D2**, **D18**, and the G0 findings in §2 |
| Repository layout | Playbook §4 |
| Milestones and acceptance criteria | Playbook §5–§13 |
| Licensing obligations and trademark carve-out | Playbook §17, **D15** |
| Dev loop (`just`), toolchain, device setup | Playbook §5 |
| Verification commands, WebView debugging, submodule bumps | Playbook §14 |

*Historical note:* this document previously carried its own milestone list, repo layout, save-pipeline
steps and licensing section. All were duplicates of the playbook, and when D2 changed on 2026-08-31
every one of them had to be edited in lockstep to avoid contradicting it. They were cut for that
reason, not because the content was wrong.
