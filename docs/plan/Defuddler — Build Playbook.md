# Defuddler — Build Playbook

An Obsidian plugin that reads a URL, runs it through Defuddle, applies a template kept in the vault,
and writes the note. Clipping happens **inside Obsidian**, on desktop and on mobile.

This is the live, step-by-step guide and **the authoritative document** — milestones, acceptance
criteria, decisions, and the dev loop all live here. It supersedes the Android playbook, which stays
readable at [docs/android](../android) and on the `android-reader` branch. Where this document says
`D2`, `D31` and so on it means a decision in *that* document; this document numbers its own
decisions `P1`, `P2`, … so the two can never be confused.

**Definition of done for v1:** Johan copies a link on the phone or the desktop, runs one command,
picks a template from a list that already has the right one selected, and the note lands in the vault
shaped by that template. On the phone and on the desktop, from the same build.

## Pinned upstream (verified 2026-09-03)

| What | Pin | Notes |
|---|---|---|
| `obsidianmd/obsidian-clipper` | commit `9aa509b8f2801b08d974fb59f026df6f9a12e496` (main, 2026-08-03, "Bump deps") | MIT. Not on npm → consumed as the git submodule at `jsbridge/vendor/obsidian-clipper`. |
| `defuddle` | `0.19.3` | MIT. Upstream declares `^0.19.2`. |
| Obsidian | `1.14.0` on this machine (insider) | The app self-updates its asar without touching `Info.plist`, so the bundle reports a stale `1.8.10` — read `~/Library/Application Support/obsidian/obsidian-*.asar` for the truth. `minAppVersion` is `1.13.0`; see P5. |
| `obsidian` npm types | `1.13.1` (latest published) | Behind the insider app, which is normal and harmless. |

Bumping either pin runs the extraction harness first (§14) — never casually.

---

## 0. How to use this playbook

- Work proceeds milestone by milestone; each is a numbered task list plus an **acceptance checklist**.
  A milestone is done when every box is checked on real hardware, phone included.
- **`GATE` markers are stop points.** Work pauses and Johan decides, with the options and trade-offs
  listed at the gate. Outcomes are recorded in §2 so later sessions don't re-litigate.
- This is a living document. **Corrections collapse the text to current truth, with a dated pointer at
  the decision that changed it — not strikethrough archaeology left in place.** Git is the archive;
  where superseded text might be wanted again, name the commit that holds it. The audience is the next
  agent session, which pays for every dead line it has to parse.
- A fresh session reads §1 (decisions), §2 (gates), §3 (upstream ground truth), and its milestone.
- **Where things stand (2026-09-04). Phase 0 and M0 are done; G0, G1 and G3 are closed.** The plugin
  builds and loads on both platforms, the clip engine is ours (G3) and proven against every fixture,
  and the extraction harness is hermetic. What does not exist yet is any of the product: no command,
  no templates, no settings, no save path. **The next thing to do is M1.**

  Read G3 before touching `src/clip.ts` — it is the largest decision in this document and the reason
  that file exists at all.

## 1. Decisions log

### Governing principle — defer to the human

*Carried over from the Android playbook, where Johan stated it on 2026-09-01. It outranks the table
below where they conflict.*

**When the machine could decide or the human could, the human decides.** Prefer an action the human
takes over a default the machine applies; prefer leaving them in front of a working result over
dropping them into a broken state they must escape; prefer surfacing a failure over silently choosing
a different route.

It has already shaped three decisions here: P4 (the matched template is *preselected*, not applied),
P8 (a clipboard read that fails opens a prompt rather than aborting), and P10 (extraction that yields
nothing still opens the template picker).

### Decisions

| # | Decision | Rationale |
|---|---|---|
| **P1** | **One source: fetch the URL with `requestUrl()`. No webview, no iframe, on any platform.** | The premise that mobile needs a rendered DOM does not survive the evidence already in this repo. `jsbridge/test/fixtures/` are `curl` captures — server bytes, no JavaScript ever executed — and `extraction.test.ts` passes against them: stephango 13,584 chars with title/author/1400+ words, github 6,328, apnews 3,901, youtube 2,780 **including the full transcript**, instagram nothing. Four of five, and the transcript survives because Defuddle's `YoutubeExtractor` reads inline player JSON rather than the rendered page. The rendered DOM buys exactly one measured thing: github's shadow DOM. That is not worth a second code path in v1. Reversible and *additive* — see P2's note and §13. |
| **P2** | **Clipping happens inside Obsidian; notes are written with the vault API.** ~~…so that on-create automations fire.~~ **Narrowed by Johan, 2026-09-04: on-create automations are an outdated requirement and are out of scope.** | This is still the whole reason to pivot, and it retires `D2`, `D18` and `D36` outright — no `obsidian://new`, no clipboard as transport, no size ceiling, no foregrounding, and the note enters the index as it is written. What it no longer claims is that Templater's on-create trigger fires, which was `G0/A5`'s finding turned into a benefit. **That leg is gone and the decision does not need it**: everything above is independent of it, and so is the fact that one build serves desktop and phone. It does mean the plugin-over-app case is one leg shorter than P1's write-up implied — worth knowing, not worth re-litigating. ~~**Cost:** `D2` credited the URI with dedup/append/overwrite for free, and that credit is a debt.~~ **Retired 2026-09-04 with M4** — Johan wants only `create`, so five of the six behaviours were never owed. What the URI did give us free and we do now write is deduplicating a colliding note name, and that is eight lines. |
| **P3** | **Upstream's engine is what we build on. We ship none of its UI. ~~We consume `api.ts`; we do not fork it~~ — narrowed by GATE G3 on 2026-09-04: its `clip()` wrapper is unusable in a browser and is reimplemented in `src/clip.ts` over the same helpers. The helpers, the template compiler, the filters and the frontmatter generator are still upstream's, untouched.** | `api.ts` is upstream's own environment-agnostic entry point: `clip({html, url, template, documentParser})` plus `matchTemplate()`. It is the entire clip pipeline with no `browser.*` in its import graph (§3 lists the 70 files it does pull). This is what makes the pivot cheap, and it is the opposite of `D31`, which hosted upstream's *extension* — that decision bought a UI and paid for it with the polyfill shim, two WebViews, a message router and bundle injection. Here we buy only the engine and build our own small UI, because Obsidian already gives us modals, settings and a command palette. |
| **P4** | **Templates are markdown files in the vault, in a configurable folder. `matchTemplate()` preselects; the human confirms.** | In-vault means editable and syncable anywhere, with no separate store to keep in step. Preselect-don't-apply follows the governing principle, and matches `M3.3` in the old playbook. The file format is settled in **GATE G1** — markdown, with the note's frontmatter in a fenced block and its types taken from the vault. |
| **P5** | **Settings live in Obsidian's settings tab, declared with `getSettingDefinitions()`. No `display()`. All persisted state sits inside `plugin.settings`.** | **Corrected in Phase 0, 2026-09-03.** This decision first read "built with `display()`", on the belief that Obsidian here was 1.8.10 and that the declarative API did not exist yet. Both halves were wrong: the version came from a stale `Info.plist`, and the machine is on 1.14.0. With `minAppVersion` at 1.13.0 the linter's rule is to implement the definitions and *delete* `display()`, since a non-empty definition list bypasses it anyway. The single-blob rule is unchanged and still matters, because Obsidian's auto-persist clobbers sibling keys written with `saveData()`. |
| **P6** | **Distribution is BRAT only. No community-plugin submission.** | Personal tool, same call as `D34`. Consequence: the community scanner's Scorecard is *guidance*, not a gate. We follow its rules where they are cheap and right (no `fetch()`, sentence case, `registerDomEvent`, no `!important`) and skip the submission ceremony. If that ever changes, the name and the ESLint pass are the two things to revisit. |
| **P7** | **The plugin is named Defuddler, id `defuddler`.** | Clears Obsidian's naming rules: no "Obsidian" in it, does not start with "Obsi", does not end with "dian". It does borrow kepano's library name, which reads faintly official — acceptable for a BRAT-only personal tool per P6, and a reason to rename before any submission. |
| **P8** | **The clipboard is a prefill, never a requirement.** | `navigator.clipboard.readText()` is the shakiest API in this design on mobile: iOS WKWebView gates it behind a user gesture and can throw or prompt. So the command always opens a prompt with the URL field filled in when the read worked and empty when it didn't. This is `D36` learned from the other side — a clipboard failure must be visible and recoverable, not silent. |
| **P9** | **`obsidian://clip?url=…` ships in v1.** | It is a handful of lines via `registerObsidianProtocolHandler`, and it is the seam every future entry point plugs into: a share-target app, a bookmarklet, a shortcut. Shipping it in v1 costs almost nothing and stops the URL parsing from being retrofitted later. |
| **P10** | **Extraction that yields nothing is not an error.** | The Instagram fixture is the case: Defuddle returns a title and zero words. The picker still opens, the template still applies, and what lands is a note with frontmatter and no body. `D13` reached the same place by a different route — a bookmark clip made by hand is still a bookmark clip — and the governing principle forbids dropping the human into a dead end. |
| **P11** | **The reader view is out of scope for v1.** | Option 2 from the pivot conversation. Its value is preview and highlight-to-clip, **not** better extraction, because its input is still the fetched HTML. Upstream's own reader is 2805 lines of `browser.runtime`/`browser.storage` and must not be ported — see §13. |

