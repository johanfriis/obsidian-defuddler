# Extraction fixtures

Inputs for `test/extraction.test.ts`, the regression harness D14 asks for: every submodule or
defuddle bump runs it before anything else (§14), so a change in what comes out of a page shows up
as a moved snapshot rather than as a surprise on the phone.

## How these were captured

`curl` with the app's own user-agent, on 2026-09-01:

```bash
UA="Mozilla/5.0 (Linux; Android 16; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36"
curl -sSL -A "$UA" "<url>" -o <name>.html
```

The source URL for each file is in `SOURCE_URLS` in the test — Defuddle needs it for the domain and
for resolving relative links, so a fixture without one is not usable.

| Fixture | What it guards |
|---|---|
| `stephango-vault.html` | The friendly baseline: clean semantic HTML, title/author/word count. |
| `apnews-article.html` | A real news article — the daily-driver case. |
| `github-readme.html` | A README inside a heavy app shell. |
| `youtube-watch.html` | Title, author, the embed, and the **transcript**. |
| `instagram-wall.html` | A page that defeats extraction entirely — M2.5's bookmark fallback. |

## What these fixtures cannot tell you

**They are server bytes, with no JavaScript ever executed.** Two consequences, both measured rather
than assumed:

- **github's shadow DOM is simply not here.** The captured file contains zero `attachShadow` calls
  and zero declarative `<template shadowroot>` elements, because the live page attaches its shadow
  roots from script. B3's finding that `flatten-shadow-dom.js` is refused on github by `script-src`
  (§2) therefore **cannot be reproduced by any `curl` fixture** — it needs a hydrated capture from a
  real browser, and remains a device-only check.
- **The YouTube transcript is here, but its *timing* is not.** Defuddle's `YoutubeExtractor` reads
  the transcript out of the inline player JSON, not out of the rendered page, so it survives a
  capture with no browser — which is why `youtube-watch.html` guards the transcript properly. What
  it cannot show is B3's measurement that the transcript is absent at a 6 s settle and present at
  15 s: that is a property of the live WebView, and it is what D26's Reload path exists for.

A session tempted to "fix" the shadow-DOM gap by editing a fixture by hand should not: a
hand-authored DOM would guard the fixture, not the site.
