// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { clip as upstreamClip } from '../vendor/obsidian-clipper/src/api';
import type { Template } from '../vendor/obsidian-clipper/src/api';
import { clipHtml, readableText } from '../src/clip';

/**
 * Guards GATE G3's fork.
 *
 * `src/clip.ts` reimplements the wiring of upstream's `clip()` for three measured reasons, all
 * recorded in that file. This suite holds two of them in place and pins the third, so that a
 * submodule bump which changes upstream's behaviour shows up here rather than in a clip weeks
 * later.
 *
 * Everything runs with a fetch that refuses, so a number here is a property of the bytes on disk.
 */

const fixtures = join(dirname(fileURLToPath(import.meta.url)), 'fixtures');
const noNetwork = () => Promise.reject(new Error('this suite does not reach the network'));

const SOURCE_URLS: Record<string, string> = {
  'stephango-vault.html': 'https://stephango.com/vault',
  'apnews-article.html':
    'https://apnews.com/article/apple-iphone-keyboard-typing-tricks-shortcuts-78fd9488e6a1ebc0840be8a0d1d42032',
  'github-readme.html': 'https://github.com/obsidianmd/obsidian-clipper',
  'youtube-watch.html': 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
  'youtube-multitrack.html': 'https://www.youtube.com/watch?v=G3kuMWediSQ',
  'instagram-wall.html': 'https://www.instagram.com/explore/',
};

/**
 * Whether the fixture has a body to carry into the note. The two that do not are deliberate: the
 * YouTube transcript needs a network call this suite refuses, and Instagram defeats extraction
 * outright, which is P10's case.
 */
const HAS_BODY: Record<string, boolean> = {
  'stephango-vault.html': true,
  'apnews-article.html': true,
  'github-readme.html': true,
  'youtube-watch.html': false,
  'instagram-wall.html': false,
};

/** Exercises a note name, every property type that changes the emitted YAML, a filter, and a body. */
const TEMPLATE: Template = {
  id: 'test',
  name: 'Test',
  behavior: 'create',
  path: 'Clippings',
  noteNameFormat: '{{title}}',
  noteContentFormat: '# {{title}}\n\n{{content}}',
  properties: [
    { name: 'title', value: '{{title}}', type: 'text' },
    { name: 'author', value: '{{author}}', type: 'text' },
    { name: 'source', value: '{{url}}', type: 'text' },
    // `{{words}}`, not `{{wordCount}}` — the variable is renamed on the way out of Defuddle.
    { name: 'words', value: '{{words}}', type: 'number' },
    { name: 'tags', value: '{{title|kebab}}', type: 'multitext' },
  ],
};