## 2. Gate outcomes

### Phase 0 measurements — 2026-09-03, build machine

| What | Value |
|---|---|
| `main.js`, minified, engine included | **831 KB** |
| Predicted in §3 fact 2 before the build | ~820 KB |
| Extraction harness | 6 tests, green, snapshots unmoved across the move and a vitest major bump |
| Typecheck | clean in our code; 16 diagnostics inside `vendor/`, counted and ignored (they are upstream's, under a newer TypeScript than upstream targets) |

831 KB is the number M0's S3 judges mobile startup against. The Defuddle dedupe is spent — it was
worth 320 KB of a 1,151 KB build — so there is no easy lever left if the phone objects.

### S1 findings — fixture parity — 2026-09-04, desktop Chromium and Node

**S1 passes. P1 holds.** All five fixtures extract identically through a real detached `DOMParser`
and through the jsdom harness, once Defuddle is given a fetch that is not CORS-bound.

| Fixture | jsdom snapshot | Real `DOMParser` | Parse |
|---|---|---|---|
| stephango | 13,584 chars | 13,584 | 93 ms |
| apnews | 3,901 | 3,901 | 534 ms |
| github | 6,328 | 6,328 | 171 ms |
| youtube | 2,780 | 2,780 | 826 ms |
| instagram | 22,221 | 22,221 | 343 ms |

The layout question that motivated S1 turned out not to matter. The same bytes in an *attached*,
laid-out document inside an iframe gave the identical result, so Defuddle's `getComputedStyle` calls
cost nothing on a document with no layout. Those timings are the desktop baseline S3 compares the
phone against.

**What S1 actually found, which was something else entirely.** The YouTube transcript is not in the
fixture's bytes and never was. Defuddle fetches it from YouTube's API during `parseAsync` — a POST
to the innertube endpoint, then a GET for the caption track — and the inline-JSON parse that the
fixture README credited throws a `SyntaxError`. Measured three ways, all agreeing:

| Environment | chars | words | transcript |
|---|---|---|---|
| Node + jsdom, network on | 2,780 | 506 | yes |
| Node + jsdom, `fetch` rejects | 262 | 0 | no |
| Browser, renderer's global fetch | 262 | 0 | no |
| Browser, fetch proxied CORS-free | 2,780 | 506 | yes |

Two consequences, both acted on:

1. **The harness was silently network-dependent**, which is the opposite of what a bump guard is
   for. Every test now runs with a fetch that refuses, and the transcript has its own test that opts
   back in and skips when offline. Only YouTube was affected — the other four were verified hermetic
   rather than assumed to be.
2. **The plugin must hand Defuddle a CORS-free fetch**, or it loses everything the site extractors
   fetch. `requestUrl` is exactly that and works on mobile. `src/fetch.ts` implements it and the
   proxied-browser row above proves the mechanism. Wiring it is blocked on **GATE G3**.

### GATE G3 — how to give Defuddle its options — CLOSED (2026-09-04)

**Johan chose Option A, and explicitly ruled out the upstream PR.** `src/clip.ts` now reimplements
the wiring of upstream's `clip()`, constructing Defuddle itself. Everything else stays upstream's and
is imported, not rewritten: `buildVariables`, `compileTemplate`, `applyFilters`, `formatPropertyValue`,
`generateFrontmatter`, `sanitizeFileName`, and `api.ts`'s own two resolver factories. What is forked
is about forty lines of wiring.

While implementing it, a **third reason** turned up that outranks the two the gate was opened for.
Upstream's `clip()` hands Defuddle `doc.documentElement` where a `Document` is wanted. With a real
`DOMParser` that is a plain `HTMLHtmlElement`, and Defuddle returns nothing at all: **0 chars against
13,584 on the stephango fixture, and a note called `Untitled`.** It works for upstream's own CLI only
because linkedom's `documentElement` is document-like. So `api.ts`'s `clip()` was never usable here,
and the two original reasons — the fetch and `parseAsync` — turned out to be the smaller half of the
case.

The three reasons, all measured:

| | Upstream's `clip()` | Ours |
|---|---|---|
| What Defuddle is given | `doc.documentElement` → 0 chars | the `Document` → 13,584 |
| How it parses | `parse()`, sync → no transcript, 262 | `parseAsync()` → 2,780 |
| `DefuddleOptions` | unreachable | passed through, `fetch` included |

`test/clip.test.ts` guards all three, and its last test **pins upstream's defect**: if a submodule
bump ever fixes it, that test fails and says so.

**No PR to upstream**, by Johan's call. So the fork is permanent rather than a bridge, and a
submodule bump is the moment to re-read `api.ts` against `src/clip.ts`.

One thing the implementation turned up that M2 will need: the word-count variable is **`{{words}}`**,
not `{{wordCount}}`. Defuddle's field is renamed on the way into the template context.

### S2 findings — the pages, three days on — 2026-09-04

Re-fetched all five source URLs with the recorded user agent. Every one still answers 200, the bytes
have drifted by a few KB either way, and **extraction is identical on all five** — same character
counts, same word counts, same titles. The fixtures are still representative of the live web, which
is the question S2 was really asking.

| Fixture | Bytes then | Bytes now | Extraction |
|---|---|---|---|
| stephango | 24,500 | 24,500 | identical |
| apnews | 864,468 | 868,101 | identical |
| github | 310,265 | 310,691 | identical |
| youtube | 797,931 | 754,726 | identical |
| instagram | 608,802 | 597,562 | identical |

**S2's other half is not done.** This was curl, not `requestUrl`. Whether `requestUrl` follows
redirects the same way and whether the user-agent header we set actually reaches the server can only
be answered from inside Obsidian, and the M0 spike command below answers it.

### S3 findings — the phone — 2026-09-03, Android, and desktop for comparison

**S3 passes, and it also closes S2's remaining half.** Johan ran the spike command on both. Every
case matches its S1 baseline on both platforms, `requestUrl` works everywhere, and the phone is
barely slower than the desktop at the part we control.

| Case | Fetch (desktop → phone) | Parse (desktop → phone) | Result, both |
|---|---|---|---|
| stephango | 129 → 391 ms | 9 → 14 ms | 13,584 / 1,631 |
| apnews | 172 → 472 ms | 61 → 111 ms | 3,901 / 619 |
| github | 847 → 818 ms | 26 → 34 ms | 6,328 / 478 |
| youtube | 1,101 → 1,622 ms | 774 → 846 ms | 2,780 / 506 |
| instagram | 496 → 490 ms | 33 → 48 ms | 0 words |

Five pages end to end took 5 s on the desktop and 6 s on the phone, at 834 KB of `main.js`. The
worst single page is YouTube at about 2.5 s on the phone. **The bundle-size risk is closed.**

**The fetch finding reproduced exactly where it matters.** On both platforms, the renderer's global
fetch gives YouTube 262 chars and zero words, and the `requestUrl`-backed one gives 2,780 and 506.
Every other case is identical under either fetch, so YouTube is the whole of what the CORS-free
fetch buys — as S1 predicted.

**Two things to note rather than act on.**

- **The clipboard probe threw `There is no data on the clipboard`.** That is an empty clipboard, not
  a refusal: the call reached the API and returned a clean error. It does not yet prove a *populated*
  clipboard reads on Android, so **the one thing S3 still owes is a re-run with a URL actually
  copied.** P8's prompt fallback ships either way; this only decides how often it is the visible
  path.
- **Instagram answered differently on the desktop**: 593,275 bytes and a title of `Popular on
  Instagram` against the phone's 597,107 bytes and `Instagram`. Both extract zero words, which is the
  only property that matters here (P10), but it is a reminder that a fingerprinting site does not
  serve `requestUrl` the same page twice.

### S4 findings — the write path — CLOSED (2026-09-04)

**Most of S4 was retired rather than run.** Its central question was whether a note written with
`vault.create()` fires Templater's on-create trigger. Johan's call: on-create automations are an
outdated requirement, so P2 no longer claims that and the question is out of scope. For the record,
had it been run it would have measured nothing useful — Sanctum has a Templater folder template
mapped for `Clippings`, but both `trigger_on_file_creation` and `enable_folder_templates` are off,
so nothing fires there today however a note is created. That is also a reason to treat `G0/A5`, the
Android measurement that `obsidian://new` does not fire the trigger, as unsettled rather than as
evidence for anything here.

**What S4 did answer turned out not to be needed.** It established that daily-note resolution needs
no private API — `daily-notes.json` under `app.vault.configDir` carries `folder`, `template` and
`format` — which mattered only while the daily-note behaviours were still in scope. M4 dropped them,
along with append, prepend and overwrite, on Johan's call. Recorded here in case they ever come back;
nothing depends on it now.

### GATE G0 — the de-risking spike — CLOSED, PASSED (2026-09-04)

All four spikes are resolved and nothing they found argues against building v1 as specified.

| Spike | Outcome |
|---|---|
| S1 fixture parity | Passed. All five fixtures identical through a real `DOMParser`. **P1 holds.** |
| S2 live fetch | Passed both halves. The pages still extract identically three days on, and `requestUrl` reproduces them from inside Obsidian. |
| S3 mobile | Passed. Android matches every desktop baseline; five pages in 6 s at 836 KB. |
| S4 write path | Closed. Its central question was retired with P2's narrowing, and the rest with M4's deletion. |

What the gate cost, in the order it hurt: upstream's `clip()` turned out to be unusable in a browser
(GATE G3), the extraction harness turned out to be silently network-dependent, and the YouTube
transcript turned out to be a network call rather than a property of the bytes. All three are fixed
and recorded. None of them touched P1.

**Consequently the spike command and `src/spike.ts` are deleted.** One question it was carrying moves
rather than dies: whether a *populated* clipboard reads on Android. The probe only ever saw an empty
one, which proved the call path works and nothing more. It is not gating — P8 ships the prompt
fallback either way — and M1's first task is the real clipboard read, so it is answered there
instead.

### GATE G1 — template file format — CLOSED (2026-09-03)

**Decided by Johan.** A template is a markdown file. Its own frontmatter is the template *config*; the
first fenced block is the note's frontmatter; everything after that block is the note's body. Property
*types* are not written in the template at all — they come from the vault.

````markdown
---
name: Article
path: Clippings
noteNameFormat: "{{title}}"
triggers:
  - https://apnews.com/
---

## Template

```
title: {{title}}
author: {{author}}
source: {{url}}
published: {{published|date:"YYYY-MM-DD"}}
tags: {{schema:@Article:keywords}}
```

{{content}}
````

**Parsing rules.** The first fenced block in the file is the properties; anything before it is
decoration and is ignored, so a `## Template` heading or a note-to-self is free. Everything after that
block is `noteContentFormat`. A file with no fence has no properties and is all body.

**Split each property line on its first colon. Do not run a YAML parser over the block.** It is a
template *for* YAML, not YAML: `published: {{published|date:"YYYY-MM-DD"}}` is not a valid bare YAML
scalar, because the leading brace opens a flow mapping. Parsing it as YAML would force every
placeholder to be quoted, and a forgotten quote would misparse in silence. The fence therefore carries
no language tag, so nobody is invited to treat it as YAML.

**Why types come from the vault.** `generateFrontmatter()` emits a different YAML *shape* per type
(§3, fact 5): `multitext` becomes a real list, `number` is parsed, `checkbox` is a bare boolean, dates
go out unquoted, and everything else is double-quoted with its quotes escaped. A literal fenced block
cannot say which is which, so untyped properties all fall to the quoted-text default — valid YAML, but
`tags` as a string and dates as strings, which are the two properties that most want typing.

`clip()` takes `propertyTypes` as an option and merges it **over** the template's own types (§3, fact
5), so the types can come from outside the template entirely. Read them from the vault's property
configuration. Sanctum already types `tags`, `created`, `year` and `genre` there, and Obsidian's own
vocabulary uses the word `multitext` — the same word upstream uses — so the mapping is two aliases
(`tags` and `aliases` behave as lists) and nothing else. Types then live in the one place they are
already configured, rather than being restated in every template.

