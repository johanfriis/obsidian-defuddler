# Extraction fixtures

Inputs for `test/extraction.test.ts`. Every submodule or Defuddle bump runs it before anything else
(§14 of the playbook), so a change in what comes out of a page shows up as a moved snapshot rather
than as a surprise on the phone.

## How these were captured

`curl` with the app's own user-agent, on 2026-09-01 — except `youtube-multitrack.html`, captured the
same way on 2026-09-04:

```bash
UA="Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36"
curl -sSL -A "$UA" "<url>" -o <name>.html
```

`Android 10; K` is Chrome's frozen reduced-UA pair, sent by every real Chrome on every device, and
it is what `DEFAULT_USER_AGENT` in `src/fetch.ts` sends. Some of the fixtures were captured with
`Android 16; K` before that was corrected; servers treat the two identically, so they were not
re-captured.

The source URL for each file is in `SOURCE_URLS` in the test — Defuddle needs it for the domain and
for resolving relative links, so a fixture without one is not usable.

| Fixture | What it guards |
|---|---|
| `stephango-vault.html` | The friendly baseline: clean semantic HTML, title/author/word count. |
| `apnews-article.html` | A real news article — the daily-driver case. |
| `github-readme.html` | A README inside a heavy app shell. |
| `youtube-watch.html` | Title, author, the embed, and the **transcript**. |
| `youtube-multitrack.html` | Eleven caption tracks, and the trap that comes with them (below). |
| `instagram-wall.html` | A page that defeats extraction entirely — P10's case. |

## What these fixtures cannot tell you

**They are server bytes, with no JavaScript ever executed.** Two consequences, both measured rather
than assumed:

- **github's shadow DOM is simply not here.** The captured file contains zero `attachShadow` calls
  and zero declarative `<template shadowroot>` elements, because the live page attaches its shadow
  roots from script. So nothing about github's shadow DOM **can be reproduced by any `curl`
  fixture** — it needs a hydrated capture from a real browser, which is what the deferred rendered
  source (§13 of the playbook) would provide.
- **The YouTube transcript is not here at all.** *Corrected at M0/S1, 2026-09-04; the previous text
  claimed the opposite.* `YoutubeExtractor` does not read the transcript out of the inline player
  JSON — that parse throws a `SyntaxError`. It fetches it from YouTube's API during `parseAsync`,
  first by POSTing to the innertube endpoint and then by getting the caption track's URL. Measured
  on this fixture: **2,780 chars with the network, 262 chars and zero words without it.**

  Two consequences. The transcript is a property of YouTube's API on the day you run, not of these
  bytes, so it cannot be snapshotted hermetically — hence the split in `extraction.test.ts`, where
  every test refuses network and the transcript gets its own opt-in test. And inside a renderer
  those requests are CORS-bound and fail silently, which is why the plugin has to hand Defuddle a
  fetch backed by `requestUrl` (`src/fetch.ts`).

A session tempted to "fix" the shadow-DOM gap by editing a fixture by hand should not: a
hand-authored DOM would guard the fixture, not the site.

## `youtube-multitrack.html`, and why one YouTube fixture was not enough

Captured after Johan clipped an English video and got a Traditional Chinese transcript.

The Rick Astley page carries a single caption track, so it could never have shown this. This one
carries eleven — `en` (auto-generated), `en-US`, `fr`, `it`, `zh-Hant`, `ko`, `pl`, `pt-BR`, `ru`,
`es`, `uk` — and given no `language` option Defuddle drops the auto-generated tracks, looks for one
whose code is exactly `en`, finds none, and takes whichever is first. That is `zh-Hant`.

Two further traps in the same place, both measured on this file:

- Asking for a language the video does not carry lands in exactly the same fallback. `da` gives
  Chinese too.
- Asking for a bare `en` gets the **auto-generated** captions, because the exact-code match happens
  before the auto-generated tracks are filtered out — even though a human-written `en-US` exists.

`src/youtube-captions.ts` reads the track list off the page and hands Defuddle an exact code.
Measured end to end on this fixture: `en-US`, 6,788 chars of human-written English, against 3,576 of
Chinese without it.
