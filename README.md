# Defuddler

Clip a web page into your Obsidian vault. Reads a URL, runs it through
[Defuddle](https://github.com/kepano/defuddle), applies a template kept in the vault, and writes the
note. Desktop and mobile, from one build.

It is the engine behind [Obsidian Web Clipper](https://github.com/obsidianmd/obsidian-clipper)
without the browser extension: the clip happens inside Obsidian, so the note is written through the
vault API rather than handed over a URI.

## Install

Through [BRAT](https://github.com/TfTHacker/obsidian42-brat): add `johanfriis/obsidian-defuddler` as a
beta plugin, then enable Defuddler in community plugins. Requires Obsidian 1.13 or later.

## Use

**`Clip from clipboard`** — prefills the URL from your clipboard, asks you to confirm it, picks a
template, and writes the note. The clipboard is only ever a prefill: if the read fails, or there is
no URL on it, you get the same prompt with an empty field.

**`Import a template from JSON`** — paste a Web Clipper export, or a file from
[kepano/clipper-templates](https://github.com/kepano/clipper-templates), and it is written out as a
template file.

**`obsidian://clip?url=…`** — clips from anywhere that can open a link. Takes an optional
`&template=` naming one of your templates. An `obsidian://` link with no `&vault=` opens whichever
vault was last used, so include the vault name in anything that generates these.

## Templates

Templates are markdown files in a folder you choose (`Templates/Defuddler` by default). One is
created for you on first run.

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
source: {{url}}
published: {{published|date:"YYYY-MM-DD"}}
tags: clipped, reading
```

{{content}}
````

The file's own frontmatter is the template's configuration. The first fenced block becomes the
note's frontmatter, one property per line, split on the first colon. Everything after that block is
the note's body. Anything before the fence — a heading, a note to yourself — is ignored.

**The fenced block is not YAML, and is not parsed as YAML.** That is what lets you write
`published: {{published|date:"YYYY-MM-DD"}}` without quoting it, which real YAML would reject
because a leading brace opens a flow mapping.

**Property types come from your vault, not from the template.** Set a property's type once in
Obsidian's own property settings and every template gets it: `tags` becomes a real list, a date goes
in unquoted. A property your vault has no type for is written as quoted text, which is always valid,
just flatter.

`triggers` preselects a template when you clip a matching URL. A plain string matches as a prefix; a
string wrapped in slashes is a regular expression. The match is only ever a preselection — the
picker still opens and you still choose.

**A prefix trigger has to cover every form of the URL you actually paste**, and a share sheet rarely
hands you the one you would type. YouTube is the worst of them: the Android app shares
`youtu.be/…`, the mobile site gives `m.youtube.com/…`, and a desktop browser gives
`www.youtube.com/watch?v=…`. Published templates tend to carry only the last, so a template imported
from elsewhere will quietly fail to match anything shared from a phone.

```yaml
triggers:
  - https://www.youtube.com/watch?v=
  - https://m.youtube.com/watch?v=
  - https://youtu.be/
```

The URL form affects matching only. Extraction does not care which one you give it.

Variables, filters and the `{{selector:…}}` and `{{schema:…}}` families are upstream's, and are
documented in the [Web Clipper's template
reference](https://help.obsidian.md/web-clipper/variables). Some things the docs do not spell out:

- The word count is `{{words}}`, not `{{wordCount}}`.
- `{{date}}` and `{{time}}` are the same full timestamp, so shape it with
  `{{date|date:"YYYY-MM-DD HH:mm"}}` rather than writing both.
- **A `{{schema:…}}` variable resolves to nothing when the page's JSON-LD lacks that key, silently.**
  On YouTube that catches `{{schema:author}}`, whose data simply is not there — use `{{author}}`,
  which Defuddle works out for itself. When a variable looks wrong, `{{meta:name:…}}` and
  `{{meta:property:…}}` expose the page's raw meta tags and are the general escape hatch.

Defuddle's site extractors contribute variables of their own. On a YouTube video `{{transcript}}` is
the cues, separate from `{{content}}` which carries them under a `## Transcript` heading. It is empty
when the captions could not be fetched, which is also why it is invisible to anything running without
a network.

## What it does not do

Only `create`. Upstream's template format carries five more behaviours — append or prepend to a
named note or to today's daily note, and overwrite — and none of them are implemented. A template
asking for one is treated as `create`, and importing an export that asks for one says so. A clip
whose note name already exists is kept beside the first as `Name 1`, the way Obsidian names any
duplicate.

Pages are fetched as the server sends them, with no JavaScript run. Server-rendered pages clip well;
single-page apps and anything behind a login generally do not, and land as a note with frontmatter
and no body.

That difference is why YouTube needs help in two places the browser extension does not: its server
HTML carries two `<meta name="description">` tags, the generic one first, and it offers no caption
track deliberately unless asked. Both are handled in `src/youtube.ts`, which loses quietly whenever
the page is not the shape it expects.

## Development

```bash
just setup         # submodule, npm deps, symlink into the vault
just dev           # rebuild on change
just ci            # typecheck, tests, production build
just test-network  # as above, plus the two tests that call YouTube's API
```

The test suite is hermetic by default. Two tests call YouTube's transcript API and are opt-in,
because a release should not be able to fail because a third party rate-limited a CI runner.

`docs/plan` holds the build playbook: the decisions, what was measured, and why things are the way
they are.

## Licence

MIT. Bundles [defuddle](https://github.com/kepano/defuddle) and builds on
[obsidian-clipper](https://github.com/obsidianmd/obsidian-clipper), both MIT.