**What this beats, and what it costs.**

- Beats **JSON**, the format recommended here before Johan proposed the fence: the body is the part
  that is actually edited, and it is markdown, so it should be edited as markdown.
- Beats **plain markdown with the properties in the file's own frontmatter**: that shape puts
  `{{title}}`, `{{author}}` and `{{url}}` — the content property names Johan actually queries with
  Datacore — into the vault's property index with placeholder values. This shape does not.
- **Costs** a converter for web-clipper JSON exports, where the JSON format needed only a file copy.
  Upstream's field names are used verbatim in the config frontmatter to keep that converter close to a
  rename-free copy.
- **Costs** per-template type overrides, which are given up in favour of the vault's single answer. Two
  templates wanting different types for the same property name is a case that has not come up.
- **Residual pollution, accepted:** the four config keys (`name`, `path`, `noteNameFormat`,
  `triggers`) do enter the property index — `behavior` was one of five until M4 dropped it. `name` is
  the only one generic enough to collide with a real content property. Templates live in their own folder, so a query can exclude
  them; that is the mitigation and it is the same one any template folder needs.

### GATE G2 — v1 release — PASSED (2026-09-04)

**1.0.0 is cut.** Everything on §12's checklist is done except installing it through BRAT, which is
Johan's to do on his own devices. The dev symlinks have to be removed first or BRAT installs over
them.

