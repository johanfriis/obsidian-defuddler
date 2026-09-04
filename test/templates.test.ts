// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { Template } from '../vendor/obsidian-clipper/src/api';
import { clipHtml } from '../src/clip';
import { buildTemplate, serialiseTemplate, templateFromExport } from '../src/template-file';
import { DEFAULT_TEMPLATE, matchByUrl } from '../src/templates';

const fixtures = join(dirname(fileURLToPath(import.meta.url)), 'fixtures');
const noNetwork = () => Promise.reject(new Error('this suite does not reach the network'));

/** Loads an export the way M2's loader will have to: tolerate `schemaVersion`, invent the `id`. */
function loadTemplate(name: string): Template {
	const raw = JSON.parse(readFileSync(join(fixtures, 'templates', `${name}.json`), 'utf8'));
	expect(raw.id).toBeUndefined();
	expect(raw.schemaVersion).toBeTruthy();
	return { ...raw, id: name } as Template;
}

describe('real templates from kepano/clipper-templates', () => {
	it('the YouTube template resolves schema variables and filters', async () => {
		const template = loadTemplate('youtube-clipper');
		const result = await clipHtml({
			html: readFileSync(join(fixtures, 'youtube-watch.html'), 'utf8'),
			url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
			template,
			defuddle: { fetch: noNetwork },
		});

		const frontmatter = result.frontmatter;
		// `{{schema:name}}` — straight out of the page's JSON-LD.
		expect(frontmatter).toContain('title: "Rick Astley - Never Gonna Give You Up');
		// `|date:YYYY-MM-DD` on a date property: bare, unquoted, no time.
		expect(frontmatter).toContain('published: 2009-10-25');
		// `|slice:0` picks one thumbnail out of the array schema.org gives.
		expect(frontmatter).toMatch(/image: "https:\/\/i\.ytimg\.com\/[^"\n]+"/);
		expect(frontmatter).toContain('source: "https://www.youtube.com/watch?v=dQw4w9WgXcQ"');

		// **`author` comes out empty, and that is correct.** This fixture's JSON-LD is a single
		// VideoObject with only name, thumbnailUrl, uploadDate and comment — no `author` key at
		// all, so `{{schema:author|wikilink}}` has nothing to resolve. Defuddle's own `{{author}}`
		// does know it is Rick Astley; the schema path is a different source and can be thinner.
		//
		// M2 will meet this as "my template silently produced an empty property", and it is not a
		// bug. It is pinned here so nobody goes looking for one.
		expect(frontmatter).toContain('author:\n');
		expect(frontmatter).not.toContain('Rick Astley]]');

		// The note name is `{{schema:author}} – {{schema:name}}`, so the empty author leaves the
		// separator stranded at the front. A real page with an author gets both halves.
		expect(result.noteName).toBe(
			'– Rick Astley - Never Gonna Give You Up (Official Video) (4K Remaster)',
		);

		expect(result.content).toContain('https://www.youtube.com/watch?v=dQw4w9WgXcQ');
	});

	it('matches a prefix trigger and a regex trigger, and neither for a stranger', () => {
		const youtube = loadTemplate('youtube-clipper');
		const wikipedia = loadTemplate('wikipedia-clipper');
		const all = [DEFAULT_TEMPLATE, youtube, wikipedia];

		expect(matchByUrl(all, 'https://www.youtube.com/watch?v=dQw4w9WgXcQ')?.id).toBe('youtube-clipper');
		expect(matchByUrl(all, 'https://en.wikipedia.org/wiki/Obsidian')?.id).toBe('wikipedia-clipper');
		expect(matchByUrl(all, 'https://de.wikipedia.org/wiki/Obsidian')?.id).toBe('wikipedia-clipper');
		// Nothing matches, so the picker has no preselection to offer and opens unsorted.
		expect(matchByUrl(all, 'https://apnews.com/article/whatever')).toBeUndefined();
	});
});

describe('importing a real export', () => {
	it('converts kepano\'s YouTube template and clips the same as the raw JSON did', async () => {
		const raw = JSON.parse(
			readFileSync(join(fixtures, 'templates', 'youtube-clipper.json'), 'utf8'),
		);
		const html = readFileSync(join(fixtures, 'youtube-watch.html'), 'utf8');
		const url = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ';

		// The export as upstream's type wants it, for the baseline.
		const direct = await clipHtml({ html, url, template: { ...raw, id: 'raw' }, defuddle: { fetch: noNetwork } });

		// The same export through our converter, out to a file, and back in the way the loader reads it.
		const converted = templateFromExport(raw);
		const text = serialiseTemplate(converted);
		const roundTripped = buildTemplate('youtube-clipper', {
			name: converted.name,
			path: converted.path,
			noteNameFormat: converted.noteNameFormat,
			triggers: converted.triggers,
		}, text.slice(text.indexOf('---', 3) + 4));

		const viaFile = await clipHtml({
			html,
			url,
			template: roundTripped,
			// The types the export carried are dropped by the converter, so the vault supplies them.
			// These are the ones kepano's file declared, which is what makes the two runs comparable.
			propertyTypes: { author: 'multitext', published: 'date' },
			defuddle: { fetch: noNetwork },
		});

		// kepano's template stamps `created: {{date}}`, which resolves to *now* with seconds. The two
		// clips are milliseconds apart and can straddle a second, so that line is dropped from the
		// comparison rather than left to flake.
		const stable = (text: string) => text.replace(/^created:.*$/m, 'created: <stamp>');

		expect(viaFile.noteName).toBe(direct.noteName);
		expect(stable(viaFile.frontmatter)).toBe(stable(direct.frontmatter));
		expect(viaFile.content).toBe(direct.content);
		expect(stable(viaFile.fullContent)).toBe(stable(direct.fullContent));
		expect(roundTripped.triggers).toEqual(['https://www.youtube.com/watch?v=']);
	});

	it('refuses an export with no name, and one that is not an object', () => {
		expect(() => templateFromExport({ behavior: 'create' })).toThrow(/no `name`/);
		expect(() => templateFromExport('nope')).toThrow(/not a template object/);
	});
});
