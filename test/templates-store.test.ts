// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { readVaultPropertyTypes } from '../src/property-types';
import { ensureTemplateFolder, loadTemplates, matchByUrl } from '../src/templates';
import { clipHtml } from '../src/clip';
import { fakeApp } from './stubs/vault';

const FENCE = ['```', 'title: {{title}}', 'tags: clipped', '```', '', '{{content}}'].join('\n');

describe('loading templates from the vault', () => {
	it('reads a folder of templates and orders them by name', async () => {
		const vault = fakeApp();
		vault.addTemplate('Defuddler/Wiki.md', { name: 'Wiki', path: 'Clippings' }, FENCE);
		vault.addTemplate('Defuddler/Article.md', { name: 'Article', path: 'Clippings' }, FENCE);

		const { templates, errors } = await loadTemplates(vault.app, 'Defuddler');

		expect(errors).toEqual([]);
		expect(templates.map((t) => t.name)).toEqual(['Article', 'Wiki']);
		expect(templates[0].properties).toEqual([
			{ name: 'title', value: '{{title}}' },
			{ name: 'tags', value: 'clipped' },
		]);
	});

	it('names a broken template and loads the rest anyway', async () => {
		const vault = fakeApp();
		vault.addTemplate('Defuddler/Good.md', { name: 'Good' }, FENCE);
		vault.addTemplate('Defuddler/Unclosed.md', { name: 'Unclosed' }, '```\ntitle: x\n');
		vault.addTemplate('Defuddler/NoColon.md', { name: 'NoColon' }, '```\nnot a property\n```\n\n{{content}}');

		const { templates, errors } = await loadTemplates(vault.app, 'Defuddler');

		expect(templates.map((t) => t.name)).toEqual(['Good']);
		expect(errors.map((e) => e.file).sort()).toEqual(['Defuddler/NoColon.md', 'Defuddler/Unclosed.md']);
		expect(errors.find((e) => e.file.endsWith('Unclosed.md'))!.message).toMatch(/never closed/);
		expect(errors.find((e) => e.file.endsWith('NoColon.md'))!.message).toMatch(/no colon/);
	});

	it('seeds the default template when the folder is empty, and leaves it alone afterwards', async () => {
		const vault = fakeApp();

		await ensureTemplateFolder(vault.app, 'Defuddler');
		const seeded = vault.contents.get('Defuddler/Default.md');
		expect(seeded).toBeTruthy();
		expect(seeded).toContain('source: {{url}}');
		// The filter shapes the stamp; `{{date}}` and `{{time}}` are the same value, not two.
		expect(seeded).toContain('created: {{date|date:"YYYY-MM-DD HH:mm"}}');

		// A second run must not add another copy or overwrite the first.
		vault.contents.set('Defuddler/Default.md', `${seeded!}\nedited by hand\n`);
		await ensureTemplateFolder(vault.app, 'Defuddler');
		expect(vault.contents.get('Defuddler/Default.md')).toContain('edited by hand');
		expect([...vault.files.keys()]).toEqual(['Defuddler/Default.md']);
	});

	it('reads a template whose frontmatter Obsidian has not indexed', async () => {
		// The regression. The loader used to take the config from `metadataCache`, so a file the
		// cache had not reached yet produced a template named after its file, with no path, the
		// default note name and **no triggers** — and reported no error. On mobile, where indexing
		// lags, that looked exactly like URL matching being broken.
		const vault = fakeApp();
		vault.addTemplate(
			'Defuddler/Youtube.md',
			null, // nothing in the cache, whatever the file says
			[
				'---',
				'name: YouTube',
				'path: Clippings',
				'triggers:',
				'  - https://www.youtube.com/watch?v=',
				'---',
				'',
				'```',
				'title: {{schema:name}}',
				'```',
				'',
				'{{content}}',
			].join('\n'),
		);

		const { templates, errors } = await loadTemplates(vault.app, 'Defuddler');

		expect(errors).toEqual([]);
		expect(templates[0].name).toBe('YouTube');
		expect(templates[0].path).toBe('Clippings');
		expect(templates[0].triggers).toEqual(['https://www.youtube.com/watch?v=']);
		expect(matchByUrl(templates, 'https://www.youtube.com/watch?v=abc&list=x')?.name).toBe('YouTube');
	});

	it('returns nothing rather than throwing when the folder does not exist', async () => {
		const vault = fakeApp();
		expect(await loadTemplates(vault.app, 'Nowhere')).toEqual({ templates: [], errors: [] });
	});
});

describe('property types from the vault', () => {
	it('maps Obsidian names onto the ones upstream understands', async () => {
		const vault = fakeApp({
			types: { tags: 'tags', aliases: 'aliases', genre: 'multitext', year: 'number', created: 'datetime' },
		});

		expect(await readVaultPropertyTypes(vault.app)).toEqual({
			tags: 'multitext',
			aliases: 'multitext',
			genre: 'multitext',
			year: 'number',
			created: 'datetime',
		});
	});

	it('degrades to no types rather than failing when the file is absent', async () => {
		expect(await readVaultPropertyTypes(fakeApp({ types: null }).app)).toEqual({});
	});

	it('resolves through configDir rather than a hardcoded .obsidian', async () => {
		const vault = fakeApp({ configDir: '.config', types: { tags: 'tags' } });
		expect(await readVaultPropertyTypes(vault.app)).toEqual({ tags: 'multitext' });
	});
});

describe('the vault\'s types decide the YAML shape', () => {
	const page = (title: string) =>
		`<html><head><title>${title}</title></head><body><article><h1>${title}</h1>` +
		`<p>${'Long enough to be extracted as a body. '.repeat(20)}</p></article></body></html>`;

	const template = {
		id: 'T',
		name: 'T',
		behavior: 'create' as const,
		path: '',
		noteNameFormat: '{{title}}',
		noteContentFormat: '{{content}}',
		// No types anywhere in the template — that is the point of G1.
		properties: [
			{ name: 'title', value: '{{title}}' },
			{ name: 'tags', value: 'clipped, reading' },
			{ name: 'words', value: '{{words}}' },
		],
	};

	const noNetwork = () => Promise.reject(new Error('this suite does not reach the network'));

	it('turns tags into a list purely because the vault says so', async () => {
		const typed = await clipHtml({
			html: page('A clean title'),
			url: 'https://example.com/a',
			template,
			propertyTypes: { tags: 'multitext', words: 'number' },
			defuddle: { fetch: noNetwork },
		});

		expect(typed.frontmatter).toContain('tags:\n  - "clipped"\n  - "reading"');
		expect(typed.frontmatter).toMatch(/words: \d+/);
	});

	it('falls back to quoted text everywhere when there are no types', async () => {
		const untyped = await clipHtml({
			html: page('A clean title'),
			url: 'https://example.com/a',
			template,
			defuddle: { fetch: noNetwork },
		});

		// Still valid YAML, just flatter: the list is one string and the count is quoted.
		expect(untyped.frontmatter).toContain('tags: "clipped, reading"');
		expect(untyped.frontmatter).toMatch(/words: "\d+"/);
	});

	it('escapes a title carrying a colon and a double quote', async () => {
		const nasty = 'Why "Obsidian": a note';
		const result = await clipHtml({
			html: page(nasty),
			url: 'https://example.com/a',
			template,
			propertyTypes: { tags: 'multitext' },
			defuddle: { fetch: noNetwork },
		});

		expect(result.frontmatter).toContain('title: "Why \\"Obsidian\\": a note"');
	});
});