What v1 is: one command that clips a URL through Defuddle into a template kept in the vault, on
desktop and on Android from one build; templates as markdown files with their types taken from the
vault; a settings tab; and `obsidian://clip` as the seam for whatever comes next.

## 3. Ground truth: upstream integration points

Everything here was read out of the pinned submodule on 2026-09-03. A session that doubts a line
should re-read the file rather than trust this table.

**`src/api.ts` — the engine, minus its wrapper.** Its own header claims to be environment-agnostic
with the caller providing a `DocumentParser`. That is true of everything it exports *except*
`clip()`, which GATE G3 measured as unusable in a browser and which `src/clip.ts` now replaces. We
still use `createAsyncResolver`, `createSelectorProcessor` and its types. Exports:

```ts
clip(options: ClipOptions): Promise<ClipResult>
matchTemplate(templates: Template[], url: string, schemaOrgData?: any): Template | undefined
createAsyncResolver(doc), createSelectorProcessor(doc)
type { Template, Property }

interface ClipOptions  { html, url, template, documentParser, propertyTypes?, parsedDocument? }
interface ClipResult   { noteName, frontmatter, content, fullContent, properties, variables }
interface DocumentParser { parseFromString(html: string, mimeType: string): any }
```

`clip()` runs Defuddle, converts to markdown with `createMarkdownContent`, builds the variables,
compiles the note name, the properties and the body, and generates the frontmatter. `fullContent` is
frontmatter + body, ready to write. Our `DocumentParser` is one line: `new DOMParser()`.

**Five integration facts that will otherwise cost a session each:**

1. **`api.ts` transitively imports `webextension-polyfill`** (via `storage-utils.ts` →
   `browser-polyfill.ts`). Upstream's own API build aliases it to `src/utils/cli-stubs.ts`; our
   esbuild config must do the same or the bundle breaks at load. See `scripts/build-api.mjs`.
2. **Defuddle gets bundled twice.** `api.ts` imports the class from `defuddle` and
   `createMarkdownContent` from `defuddle/full`, and full already contains core. Measured: 1.18 MB
   minified as-is, of which 1.06 MB is Defuddle (740 KB full + 320 KB core). Importing both from
   `defuddle/full` drops it to roughly 820 KB. Do that in Phase 0 and record the real number.
3. **Schema triggers need Defuddle to have already run.** `matchTemplate()` takes `schemaOrgData`,
   which only exists after `clip()` parses. For v1, match on URL triggers only and pass no schema; if
   schema triggers are wanted later, run Defuddle first and hand the parsed document to `clip()` via
   `parsedDocument` so it is not parsed twice — the option exists for exactly this.
4. **`saveToObsidian()` in `src/utils/obsidian-note-creator.ts` is what we replace.** Reading it is
   the fastest way to see what the URI used to do for the Android build: it delegates `append`,
   `prepend`, `overwrite` and daily notes to the URI's query parameters. **We implement none of them**
   — see M4 — so what we replace is the create-and-name-it part alone.
5. **Property types decide the YAML shape, and `clip()` lets us supply them out of band.**
   `generateFrontmatter()` in `src/utils/shared.ts` switches on the type: `multitext` emits a real
   YAML list, `number` strips non-numerics and parses, `checkbox` emits a bare boolean, `date` and
   `datetime` go out unquoted, and the default quotes the value and escapes its quotes. `clip()`
   builds its type map from `template.properties[].type` and then does `Object.assign(typeMap,
   propertyTypes)` — **the caller's map wins**. That precedence is what lets G1 keep types out of the
   template file and read them from the vault instead.

**The in-memory shape a template must parse into** (`src/types/types.ts`, verbatim). G1 decides how
it is *written* on disk; this is what `clip()` is handed:

```ts
interface Template {
  id: string; name: string;
  behavior: 'create' | 'append-specific' | 'append-daily' | 'prepend-specific'
          | 'prepend-daily' | 'overwrite';
  noteNameFormat: string; path: string; noteContentFormat: string;
  properties: Property[]; triggers?: string[]; vault?: string; context?: string;
}
interface Property { id?: string; name: string; value: string; type?: string; }
```

`vault` is meaningless to us (we are already in a vault) and `context` belongs to the interpreter,
which we do not ship. Both are accepted and ignored, so web-clipper exports still load.

**What we deliberately do not touch:** `reader.ts`, `highlighter.ts`, `interpreter.ts`, the popup,
the settings page, the template editor, `_locales`. None of them are in `api.ts`'s import graph, and
`interpreter.ts` staying out also removes two of the three regex-lookbehind sites in the codebase
(§15).

## 4. Architecture and repository layout