describe('clipHtml', () => {
  for (const [fixture, url] of Object.entries(SOURCE_URLS)) {
    it(`${fixture} clips without losing what Defuddle extracted`, async () => {
      const html = readFileSync(join(fixtures, fixture), 'utf8');
      const result = await clipHtml({ html, url, template: TEMPLATE, defuddle: { fetch: noNetwork } });

      // The body is markdown by the time it lands, so it is shorter than the HTML the extraction
      // harness measures. What matters is that it survived at all.
      if (HAS_BODY[fixture]) {
        expect(result.content.length).toBeGreaterThan(500);
      } else {
        expect(result.frontmatter).toContain('---');
      }
      expect(result.frontmatter).toContain(`source: "${url}"`);
    });
  }

  it('resolves variables into the note name and the frontmatter', async () => {
    const html = readFileSync(join(fixtures, 'stephango-vault.html'), 'utf8');
    const result = await clipHtml({
      html,
      url: SOURCE_URLS['stephango-vault.html'],
      template: TEMPLATE,
      defuddle: { fetch: noNetwork },
    });

    expect(result.noteName).toBe('How I use Obsidian');
    expect(result.frontmatter).toContain('title: "How I use Obsidian"');
    expect(result.frontmatter).toContain('author: "Steph Ango"');
    // `number` emits bare, `multitext` emits a list — the two shapes G1 leans on.
    expect(result.frontmatter).toMatch(/words: \d+/);
    expect(result.frontmatter).toContain('tags:\n  - "how-i-use-obsidian"');
    expect(result.content).toContain('# How I use Obsidian');
  });

  it('takes Defuddle options, which is what the fork buys', async () => {
    const html = readFileSync(join(fixtures, 'apnews-article.html'), 'utf8');
    const url = SOURCE_URLS['apnews-article.html'];
    const base = { html, url, template: TEMPLATE };

    // Partial-selector removal is the noisiest of Defuddle's toggles on a real news page, which
    // makes it the honest one to test with: 3,730 chars of body with it on, 6,430 with it off.
    const trimmed = await clipHtml({ ...base, defuddle: { fetch: noNetwork } });
    const untrimmed = await clipHtml({
      ...base,
      defuddle: { fetch: noNetwork, removePartialSelectors: false },
    });

    expect(untrimmed.content.length).toBeGreaterThan(trimmed.content.length + 1000);
  });

  it("pins upstream's defect: its clip() extracts nothing from a real DOMParser document", async () => {
    // Upstream hands Defuddle `doc.documentElement`, an HTMLHtmlElement, where a Document is
    // wanted. It works for its own CLI because linkedom's documentElement is document-like. If
    // this test ever fails, upstream has fixed it and GATE G3's fork is worth revisiting.
    const html = readFileSync(join(fixtures, 'stephango-vault.html'), 'utf8');
    const theirs = await upstreamClip({
      html,
      url: SOURCE_URLS['stephango-vault.html'],
      template: TEMPLATE,
      documentParser: new DOMParser(),
    });

    expect(theirs.noteName).toBe('Untitled');
    expect(theirs.fullContent).not.toContain('take notes, write essays');

    // The same bytes through ours, for contrast.
    const ours = await clipHtml({
      html,
      url: SOURCE_URLS['stephango-vault.html'],
      template: TEMPLATE,
      defuddle: { fetch: noNetwork },
    });
    expect(ours.fullContent).toContain('take notes, write essays');
  });
});

describe('readableText', () => {
  // The three shapes a body comes in, taken from the fixtures rather than invented.
  it('sees prose', () => {
    expect(readableText('Texting friends, replying to a business email.').length).toBeGreaterThan(20);
  });

  it('sees nothing in a body that is one image, however long it is', () => {
    // Instagram's fixture: 22 KB of body, all of it one base64 data URI.
    expect(readableText(`![](data:image/png;base64,${'A'.repeat(22000)})`)).toBe('');
  });

  it('sees nothing in a bare embed link', () => {
    // YouTube's, when the transcript is out of reach.
    expect(readableText('![](https://www.youtube.com/watch?v=dQw4w9WgXcQ)')).toBe('');
  });

  it('keeps a link\'s text and drops its target', () => {
    expect(readableText('I use [Obsidian](https://obsidian.md) to think')).toBe('I use Obsidian to think');
  });
});

/**
 * The guard that was missing.
 *
 * `{{transcript}}` is Defuddle's, supplied by its YouTube extractor through `result.variables` — but
 * only when the captions were actually fetched. Every other test here refuses the network, which
 * makes the variable invisible, and reasoning from that absence is how a working variable came to be
 * overwritten in 1.0.2. So this one leaves the machine, and skips when it cannot.
 */
const online = await fetch('https://www.youtube.com/generate_204', { signal: AbortSignal.timeout(4000) })
  .then(() => true)
  .catch(() => false);

describe("Defuddle's own extractor variables", () => {
  it.runIf(online)('reach the template as {{transcript}}', async () => {
    const result = await clipHtml({
      html: readFileSync(join(fixtures, 'youtube-multitrack.html'), 'utf8'),
      url: SOURCE_URLS['youtube-multitrack.html'],
      template: { ...TEMPLATE, properties: [], noteContentFormat: 'T[{{transcript}}]' },
      // jsdom's own fetch is CORS-bound, so Defuddle must be handed Node's — the same distinction
      // that makes requestUrl necessary inside Obsidian.
      defuddle: { language: 'en-US', fetch: globalThis.fetch },
    });

    expect(result.content).toMatch(/^T\[/);
    expect(result.content).toContain('Miles Tost');
    expect(result.content.length).toBeGreaterThan(1000);
  });
});
