# Template fixtures

Two templates from [kepano/clipper-templates](https://github.com/kepano/clipper-templates),
unmodified, MIT © Steph Ango. They are here because a template we wrote ourselves would only prove
that our code agrees with itself. These are what a real export looks like.

`youtube-clipper.json` exercises `{{schema:…}}` variables and the `wikilink`, `date` and `slice`
filters against a fixture we already have. `wikipedia-clipper.json` is here for its **regex**
trigger and its `selectorHtml`/`remove_html`/`markdown` chain; there is no Wikipedia page fixture,
so it guards trigger matching rather than extraction.

**Two things about the export format that M2's loader has to handle**, both visible here:

- A `schemaVersion` field that upstream's `Template` interface does not declare. It must be
  tolerated, not rejected.
- **No `id`.** `Template.id` is required by the type but absent from every export, so the loader has
  to synthesise one — the file name is the obvious source.