One process, one bundle. The plugin is a normal Obsidian plugin; there is no bridge, no shim runtime,
no second context. The pipeline is a straight line:

```
URL (clipboard | prompt | obsidian://clip)
  → requestUrl()                       server HTML
  → new DOMParser()                    a detached Document
  → matchTemplate()                    preselected template
  → template picker (human confirms)
  → clip()                             { noteName, fullContent, … }
  → vault write (create; a colliding name gets ` 1`, ` 2`, …)
  → open the note (optional)
```

Target layout after Phase 0:

```
main.ts                 plugin entry: commands, protocol handler, lifecycle
src/clip.ts             the engine: our clip() (G3), plus readableText
src/pipeline.ts         URL in, note out — the seam every entry point uses
src/fetch.ts            requestUrl: obsidianFetch for Defuddle, fetchPage for us
src/templates.ts        the default template, the folder loader, trigger matching
src/template-file.ts    the G1 format: parse, serialise, and JSON import
src/property-types.ts   the vault's property types, which win over a template's
src/youtube-captions.ts the only file that knows what a YouTube page looks like
src/uri.ts              what obsidian://clip should do, decided apart from doing it
src/settings.ts         the persisted settings; the tab is M3
src/save.ts             create, and Obsidian's duplicate-naming convention
src/ui/                 url-prompt, template-picker, json-import
manifest.json  versions.json  styles.css
esbuild.config.mjs      the build, and the two resolutions §3 depends on
typecheck.mjs           tsc, minus the submodule's own diagnostics
vitest.config.mts       test/, including test/stubs/ — a hostile `obsidian` module
                        and an in-memory vault, so the pipeline is testable
vendor/obsidian-clipper the pinned submodule
docs/plan/              this document
docs/android/           the superseded Android playbook, until absorbed
```

**`jsbridge/` is gone as of Phase 0.** Its submodule moved to `vendor/obsidian-clipper` and its
extraction harness and fixtures moved to `test/`; both transferred unchanged and are the reason M0's
best spike is cheap. Everything else it held was Android-only — the shim, the bundle entry points, the
UI entries, and a `build.mjs` writing into a directory that no longer exists — and went with it, in
the same commit, so the tree was never half-migrated. Upstream's own highlighter suites, which the
old harness also ran, went too: they need the deleted shim and they guard a feature that P11 puts
after v1.

## 5. Phase 0 — Bootstrap

### Tasks

**Done 2026-09-03.** What it took, and the three things that did not go as written:

1. Plugin skeleton at the repo root: `manifest.json` (`id: defuddler`, `name: Defuddler`,
   `minAppVersion: 1.13.0`, **`isDesktopOnly: false`**), `versions.json`, `main.ts`.
2. esbuild config producing `main.js`: external `obsidian` and `electron`, CJS out,
   `platform: browser`, the `webextension-polyfill` → `cli-stubs.ts` alias from §3,
   `DEBUG_MODE: false`.
3. §3 fact 2 applied, and the size recorded in §2.
4. Dev loop: `just link` symlinks `main.js`, `manifest.json` and `styles.css` into
   `/Users/box/Vaults/Sanctum/.obsidian/plugins/defuddler/`, so a rebuild plus Obsidian's reload is
   the whole cycle. `just dev` watches.
5. `jsbridge/` folded into the root and deleted, one commit (§4).
6. GitHub Actions release workflow: on a tag, typecheck, test, build, and attach the three assets.
   It refuses to build when the tag and `manifest.json`'s version disagree, because BRAT matches
   them and a mismatch installs nothing with no useful error.

**Three corrections Phase 0 forced, each recorded where it bit:**

- **Obsidian here is 1.14.0, not the 1.8.10 its `Info.plist` claims** — see the pinned table and P5.
  The app self-updates its asar and leaves the bundle's metadata behind, so the plist is a trap.
- **`defuddle` cannot be deduped with esbuild's `alias`.** Alias substitutes *prefixes*, so aliasing
  `defuddle` also rewrites `defuddle/full` into `defuddle/full/full`, which does not resolve. It
  needs an `onResolve` plugin with an exact-match filter; the config says so at the seam.
- **`"type": "module"` had to come off `package.json`.** We emit CommonJS, which is what Obsidian
  loads, and the field makes Node read the emitted `main.js` as ESM. Obsidian is unaffected either
  way, but every local tool that touches the artifact is not.

### Acceptance

- [x] `just test` runs the inherited extraction tests, green, from their new home — 6 passed,
      snapshots unmoved across both the move and a vitest major bump.
- [x] `just build` produces a `main.js` whose size is recorded in §2 — 831 KB.
- [x] `just check` is clean in our code.
- [x] The built bundle loads as CommonJS and default-exports a class extending `Plugin`, verified
      against a stub `obsidian` module.
- [x] `jsbridge/` is gone entirely.
- [x] `just doctor` passes on this machine.
- [ ] **Needs Johan:** Defuddler appears in Sanctum's community plugins list and toggles on and off
      with no console errors. The symlinks are in place; enabling a plugin is a UI action, and
      editing `community-plugins.json` under a running Obsidian would be overwritten.
- [ ] **Needs a push:** a tagged push produces a release with the three assets attached. Untested
      until there is something worth tagging.

## 6. M0 — De-risking spike → GATE G0

Timeboxed to about a day. Four spikes, in this order, because each one can kill the next.

### S1 — Fixture parity: does a real `DOMParser` match the harness?

**The question.** `extraction.test.ts` runs under **jsdom**, chosen deliberately because "Defuddle
wants a DOM with layout-ish APIs". A real browser's `DOMParser` document is detached and has no
layout either, but it is not jsdom. Defuddle calls `getComputedStyle` in ten places to drop hidden
elements, and both environments answer it without real layout — differently, perhaps. **The snapshots
are a prediction of the plugin's output, not proof of it.**

**The method.** A temporary developer command that reads the five fixture files from disk, runs each
through the plugin's own `DOMParser` → `clip()` path, and prints `{chars, head}` in the same `shape()`
the harness uses. Diff against `test/__snapshots__/extraction.test.ts.snap` by eye. Run it on desktop
and on the phone.

**Reading the result.** Identical or near-identical is a pass. A large regression on stephango or
apnews is the one result that reopens P1, because the whole case for one source rests on those
numbers. A github-only regression is expected and fine — the shadow DOM is not in those bytes anyway.

### S2 — Live fetch: is `requestUrl()` output the same shape as `curl`?

Fetch the five source URLs live (they are listed in `SOURCE_URLS`) and compare against S1. Answers
three things at once: whether `requestUrl` follows redirects, whether the user-agent header we set
actually reaches the server, and whether any of the five now serves something different to a
non-browser client than it did on 2026-09-01.

### S3 — Mobile: the whole pipeline on the phone

The one that decides whether v1 is real. In order:

