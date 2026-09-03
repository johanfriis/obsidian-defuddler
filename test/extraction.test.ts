// @vitest-environment jsdom
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeEach, describe, expect, it } from 'vitest';
import Defuddle from 'defuddle';

/**
 * M1.7 — the extraction regression harness (D14).
 *
 * Every submodule bump runs this before anything else (§14): if upstream or defuddle changes what
 * comes out of a page, the snapshot moves and the bump stops being a version number.
 *
 * **jsdom, not linkedom.** Defuddle wants a DOM with layout-ish APIs, and upstream's own
 * DOM-dependent tests declare `@vitest-environment jsdom` for the same reason. linkedom stays where
 * it is enough — the bundle tests, which only evaluate and probe.
 *
 * **What these fixtures are and are not.** They were captured with `curl` using the app's own
 * user-agent, so they are what the server sends, with no JavaScript-built DOM. That covers
 * extraction quality on server-rendered pages, and it does not cover anything a page's own script
 * constructs — github's shadow DOM is absent from these bytes entirely (0 `attachShadow`, 0
 * declarative `<template shadowroot>`), so B3's shadow-DOM finding cannot be reproduced here.
 *
 * The YouTube transcript, on the other hand, *is* in the server HTML: Defuddle's YoutubeExtractor
 * reads it out of the inline player JSON, not out of the rendered page. So this fixture guards the
 * transcript path properly. What it cannot reproduce is B3's *timing* finding — absent at a 6 s
 * settle, present at 15 s — which is a property of the live WebView, not of the bytes.
 */
const fixtures = join(dirname(fileURLToPath(import.meta.url)), 'fixtures');

/** The URL each fixture was captured from; Defuddle uses it for domain and relative links. */
const SOURCE_URLS: Record<string, string> = {
  'stephango-vault.html': 'https://stephango.com/vault',
  'apnews-article.html':
    'https://apnews.com/article/apple-iphone-keyboard-typing-tricks-shortcuts-78fd9488e6a1ebc0840be8a0d1d42032',
  'github-readme.html': 'https://github.com/obsidianmd/obsidian-clipper',
  'youtube-watch.html': 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
  'instagram-wall.html': 'https://www.instagram.com/explore/',
};

async function extract(fixture: string) {
  const html = readFileSync(join(fixtures, fixture), 'utf8');
  document.documentElement.innerHTML = html;
  return new Defuddle(document, { url: SOURCE_URLS[fixture] }).parseAsync();
}

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

  it('youtube — title, author, embed and the full transcript', async () => {
    const result = await extract('youtube-watch.html');
    expect(result.title).toContain('Never Gonna Give You Up');
    expect(result.author).toBe('Rick Astley');
    // The transcript is the part M1's acceptance turns on, and it survives without a browser
    // because YoutubeExtractor parses the inline player JSON rather than the rendered page.
    expect(result.content).toContain('<h2>Transcript</h2>');
    expect(result.content).toContain('We\'re no strangers to love');
    // The embed is what makes the reader show a player rather than a dead thumbnail.
    expect(result.content).toContain('youtube.com/embed/dQw4w9WgXcQ');
    expect(shape(result.content)).toMatchSnapshot();
  });

  it('instagram — extraction yields nothing, which is M2.5 bookmark territory', async () => {
    // A real page that defeats extraction rather than a fabricated one: served to a logged-out
    // client it is a shell, so Defuddle finds a title and no body at all. This is the case the
    // bookmark-only fallback (D13/M2.5) exists for, and the fixture that will prove it fires.
    const result = await extract('instagram-wall.html');
    expect(result.title).toBe('Instagram');
    expect(result.wordCount ?? 0).toBe(0);
    // Note the shape of the failure, because it tells M2.5 what to test for: Defuddle returns
    // ~22 KB of *markup* and not one readable character. So the bookmark fallback must trigger on
    // empty text, never on an empty content string — that check would not fire here.
    expect(textOf(result.content)).toBe('');
    expect(shape(result.content).chars).toBeGreaterThan(0);
  });
});
