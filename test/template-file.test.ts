// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { buildTemplate, parseProperties, serialiseTemplate, splitTemplateBody } from '../src/template-file';

/** GATE G1's format, and the specific ways it was designed not to break. */

describe('the fenced properties block', () => {
	it('needs no quoting around a placeholder, which is the whole reason it is not YAML', () => {
		const properties = parseProperties([
			'title: {{title}}',
			'published: {{published|date:"YYYY-MM-DD"}}',
			'tags: {{schema:@Article:keywords}}',
		]);

		expect(properties).toEqual([
			{ name: 'title', value: '{{title}}' },
			// A YAML parser would read the leading brace as a flow mapping and fail here.
			{ name: 'published', value: '{{published|date:"YYYY-MM-DD"}}' },
			{ name: 'tags', value: '{{schema:@Article:keywords}}' },
		]);
	});

	it('splits on the first colon only, so a value may contain more', () => {
		expect(parseProperties(['source: https://example.com/a:b'])).toEqual([
			{ name: 'source', value: 'https://example.com/a:b' },
		]);
	});

	it('carries no type, because the vault supplies those', () => {
		expect(parseProperties(['tags: x'])[0]).not.toHaveProperty('type');
	});

	it('skips blank lines and comments, and names a line it cannot read', () => {
		expect(parseProperties(['', '# a note to self', 'title: x'])).toHaveLength(1);
		expect(() => parseProperties(['this line has no colon'])).toThrow(/no colon/);
		expect(() => parseProperties([': orphaned'])).toThrow(/no name/);
	});
});

describe('splitting a template file', () => {
	it('ignores everything before the fence and keeps everything after it', () => {
		const { propertyLines, body } = splitTemplateBody(
			['## Template', '', '```', 'title: {{title}}', '```', '', '{{content}}', ''].join('\n'),
		);
		expect(propertyLines).toEqual(['title: {{title}}']);
		// Trailing newlines are the file's, not the template's.
		expect(body).toBe('{{content}}');
	});

	it('treats a file with no fence as all body and no properties', () => {
		const { propertyLines, body } = splitTemplateBody('{{content}}');
		expect(propertyLines).toEqual([]);
		expect(body).toBe('{{content}}');
	});

	it('says so when the fence is never closed', () => {
		expect(() => splitTemplateBody('```\ntitle: x\n')).toThrow(/never closed/);
	});

	it('leaves a fence inside the body alone', () => {
		const { propertyLines, body } = splitTemplateBody(
			['```', 'title: x', '```', '', 'Some prose.', '', '```js', 'code()', '```', ''].join('\n'),
		);
		expect(propertyLines).toEqual(['title: x']);
		expect(body).toContain('```js');
	});
});

describe('buildTemplate', () => {
	const markdown = ['```', 'title: {{title}}', '```', '', '{{content}}'].join('\n');

	it('takes its config from the frontmatter Obsidian parsed', () => {
		const template = buildTemplate(
			'Article',
			{ name: 'Article', path: 'Clippings', noteNameFormat: '{{title}}', triggers: ['https://apnews.com/'] },
			markdown,
		);
		expect(template).toMatchObject({
			id: 'Article',
			name: 'Article',
			behavior: 'create',
			path: 'Clippings',
			noteNameFormat: '{{title}}',
			triggers: ['https://apnews.com/'],
			noteContentFormat: '{{content}}',
		});
	});

	it('falls back to the file name and sane defaults when the frontmatter is thin', () => {
		const template = buildTemplate('Scratch', null, markdown);
		expect(template.name).toBe('Scratch');
		expect(template.behavior).toBe('create');
		expect(template.noteNameFormat).toBe('{{title}}');
	});

	it('always creates, whatever a file happens to say', () => {
		// `behavior` is not read from a template file at all — Johan wants only `create`, so a
		// stray key from an old export or a hand edit changes nothing.
		expect(buildTemplate('X', { name: 'X' } as never, markdown).behavior).toBe('create');
		expect(
			buildTemplate('X', { name: 'X', behavior: 'append-daily' } as never, markdown).behavior,
		).toBe('create');
	});
});

describe('serialiseTemplate', () => {
	it('round-trips a template through the file format', () => {
		const original = {
			id: 'YouTube',
			name: 'YouTube',
			behavior: 'create' as const,
			path: 'Clippings',
			noteNameFormat: '{{schema:author}} – {{schema:name}}',
			noteContentFormat: '![{{schema:name}}]({{url}})\n',
			properties: [
				{ name: 'title', value: '{{schema:name}}' },
				{ name: 'published', value: '{{schema:uploadDate|date:YYYY-MM-DD}}' },
			],
			triggers: ['https://www.youtube.com/watch?v='],
		};

		const text = serialiseTemplate(original);
		// `behavior` is not written out either — there is nothing to configure.
		expect(text).not.toContain('behavior:');
		// The placeholder in noteNameFormat must survive as real frontmatter, so it is quoted there —
		// and must NOT be quoted inside the fence, which is not YAML.
		expect(text).toContain('noteNameFormat: "{{schema:author}} – {{schema:name}}"');
		expect(text).toContain('published: {{schema:uploadDate|date:YYYY-MM-DD}}');

		const frontmatter = {
			name: original.name,
			behavior: original.behavior,
			path: original.path,
			noteNameFormat: original.noteNameFormat,
			triggers: original.triggers,
		};
		const back = buildTemplate('YouTube', frontmatter, text.slice(text.indexOf('---', 3) + 4));
		expect(back.properties).toEqual(original.properties);
		expect(back.noteContentFormat.trim()).toBe(original.noteContentFormat.trim());
	});
});