1. The plugin loads on Obsidian mobile without visible startup lag at the size from Phase 0.
2. `requestUrl()` succeeds, including on an HTTPS site with redirects.
3. `DOMParser` + Defuddle complete, and how long they take on the apnews fixture. Record the number.
4. **`navigator.clipboard.readText()`** — does it work, does it throw, does it prompt? Whatever the
   answer, P8's prompt fallback ships; this only decides how often it is the visible path.
5. `obsidian://clip?url=…` from another app reaches the handler.

Worth checking opportunistically while there: whether Obsidian mobile's own share target can receive
a URL in a way the plugin could pick up, which would give the phone an entry point with no extra app.

### S4 — The write path

**Mostly retired before it ran.** Its central question — whether `vault.create()` fires on-create
automations — went with P2's narrowing on 2026-09-04. What remained was how to resolve today's daily
note without a private API, and that was answered from Sanctum's config. See §2.

### GATE G0

Record every measurement in §2. Johan decides whether v1 proceeds as specified, and in particular
whether S1's numbers hold P1 up.

## 7. M1 — Clip (v1)

**Built 2026-09-04, and tested as far as a test can reach.** The command, end to end, against a
single template hardcoded in the source. Templates come from the vault in M2; this milestone is
about the pipeline.

`test/pipeline.test.ts` runs the whole of it against an in-memory vault and a scripted `requestUrl`:
a news URL becomes a note with frontmatter and a body, Instagram becomes a note with no body and
says so, four HTTP statuses each produce their own sentence and write nothing, a non-URL never
reaches the network, and a second clip of the same page refuses to clobber the first.

**One bug the tests caught, worth naming because it was predicted.** The "no readable body" check
first tested the body's *length*, which calls Instagram's 22 KB of base64 image and YouTube's
48-character embed link successes. `D13` in the Android playbook recorded exactly this trap — the
test must be on readable text, never on an empty content string. `readableText()` in `src/clip.ts`
is that check, and it has its own tests.

### Tasks

1. Command `Clip from clipboard` (no "command" in the name, no plugin name in the id).
2. Clipboard read wrapped so that any failure is a prompt, never an abort (P8). Validate that what
   came back is an http/https URL before using it.
3. `src/fetch.ts`: `requestUrl` with a browser user-agent, a timeout, and errors that name what
   happened — offline, DNS, 404, 403, a timeout — as distinct `Notice` text. No silent failures.
4. `src/clip.ts`: parse, `matchTemplate()` on URL triggers only (§3 fact 3), `clip()`, return the result.
5. Write `fullContent` to `template.path` + `noteName` with `create` behaviour only. `normalizePath()`
   on the way in. Open the new note.
6. Progress and failure surfaced with `Notice`. A clip of a slow page must not look like a hang.

### Acceptance

- [x] An apnews URL becomes a note with frontmatter and a body — proven in `test/pipeline.test.ts`.
- [x] An Instagram URL produces a note with frontmatter and no body, and no error (P10).
- [x] A 404, 403, 429 and 500 each produce a distinct, accurate message and no note.
- [x] A non-URL, and a scheme we cannot fetch, are refused before anything reaches the network.
- [x] A second clip of the same page refuses rather than overwriting.
- [ ] **Needs the app:** the command, the clipboard prefill and the prompt, on the desktop.
- [ ] **Needs the phone:** the same, and whether a *populated* clipboard reads on Android — carried
      over from S3, which only ever saw an empty one. P8's prompt fallback ships either way; this
      decides how often it is the visible path.
- [ ] **Needs a real network:** offline behaviour, and the timeout.

## 8. M2 — Templates in the vault

**Built 2026-09-04.** Templates are markdown files in a vault folder, in the format GATE G1 settled;
the loader, the picker, the JSON importer and the vault-types lookup all exist and are tested.

**Four choices made while building it, none big enough for the decisions log but all worth knowing:**

- ~~**The default folder is `Defuddler` at the vault root, not under `Templates/`.**~~ **Changed to
  `Templates/Defuddler` on Johan's call, 2026-09-04**, after he reorganised that folder. The original
  reason has not gone away — Templater's `templates_folder` is still `Templates`, and it lists
  recursively, so it will offer these as note templates — but the tidiness is worth more to him than
  the noise. It is a setting either way.
- **A property's `type` is dropped on import.** G1 puts types in the vault, and a type carried inside
  one template would quietly win over the vault's answer for that template alone. The surprise costs
  more than the fidelity.
- **The picker does not open when there is exactly one template.** Deferring to the human means
  letting them decide, not making them confirm a choice that has one option.
- **Trailing newlines are stripped from the body at parse time.** A markdown file always ends with
  one; that is a property of the file, not of the template, and without stripping it every clipped
  note inherits a blank line nobody wrote.

### Tasks

1. Setting: template folder path, defaulting to something under the vault root.
2. Parse the G1 format: the file's frontmatter into the `Template` config fields, the first fenced
   block into `Property[]` by **splitting each line on its first colon**, and the text after that
   block into `noteContentFormat`. No YAML parser touches the fence — G1 says why.
3. Read the vault's property types and pass them to `clip()` as `propertyTypes` (§3, fact 5). Resolve
   the config directory through `app.vault.configDir` rather than hardcoding `.obsidian`. Map
   Obsidian's `tags` and `aliases` to `multitext`; every other name already matches upstream's.
   **If the file is missing or unreadable, fall back to no types** — the default branch emits quoted
   text, which is valid YAML, so this degrades rather than breaks.
4. Load every template in the folder at startup, validate, and report a bad file by name without
   preventing the others from loading.
5. Reload on vault changes to that folder, via `registerEvent` on the vault's modify/create/delete.
6. `FuzzySuggestModal` listing templates by name, with `matchTemplate()`'s answer preselected and the
   reason it matched visible (P4, governing principle).
7. A converter command for web-clipper JSON exports: read the export, write a G1 markdown template.
   Upstream's field names are reused verbatim in the config frontmatter to keep this close to a
   rename. **Two facts about real exports, both measured against kepano's** (see below): they carry
   a `schemaVersion` field the `Template` interface does not declare, which must be tolerated rather
   than rejected; and they have **no `id`**, which the type requires, so the loader synthesises one
   from the file name.
8. A default template written to the folder on first run if it is empty, so the plugin is usable
   before any authoring.

**The templates to test against are Johan's own source: [kepano/clipper-templates](https://github.com/kepano/clipper-templates)**, MIT. Two of them are already committed under
`test/fixtures/templates/` and are exercised by `test/templates.test.ts` — the YouTube one for its
`{{schema:…}}` variables and its `wikilink`, `date` and `slice` filters, the Wikipedia one for its
**regex** trigger and its `selectorHtml`/`remove_html`/`markdown` chain.

