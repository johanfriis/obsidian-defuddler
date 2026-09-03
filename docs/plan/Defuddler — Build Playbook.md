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
shaped by that template — with his usual on-create automations firing, because the note is written
through the vault API and not through a URI.

## Pinned upstream (verified 2026-09-03)

| What | Pin | Notes |
|---|---|---|
| `obsidianmd/obsidian-clipper` | commit `9aa509b8f2801b08d974fb59f026df6f9a12e496` (main, 2026-08-03, "Bump deps") | MIT. Not on npm → consumed as the git submodule at `jsbridge/vendor/obsidian-clipper`. |
| `defuddle` | `0.19.3` | MIT. Upstream declares `^0.19.2`. |
| Obsidian | `1.8.10` on this machine (insider) | `minAppVersion` starts at `1.8.0`. See P5 for why the declarative settings API is not used. |

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
- **Where things stand (2026-09-03).** Nothing is built. `main` was cleared of the Android app at
  `2c5e484`; `jsbridge/` and its submodule survive because they hold the engine and the extraction
  fixtures. The next thing to do is Phase 0, then M0.

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
| **P2** | **Clipping happens inside Obsidian; notes are written with the vault API.** | This is the whole reason to pivot. It retires `D2`, `D18` and `D36` outright: no `obsidian://new`, no clipboard as transport, no size ceiling, no foregrounding, and `G0/A5`'s finding that Templater's on-create trigger does not fire is simply no longer true of us. **Cost, recorded honestly:** `D2` credited the URI with implementing dedup/append/overwrite for free. That credit is now a debt — those behaviours are ours to write (M4). |
| **P3** | **Upstream's `src/api.ts` is the engine. We consume it; we do not fork it, and we ship none of its UI.** | `api.ts` is upstream's own environment-agnostic entry point: `clip({html, url, template, documentParser})` plus `matchTemplate()`. It is the entire clip pipeline with no `browser.*` in its import graph (§3 lists the 70 files it does pull). This is what makes the pivot cheap, and it is the opposite of `D31`, which hosted upstream's *extension* — that decision bought a UI and paid for it with the polyfill shim, two WebViews, a message router and bundle injection. Here we buy only the engine and build our own small UI, because Obsidian already gives us modals, settings and a command palette. |
| **P4** | **Templates are markdown files in the vault, in a configurable folder. `matchTemplate()` preselects; the human confirms.** | In-vault means editable and syncable anywhere, with no separate store to keep in step. Preselect-don't-apply follows the governing principle, and matches `M3.3` in the old playbook. The file format is settled in **GATE G1** — markdown, with the note's frontmatter in a fenced block and its types taken from the vault. |
| **P5** | **Settings live in Obsidian's settings tab, built with `display()` and `Setting`. All persisted state sits inside `plugin.settings`.** | Obsidian here is 1.8.10; the declarative `getSettingDefinitions()` API needs 1.13.0, which does not exist yet. `display()` is correct today and the migration is mechanical when 1.13 lands. The single-blob rule matters because Obsidian's auto-persist clobbers sibling keys written with `saveData()`. |
| **P6** | **Distribution is BRAT only. No community-plugin submission.** | Personal tool, same call as `D34`. Consequence: the community scanner's Scorecard is *guidance*, not a gate. We follow its rules where they are cheap and right (no `fetch()`, sentence case, `registerDomEvent`, no `!important`) and skip the submission ceremony. If that ever changes, the name and the ESLint pass are the two things to revisit. |
| **P7** | **The plugin is named Defuddler, id `defuddler`.** | Clears Obsidian's naming rules: no "Obsidian" in it, does not start with "Obsi", does not end with "dian". It does borrow kepano's library name, which reads faintly official — acceptable for a BRAT-only personal tool per P6, and a reason to rename before any submission. |
| **P8** | **The clipboard is a prefill, never a requirement.** | `navigator.clipboard.readText()` is the shakiest API in this design on mobile: iOS WKWebView gates it behind a user gesture and can throw or prompt. So the command always opens a prompt with the URL field filled in when the read worked and empty when it didn't. This is `D36` learned from the other side — a clipboard failure must be visible and recoverable, not silent. |
| **P9** | **`obsidian://clip?url=…` ships in v1.** | It is a handful of lines via `registerObsidianProtocolHandler`, and it is the seam every future entry point plugs into: a share-target app, a bookmarklet, a shortcut. Shipping it in v1 costs almost nothing and stops the URL parsing from being retrofitted later. |
| **P10** | **Extraction that yields nothing is not an error.** | The Instagram fixture is the case: Defuddle returns a title and zero words. The picker still opens, the template still applies, and what lands is a note with frontmatter and no body. `D13` reached the same place by a different route — a bookmark clip made by hand is still a bookmark clip — and the governing principle forbids dropping the human into a dead end. |
| **P11** | **The reader view is out of scope for v1.** | Option 2 from the pivot conversation. Its value is preview and highlight-to-clip, **not** better extraction, because its input is still the fetched HTML. Upstream's own reader is 2805 lines of `browser.runtime`/`browser.storage` and must not be ported — see §13. |

