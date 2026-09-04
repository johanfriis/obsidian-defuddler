// @vitest-environment jsdom
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeEach, describe, expect, it } from 'vitest';
import Defuddle from 'defuddle';

/**
 * The extraction regression harness.
 *
 * Every submodule bump runs this before anything else (§14 of the playbook): if upstream or Defuddle
 * changes what comes out of a page, the snapshot moves and the bump stops being a version number.
 *
 * **jsdom, not linkedom.** Defuddle wants a DOM with layout-ish APIs, and upstream's own
 * DOM-dependent tests declare `@vitest-environment jsdom` for the same reason. linkedom stays where
 * it is enough — the bundle tests, which only evaluate and probe.
 *
 * **What these fixtures are and are not.** They were captured with `curl` using the app's own
 * user-agent, so they are what the server sends, with no JavaScript-built DOM. That covers
 * extraction quality on server-rendered pages, and it does not cover anything a page's own script
 * constructs — github's shadow DOM is absent from these bytes entirely (0 `attachShadow`, 0
 * declarative `<template shadowroot>`), so nothing about a page's shadow DOM can be tested here.
 *
 * **The YouTube transcript is NOT in these bytes** — corrected at M0/S1, 2026-09-04. This comment
 * used to claim Defuddle read it out of the inline player JSON. It does not: the inline parse
 * throws a SyntaxError, and the extractor gets the transcript by calling YouTube's API during
 * `parseAsync`. Measured on this fixture: 2,780 chars with the network, 262 chars and zero words
 * without it.
 *
 * That made this suite silently network-dependent, which is the opposite of what a bump guard is
 * for. So every test below runs with a `fetch` that refuses, and the transcript gets its own test
 * that opts back in and is skipped when there is no network. Four of the five fixtures are
 * unaffected — measured, not assumed.
 */
const fixtures = join(dirname(fileURLToPath(import.meta.url)), 'fixtures');

/** The URL each fixture was captured from; Defuddle uses it for domain and relative links. */
const SOURCE_URLS: Record<string, string> = {
  'stephango-vault.html': 'https://stephango.com/vault',
  'apnews-article.html':
    'https://apnews.com/article/apple-iphone-keyboard-typing-tricks-shortcuts-78fd9488e6a1ebc0840be8a0d1d42032',
  'github-readme.html': 'https://github.com/obsidianmd/obsidian-clipper',
  'youtube-watch.html': 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
  'youtube-multitrack.html': 'https://www.youtube.com/watch?v=G3kuMWediSQ',
  'instagram-wall.html': 'https://www.instagram.com/explore/',
};

/** Refuses every request Defuddle's extractors try to make, so a snapshot is a property of the
 *  bytes on disk and of nothing else. */
const noNetwork = () => Promise.reject(new Error('the extraction harness does not reach the network'));

async function extract(fixture: string, options: Record<string, unknown> = {}) {
  const html = readFileSync(join(fixtures, fixture), 'utf8');
  document.documentElement.innerHTML = html;
  return new Defuddle(document, {
    url: SOURCE_URLS[fixture],
    fetch: noNetwork,
    ...options,
  }).parseAsync();
}

/** Whether the one network-dependent test below can run at all. */
const online = await fetch('https://www.youtube.com/generate_204', {
  signal: AbortSignal.timeout(4000),
})
  .then(() => true)
  .catch(() => false);

/** Collapses whitespace so a snapshot tracks content, not upstream's formatting. Markup is kept:
 *  structural drift in what Defuddle emits is exactly what these snapshots are for. */
function shape(content: string | undefined) {
  const markup = (content ?? '').replace(/\s+/g, ' ').trim();
  return {
    chars: markup.length,
    head: markup.slice(0, 160),
  };
}