**A behaviour that will look like a bug and is not.** A `{{schema:…}}` variable resolves to nothing
when the page's JSON-LD lacks that key, and the property lands empty with no warning. The YouTube
fixture is a live example: its JSON-LD is a `VideoObject` carrying only `name`, `thumbnailUrl`,
`uploadDate` and `comment`, so kepano's `{{schema:author|wikilink}}` produces an empty `author` even
though Defuddle's own `{{author}}` knows perfectly well it is Rick Astley. The two are different
sources. This is pinned in `test/templates.test.ts` so nobody goes hunting.

### Acceptance

- [x] A malformed template names itself and does not take the others down — two kinds, an unclosed
      fence and a property line with no colon, both reported by path.
- [x] A template with a URL trigger is preselected for a matching URL and not for a non-matching one,
      for prefix triggers and regex triggers alike.
- [x] A placeholder in the fence needs no quoting: `published: {{published|date:"YYYY-MM-DD"}}`
      written bare parses correctly, which a YAML parser could not do.
- [x] `tags` lands as a real YAML list purely because the vault types it that way, with the template
      saying nothing about types.
- [x] A title containing a colon and a double quote produces valid frontmatter.
- [x] With the vault's type file removed, clipping still succeeds and every property is quoted text.
- [x] **A web-clipper JSON export converts to a template file that clips.** Proven the strong way:
      kepano's YouTube export goes through the converter, out to the file format, back in through the
      loader, and clips **byte-identically** to the raw JSON template.
- [x] The folder is seeded with a default template when empty, and a second run neither duplicates
      nor overwrites it.
- [ ] **Needs the app:** templates authored in the vault appear in the picker without restarting
      Obsidian. The reload is wired to the metadata cache and to vault create/modify/delete/rename,
      but only the app can prove the timing.

### Found in use — the transcript language, 2026-09-04

Johan clipped an English video and got a Traditional Chinese transcript. Not a clipping bug: Defuddle
only chooses a caption track deliberately when it is given a `language`, and we gave none. Its
fallback drops the auto-generated tracks, looks for a code that is exactly `en`, and otherwise takes
whichever track is first — Chinese, on that video.

| `language` given | Result |
|---|---|
| none | Chinese, 3,576 chars |
| `en` | English **auto-generated**, 9,206 |
| `en-US` | English **human-written**, 6,788 |
| `da` | Chinese again |

Two traps beyond the headline, and they are why a plain language setting would not have been enough.
A language the video does not carry lands in the same arbitrary fallback. And a bare `en` gets the
auto-generated captions even when a human-written `en-US` exists, because the exact-code match runs
before the auto-generated tracks are filtered out.

**Johan's requirement:** English only, human-written in preference to auto-generated. So
`src/youtube-captions.ts` reads the track list off the fetched page and hands Defuddle an exact code.
It is the one file that knows YouTube's shape, and it is written to lose quietly — no caption block,
an unfamiliar shape, or no English track all return nothing, which leaves Defuddle's own behaviour
alone. A page that is not YouTube never reaches it.

`youtube-multitrack.html` joined the fixtures for this. The Rick Astley page carries one caption
track and so could never have shown the bug.

**A second thing that clip exposed, and it was ours.** The seeded template had
`created: {{date}} {{time}}`, written on the assumption that those are a date and a time. They are
the same full timestamp, so every clip stamped it twice. It is now
`created: {{date|date:"YYYY-MM-DD HH:mm"}}`, which is also the shape Sanctum's existing clips use.
Both template files in the vault were corrected in place.

**A third, working as designed.** `published` landed as a quoted string because Sanctum's property
types carry no entry for it. That is G1 behaving correctly: setting the type once in Obsidian's own
property settings fixes it for every template, with no template edit. The same goes for `source` and
`author`.

## 9. M3 — Settings

**Built 2026-09-04.** A `PluginSettingTab` that declares `getSettingDefinitions()` and has no
`display()` (P5). Five settings in two groups: template folder and default template; output folder,
whether to open the note after clipping, and the user agent.

**The declarative API does more than P5 assumed, and it removes work rather than adding it.**
`PluginSettingTab` overrides `getControlValue` and `setControlValue` to read and persist
`plugin.settings` itself, so a control's `key` is the entire wiring a value needs — no `onChange`, no
`saveData` call, no chance of writing outside the settings object. That is also why P5's
single-object rule is not merely tidy: the tab writes the whole object back.

The one moving part is the default-template dropdown, whose options come from whatever is in the
vault. The plugin calls `update()` when the folder reloads, which is what that method is for.

Two things the milestone changed elsewhere:

- `clipUrlToVault` takes a request object rather than a growing argument list, now that the output
  folder, the user agent and whether to open the note all come from settings.
- The picker says *why* a template is preselected, because there are now two reasons — a trigger
  matched, or it is the configured default — and "matches this URL" would have been a lie for the
  second.

### Acceptance

- [x] No data is written outside `plugin.settings` — structurally, since the tab is the only writer
      and it persists the whole object.
- [x] The output folder, the user agent and the open-after-clipping toggle each change what the
      pipeline does, proven in `test/pipeline.test.ts`.
- [x] Touch targets clear 44px under `pointer: coarse` for the two modals that are ours. The settings
      tab is Obsidian's own rendering, so its sizing is Obsidian's.
- [ ] **Needs the app:** every setting persists across a reload, on desktop and mobile, and the tab is
      usable by keyboard alone.

## 10. M4 — Save behaviours — CLOSED, mostly by deletion (2026-09-04)

**Johan's call: only `create`.** Asked what the other five were for, and whether the flag earned its
place, he answered that he would never clip a page meaning to append it to a daily note, and that he
did not want `overwrite` either — Obsidian's own handling of a duplicate name was what he wanted.

The evidence agreed. All twelve of kepano's published templates are `create`. So is every clip in
Sanctum.

So `behavior` is not read from a template file, not written to one, and not taken from an import. It
is set to `create` in one place and ignored everywhere else; the field survives only because the type
is upstream's. **Importing an export that asked for something else says so** rather than coercing in
silence — that silence was the actual defect this milestone found, since `behavior` had been parsed
and validated since M2 and then never read, so a template declaring `append-daily` quietly created a
note instead.

**What replaced it is eight lines.** A colliding note name takes the next free one — `Name`,
`Name 1`, `Name 2` — which is Obsidian's own convention for a duplicate. Obsidian exposes that helper
publicly only for attachments and its note equivalent is undocumented, so the convention is matched
rather than the private method called. This also settles the question M1 deferred: a second clip of a
page is kept beside the first, neither refused nor silently replacing it.

### Acceptance

- [x] A second and third clip of the same page land as ` 1` and ` 2`, with the first untouched.
- [x] `behavior` in a template file changes nothing, whatever it says.
- [x] `behavior` is not written when a template is serialised.
- [x] Importing an export that asks for another behaviour warns and creates.

## 11. M5 — `obsidian://clip`

**Built 2026-09-04.** `registerObsidianProtocolHandler('clip', …)` taking `url` and an optional
`template`. From the URL onward it is M1's pipeline, unchanged — which is what `src/pipeline.ts`
existed for.