## 2. Gate outcomes

### GATE G0 — the de-risking spike — OPEN

Closes at the end of M0 (§6). Passing means the pipeline is proven on both platforms and the numbers
are written into §2. Failing on the fixture-parity spike (S1) is the one result that would reopen P1.

### GATE G1 — template file format — CLOSED (2026-09-03)

**Decided by Johan.** A template is a markdown file. Its own frontmatter is the template *config*; the
first fenced block is the note's frontmatter; everything after that block is the note's body. Property
*types* are not written in the template at all — they come from the vault.

````markdown
---
name: Article
behavior: create
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
- **Residual pollution, accepted:** the five config keys (`name`, `behavior`, `path`,
  `noteNameFormat`, `triggers`) do enter the property index. `name` is the only one generic enough to
  collide with a real content property. Templates live in their own folder, so a query can exclude
  them; that is the mitigation and it is the same one any template folder needs.

### GATE G2 — v1 release — OPEN

The checklist is §12.

## 3. Ground truth: upstream integration points

Everything here was read out of the pinned submodule on 2026-09-03. A session that doubts a line
should re-read the file rather than trust this table.

**`src/api.ts` — the engine.** Its own header: environment-agnostic, no Node or browser
dependencies, the caller provides a `DocumentParser`. Exports:

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
   the fastest way to see the debt P2 names: it delegates `append`, `prepend`, `overwrite` and daily
   notes to the URI's query parameters. Our M4 implements all of them against the vault API.
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
  → vault write per template.behavior
  → open the note (optional)