/** The readable text inside the extracted markup — what a reader would actually see. */
function textOf(content: string | undefined) {
  return (content ?? '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

beforeEach(() => {
  // Each fixture gets a clean document; Defuddle mutates the one it is handed.
  document.documentElement.innerHTML = '<head></head><body></body>';
});

describe('extraction fixtures', () => {
  it('covers every fixture on disk, so a new capture cannot be silently untested', () => {
    const onDisk = readdirSync(fixtures)
      .filter((name) => name.endsWith('.html'))
      .sort();
    expect(onDisk).toEqual(Object.keys(SOURCE_URLS).sort());
  });

  it('stephango — the friendly baseline', async () => {
    const result = await extract('stephango-vault.html');
    expect(result.title).toBe('How I use Obsidian');
    expect(result.author).toBe('Steph Ango');
    expect(result.wordCount).toBeGreaterThan(1400);
    expect(shape(result.content)).toMatchSnapshot();
  });

  it('apnews — a real news article', async () => {
    const result = await extract('apnews-article.html');
    expect(result.title).toBeTruthy();
    expect(result.wordCount).toBeGreaterThan(300);
    expect(shape(result.content)).toMatchSnapshot();
  });

  it('github — a README, minus the shadow DOM the live page builds', async () => {
    const result = await extract('github-readme.html');
    expect(result.title).toBeTruthy();
    expect(result.content).toContain('clipper');
    expect(shape(result.content)).toMatchSnapshot();
  });

  it('youtube — title, author and the embed, with the transcript out of reach', async () => {
    // What the bytes alone give: metadata and the embed, and no body at all. The embed is what
    // makes a reader show a player rather than a dead thumbnail.
    const result = await extract('youtube-watch.html');
    expect(result.title).toContain('Never Gonna Give You Up');
    expect(result.author).toBe('Rick Astley');
    expect(result.content).toContain('youtube.com/embed/dQw4w9WgXcQ');
    expect(result.wordCount ?? 0).toBe(0);
    expect(shape(result.content)).toMatchSnapshot();
  });

  // The only test here that leaves the machine, and the only one that can fail for a reason that
  // is not ours. It guards the thing M0/S1 found: the transcript is reachable, but only through a
  // fetch that is not CORS-bound — which inside Obsidian means requestUrl (src/fetch.ts, GATE G3).
  it.runIf(online)('youtube — the transcript, which costs a network call', async () => {
    const result = await extract('youtube-watch.html', { fetch: globalThis.fetch });
    expect(result.content).toContain('<h2>Transcript</h2>');
    expect(result.content).toContain('We\'re no strangers to love');
    expect(result.wordCount ?? 0).toBeGreaterThan(400);
  });

  it('youtube-multitrack — eleven caption tracks, and none of them chosen by accident', async () => {
    // Captured 2026-09-04 because the Rick Astley page carries a single caption track and so could
    // never have shown this: given no language, Defuddle picks the first non-auto track, which here
    // is Traditional Chinese for an English video. `src/youtube-captions.ts` is what stops that, and
    // `test/youtube-captions.test.ts` reads this file to prove it.
    const result = await extract('youtube-multitrack.html');
    expect(result.title).toContain('Witcher');
    expect(result.author).toBeTruthy();
    // No network here, so the body is the embed alone — the transcript is a live fetch either way.
    expect(result.wordCount ?? 0).toBe(0);
    expect(shape(result.content)).toMatchSnapshot();
  });

  it('instagram — extraction yields nothing, which is P10 territory', async () => {
    // A real page that defeats extraction rather than a fabricated one: served to a logged-out
    // client it is a shell, so Defuddle finds a title and no body at all. P10 is the decision that
    // says this is a valid outcome rather than an error.
    const result = await extract('instagram-wall.html');
    expect(result.title).toBe('Instagram');
    expect(result.wordCount ?? 0).toBe(0);
    // Note the shape of the failure, because it is what `readableText` exists for: Defuddle returns
    // ~22 KB of *markup* and not one readable character. So a "no body" check must be on empty
    // text, never on an empty content string — that check would not fire here.
    expect(textOf(result.content)).toBe('');
    expect(shape(result.content).chars).toBeGreaterThan(0);
  });
});