The rules live in `src/uri.ts`, apart from the handler that acts on them, so they are testable
without an app around them. There are three:

- **A named template is honoured.** Someone who wrote `&template=Recipe` chose it.
- **An unknown name is said out loud and then falls through to the picker.** Not an error, because
  the clip should not be thrown away, and not a silent substitution either — clipping with the wrong
  shape because a template got renamed is the kind of quiet wrongness this playbook keeps finding.
- **A missing `url` complains.** A URI that does nothing at all is the worst answer.

Two things worth knowing about the handler itself:

- **On a phone this may be what launches Obsidian**, so the template folder can still be loading when
  the URI arrives. The handler waits for it before deciding anything that depends on it.
- **An `obsidian://` link without a `vault=` parameter opens whichever vault was last used.** Anything
  generating these should carry the vault name. To try it here:
  `obsidian://clip?vault=Sanctum&url=https%3A%2F%2Fstephango.com%2Fvault`

### Acceptance

- [x] A named template is used as given; an unknown one says so and offers the picker.
- [x] A missing or blank `url` produces a message rather than a silent no-op.
- [x] Whitespace around either parameter is trimmed, since a share sheet often adds it.
- [ ] **Needs the app:** `obsidian://clip?url=…` from a browser on the desktop, and from another app
      on the phone.

## 12. v1 release checklist — GATE G2

- [x] M1–M5 acceptance boxes all checked. M4 is closed by deletion. Johan confirmed on the app
      2026-09-04: settings survive a reload, a template authored in the vault reaches the picker
      without a restart, **a populated clipboard does read on Android** — which closes the last
      question S3 left open — and `obsidian://clip` works from a browser. The share sheet is left for
      later, deliberately.
- [x] Extraction harness green against the pinned submodule and Defuddle — 71 tests.
- [x] `main.js` size and the mobile clip timing recorded in §2 and judged acceptable.
- [x] LICENSE present, 2026, holder is Johan.
- [x] README covering install via BRAT, the template format, and the URI scheme.
- [x] Templates moved to `Templates/Defuddler`, and kepano's twelve published templates converted
      into that folder through our own importer.
- [x] A tagged release carries `main.js`, `manifest.json`, `styles.css`, tag equal to manifest
      version. **1.0.0 published 2026-09-04**, first run of the workflow written in Phase 0 and it
      passed unchanged: tag check, typecheck, 71 tests, production build, then the three assets.
- [ ] **Johan's:** installed fresh through BRAT from that release, not from the dev symlink. The
      dev symlinks in `.obsidian/plugins/defuddler/` have to go first, or BRAT will be installing
      over them.

## 13. Post-v1

- **Rendered source on desktop.** The additive half of P1. Excalidraw's bundle proves Obsidian's
  Electron window allows `<webview>` — it creates one gated on `DEVICE.isDesktop` and falls back to
  an iframe elsewhere. Load the page, let its JavaScript run, pull `outerHTML` back with
  `executeJavaScript()`, and hand it to the same `clip()`. It inserts one step in front of Defuddle
  and touches nothing downstream. Worth doing when github-class pages start mattering in practice.
- **Reader view (P11).** A view over `clip()`'s output for preview and highlight-to-clip. Build it
  fresh; do not port upstream's `reader.ts`.
- **Mobile rendered source.** Only reachable through an external app that renders the page and hands
  over the HTML. `android-reader` already loads pages in a WebView and already moved ~500 KB of text
  into Obsidian through the clipboard, so it is a source of parts. It would forward rendered HTML to
  `obsidian://clip`, not clip on its own.
- **Highlights.** `{{highlights}}` needs a highlighter, which needs the reader view first.

## 14. Cross-cutting engineering notes

- **`requestUrl()`, never `fetch()`.** `fetch` is CORS-bound in the renderer; `requestUrl` is not, and
  it is the documented API. This is also a community-scanner rule we follow because it is right, not
  because of P6.
- **Bumping the submodule or Defuddle runs the extraction harness first.** Inherited from `D14` and
  the single most valuable thing carried over from the Android build: a changed extraction shows up as
  a moved snapshot instead of a surprise on the phone.
- **Never hand-edit a fixture.** A hand-authored DOM guards the fixture, not the site.
- **Popout windows and timers.** `registerDomEvent` rather than paired add/remove listeners;
  `registerEvent`, `addCommand`, `registerInterval` for everything with a lifetime.
- **Styling comes from `styles.css` and Obsidian's CSS variables.** No injected `<style>`, no
  hardcoded colours, no `!important`.
- **Console silence in `onload`/`onunload`.**

## 15. Risk register

| Risk | Mitigation | Status |
|---|---|---|
| ~~Real `DOMParser` extracts worse than the jsdom harness predicts~~ | **Closed by S1.** Identical on all five fixtures, and an attached laid-out document gave nothing extra | Closed |
| `navigator.clipboard.readText()` unreliable on mobile | P8 makes the prompt the fallback, so this degrades the ergonomics and never the function | Mitigated by design; S3 measures how often |
| Defuddle's `PARTIAL_SELECTORS` contains a regex lookbehind, which throws on iOS < 16.4 | Not reachable on Android; would be a hard failure, not a degradation, on an old iPhone. Not fixable in our code — it is inside the pinned dependency | Accepted; revisit if iOS is ever a target |
| ~~`main.js` size slows Obsidian mobile's startup~~ | **Closed by S3.** 836 KB, and five pages clip end to end in 6 s on the phone against 5 s on the desktop | Closed |
| ~~Daily-note resolution needs semi-private API~~ | **Moot 2026-09-04.** M4 dropped the daily-note behaviours entirely. Answered before it was dropped: `daily-notes.json` under `app.vault.configDir` has what is needed, with no private API | Closed |
| Server HTML is empty for SPA-only pages | P10 — a note with frontmatter and no body is a valid outcome, and §13's rendered source is the real answer if it becomes common | Accepted |
| Obsidian on the phone is below 1.13, so declarative settings render nothing | The phone ran the spike, so it is new enough to have installed a plugin declaring `minAppVersion` 1.13.0. Unverified beyond that | Mostly closed |
| Reading the vault's property types reaches into the config directory, whose file shape is undocumented | Resolve the path through `app.vault.configDir`, never a hardcoded `.obsidian`, and treat any failure as "no types" — the quoted-text default is valid YAML, so the failure is a downgrade, not a break | Accepted |
| Upstream changes `api.ts`'s signature | It is a young, deliberately public entry point; the harness catches behaviour changes, not signature changes, so a submodule bump reads its diff | Accepted |

## 16. Licensing

`obsidian-clipper` and `defuddle` are both MIT and stay in the tree as a submodule and an npm
dependency. `D34` settled that this is a personal tool and that the branding sweep and licence
notices were out of scope; P6 keeps that true. If P6 ever reverses, attribution is the first thing to
revisit.