```

Target layout after Phase 0:

```
main.ts                 plugin entry: commands, protocol handler, lifecycle
src/clip.ts             the pipeline above, one exported function
src/fetch.ts            requestUrl wrapper: user-agent, redirects, errors
src/templates.ts        load/watch the vault template folder, parse, validate
src/save.ts             the six behaviours (M4)
src/settings.ts         PluginSettingTab
src/ui/                 URL prompt modal, template FuzzySuggestModal
manifest.json  versions.json  esbuild.config.mjs  styles.css
jsbridge/               kept: vendor submodule + extraction fixtures and tests
docs/plan/              this document
docs/android/           the superseded Android playbook, until absorbed
```

**`jsbridge/` is transitional.** Its `vendor/` submodule and `test/extraction.test.ts` +
`test/fixtures/` transfer as-is and are the reason M0's best spike is cheap. Its Android entry points
(`src/background.ts`, `src/bundle-entry.ts`, `src/ui-*-entry.ts`, `shim/browser.ts`) and its
`build.mjs`, which still writes to the deleted `android/app/src/main/assets`, are dead. Phase 0
folds what survives into the plugin's own build and deletes the rest **in one commit**, so the tree
is never half-migrated.

## 5. Phase 0 — Bootstrap

### Tasks

1. Plugin skeleton at the repo root: `manifest.json` (`id: defuddler`, `name: Defuddler`,
   `minAppVersion: 1.8.0`, **`isDesktopOnly: false`**), `versions.json`, `main.ts` that loads and
   unloads cleanly and does nothing else.
2. esbuild config producing `main.js`: external `obsidian`, ESM in / CJS out, `platform: browser`,
   the `webextension-polyfill` → `cli-stubs.ts` alias from §3, `DEBUG_MODE: false`.
3. Apply §3 fact 2 — import Defuddle from one entry point — and **record the resulting `main.js`
   size in §2**. It is the number M0's mobile spike is judged against.
4. Dev loop: symlink the build output into `/Users/box/Vaults/Sanctum/.obsidian/plugins/defuddler/`
   so a rebuild plus Obsidian's reload is the whole cycle. A `just dev` recipe wrapping esbuild
   watch.
5. Move the extraction harness and fixtures out of `jsbridge/` into the plugin's own test setup,
   delete the dead Android entry points and `build.mjs`, and update the justfile. One commit.
6. GitHub Actions release workflow: on a tag, build and attach `main.js`, `manifest.json`,
   `styles.css`. BRAT installs from release assets and the tag must equal the manifest version.

### Acceptance

- [ ] Defuddler appears in Sanctum's community plugins list and toggles on and off with no console errors.
- [ ] `just test` runs the inherited extraction tests, green, from their new home.
- [ ] `just build` produces a `main.js` whose size is recorded in §2.
- [ ] `jsbridge/` contains only the submodule, or is gone entirely.
- [ ] A tagged push produces a release with the three assets attached.

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

Prove `vault.create()` fires Johan's on-create automations — the thing `G0/A5` measured as broken
through `obsidian://new` and the single biggest claim P2 makes. Templater is the test. Then confirm
what the vault API needs for the other five behaviours so M4 is not a discovery exercise: dedup on an
existing path, append and prepend to an existing note, overwrite, and how to resolve today's daily
note without a private API.

### GATE G0

Record every measurement in §2. Johan decides whether v1 proceeds as specified, and in particular
whether S1's numbers hold P1 up.

## 7. M1 — Clip (v1)

The command, end to end, against a single template hardcoded in the source. Templates come from the
vault in M2; this milestone is about the pipeline.

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

- [ ] A copied apnews URL becomes a note in the vault with frontmatter and a body, from one command.
- [ ] The same on the phone.
- [ ] An Instagram URL produces a note with frontmatter and no body, and no error (P10).
- [ ] Offline, a 404 and a 403 each produce a distinct, accurate message and no note.
- [ ] A non-URL on the clipboard opens the prompt rather than failing.
- [ ] Templater's on-create trigger fires on the created note.

## 8. M2 — Templates in the vault

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
   Upstream's field names are reused verbatim in the config frontmatter to keep this close to a rename.
8. A default template written to the folder on first run if it is empty, so the plugin is usable
   before any authoring.

### Acceptance

- [ ] Templates authored in the vault appear in the picker without restarting Obsidian.
- [ ] A malformed template names itself in a `Notice` and does not take the others down.
- [ ] A template with a URL trigger is preselected for a matching URL and not for a non-matching one.
- [ ] A placeholder in the fence needs no quoting: `published: {{published|date:"YYYY-MM-DD"}}` written
      bare produces a correct date property.
- [ ] `tags` lands as a real YAML list purely because the vault types it that way, with the template
      saying nothing about types.
- [ ] A title containing a colon and a double quote produces valid frontmatter.
- [ ] With the vault's type file removed, clipping still succeeds and every property is quoted text.
- [ ] A web-clipper JSON export converts to a template file that clips.

## 9. M3 — Settings

`PluginSettingTab` with `display()` (P5), everything inside `plugin.settings`: template folder,
default template, default output folder, whether to open the note after clipping, and the user-agent
string. Sentence case throughout, `.setHeading()` for sections, no plugin name in the headings.

### Acceptance

- [ ] Every setting persists across a reload, on desktop and mobile.
- [ ] No data is written outside `plugin.settings`.
- [ ] The tab is usable by keyboard alone, and touch targets clear 44×44px on the phone.

## 10. M4 — Save behaviours

The debt P2 names. Implement all six of `Template['behavior']` against the vault API: `create`
(with a dedup rule — decide and record it, since the URI's was invisible to us), `append-specific`,
`prepend-specific`, `overwrite`, and `append-daily` / `prepend-daily`.

Daily notes are the risky one: resolving today's note means reading the daily-notes or periodic-notes
configuration, and the internal-plugin route is semi-private API. S4 settles the approach; whatever it
is, a missing or disabled daily-notes setup must produce a clear message rather than a crash.

### Acceptance

- [ ] Each of the six behaviours does what its name says, verified against a real note.
- [ ] Appending twice does not duplicate frontmatter.
- [ ] `create` against an existing path follows the recorded dedup rule.
- [ ] Daily behaviours work with Johan's periodic-notes setup, and degrade with a clear message without it.

## 11. M5 — `obsidian://clip`

`registerObsidianProtocolHandler('clip', …)` taking `url` and an optional `template` name. Same
pipeline as M1 from the URL onward. Note that an `obsidian://` link without a `vault=` parameter opens
whichever vault was last used, so anything generating these links should carry the vault name.

### Acceptance

- [ ] `obsidian://clip?url=…` from a browser and from another app on the phone both clip.
- [ ] A missing or malformed `url` produces a message, not a silent no-op.
- [ ] `obsidian://clip?url=…&template=…` uses the named template and says so if the name is unknown.

## 12. v1 release checklist — GATE G2

- [ ] M1–M5 acceptance boxes all checked, on desktop **and** on the phone.
- [ ] Extraction harness green against the pinned submodule and Defuddle.
- [ ] `main.js` size and the mobile clip timing recorded in §2 and judged acceptable.
- [ ] A tagged release carries `main.js`, `manifest.json`, `styles.css`, tag equal to manifest version.
- [ ] Installed fresh through BRAT into Sanctum from that release, not from the dev symlink.
- [ ] LICENSE present, current year, holder is Johan.
- [ ] README covering install via BRAT, the template folder, and the URI scheme.

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
| Real `DOMParser` extracts worse than the jsdom harness predicts | S1 measures it directly against the committed snapshots; a large regression reopens P1 | Open until G0 |
| `navigator.clipboard.readText()` unreliable on mobile | P8 makes the prompt the fallback, so this degrades the ergonomics and never the function | Mitigated by design; S3 measures how often |
| Defuddle's `PARTIAL_SELECTORS` contains a regex lookbehind, which throws on iOS < 16.4 | Not reachable on Android; would be a hard failure, not a degradation, on an old iPhone. Not fixable in our code — it is inside the pinned dependency | Accepted; revisit if iOS is ever a target |
| ~820 KB of `main.js` slows Obsidian mobile's startup | Measured in Phase 0 and again in S3; the Defuddle dedupe is the only easy lever and it is already spent | Open until G0 |
| Daily-note resolution needs semi-private API | S4 settles it; a clear failure message is the floor | Open until G0 |
| Server HTML is empty for SPA-only pages | P10 — a note with frontmatter and no body is a valid outcome, and §13's rendered source is the real answer if it becomes common | Accepted |
| Reading the vault's property types reaches into the config directory, whose file shape is undocumented | Resolve the path through `app.vault.configDir`, never a hardcoded `.obsidian`, and treat any failure as "no types" — the quoted-text default is valid YAML, so the failure is a downgrade, not a break | Accepted |
| Upstream changes `api.ts`'s signature | It is a young, deliberately public entry point; the harness catches behaviour changes, not signature changes, so a submodule bump reads its diff | Accepted |

## 16. Licensing

`obsidian-clipper` and `defuddle` are both MIT and stay in the tree as a submodule and an npm
dependency. `D34` settled that this is a personal tool and that the branding sweep and licence
notices were out of scope; P6 keeps that true. If P6 ever reverses, attribution is the first thing to
revisit.
