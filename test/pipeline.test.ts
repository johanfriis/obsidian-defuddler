// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
// Imported by path, not as 'obsidian'. The vitest alias maps that specifier to this same file, so
// it is one module instance either way — but tsc resolves 'obsidian' to the real package, which of
// course has no test hooks.
import { __notices, __setRequestUrl } from './stubs/obsidian';
import { clipUrlToVault } from '../src/pipeline';
import { DEFAULT_TEMPLATE } from '../src/templates';
import { fakeApp } from './stubs/vault';

/**
 * M1 end to end, against an in-memory vault and a scripted `requestUrl`: URL in, note on disk, or a
 * message saying why not. Everything M1's acceptance can be checked without the app is checked here;
 * what is left for the app itself is the clipboard, the modal, and the phone.
 */

const fixtures = join(dirname(fileURLToPath(import.meta.url)), 'fixtures');
const APNEWS = 'https://apnews.com/article/apple-iphone-keyboard-typing-tricks-shortcuts-78fd9488e6a1ebc0840be8a0d1d42032';

function serve(body: string, status = 200) {
	__setRequestUrl(async () => ({
		status,
		text: body,
		headers: {},
		json: null,
		arrayBuffer: new ArrayBuffer(0),
	}));
}

beforeEach(() => {
	__notices.length = 0;
});
afterEach(() => {
	__setRequestUrl(null);
});

describe('clipUrlToVault', () => {
	it('turns a news URL into a note with frontmatter and a body', async () => {
		serve(readFileSync(join(fixtures, 'apnews-article.html'), 'utf8'));
		const { app, contents, opened } = fakeApp();

		const file = await clipUrlToVault(app, { url: APNEWS, template: DEFAULT_TEMPLATE });

		expect(file).not.toBeNull();
		expect(file!.path).toMatch(/^Clippings\/.+\.md$/);

		const note = contents.get(file!.path)!;
		expect(note.startsWith('---\n')).toBe(true);
		expect(note).toContain(`source: "${APNEWS}"`);
		expect(note).toContain('created:');
		expect(note.length).toBeGreaterThan(2000);

		expect(opened).toEqual([file!.path]);
		expect(__notices.at(-1)).toContain('Clipped');
	});

	it('still writes a note when the page has no readable body, and says so', async () => {
		// P10: extraction that yields nothing is not an error. Instagram is the fixture it was
		// captured for.
		serve(readFileSync(join(fixtures, 'instagram-wall.html'), 'utf8'));
		const { app, contents } = fakeApp();

		const file = await clipUrlToVault(app, { url: 'https://www.instagram.com/explore/', template: DEFAULT_TEMPLATE });

		expect(file).not.toBeNull();
		expect(contents.get(file!.path)).toContain('source: "https://www.instagram.com/explore/"');
		expect(__notices.at(-1)).toContain('no readable body');
	});

	for (const [status, expected] of [
		[404, 'does not exist (404)'],
		[403, 'refused the request (403)'],
		[429, 'rate-limiting'],
		[500, 'server error (500)'],
	] as const) {
		it(`says what happened on HTTP ${status}, and writes nothing`, async () => {
			serve('', status);
			const { app, files } = fakeApp();

			expect(await clipUrlToVault(app, { url: APNEWS, template: DEFAULT_TEMPLATE })).toBeNull();
			expect(files.size).toBe(0);
			expect(__notices.at(-1)).toContain(expected);
			expect(__notices.at(-1)).toContain('apnews.com');
		});
	}

	it('rejects a non-URL before anything reaches the network', async () => {
		// No requestUrl installed: if this ever touches the network the stub throws and the message
		// would say so instead.
		const { app, files } = fakeApp();

		expect(await clipUrlToVault(app, { url: 'just some text', template: DEFAULT_TEMPLATE })).toBeNull();
		expect(files.size).toBe(0);
		expect(__notices.at(-1)).toContain('Not a URL');
	});

	it('refuses a scheme it cannot fetch', async () => {
		const { app } = fakeApp();
		expect(await clipUrlToVault(app, { url: 'ftp://example.com/x', template: DEFAULT_TEMPLATE })).toBeNull();
		expect(__notices.at(-1)).toContain('Only http and https');
	});

	it('reports an empty body rather than writing an empty note', async () => {
		serve('   ');
		const { app, files } = fakeApp();

		expect(await clipUrlToVault(app, { url: APNEWS, template: DEFAULT_TEMPLATE })).toBeNull();
		expect(files.size).toBe(0);
		expect(__notices.at(-1)).toContain('empty body');
	});

	it('falls back to the output folder when the template names no path', async () => {
		serve(readFileSync(join(fixtures, 'apnews-article.html'), 'utf8'));
		const { app } = fakeApp();

		const file = await clipUrlToVault(app, {
			url: APNEWS,
			template: { ...DEFAULT_TEMPLATE, path: '' },
			outputFolder: 'Inbox',
		});

		expect(file!.path).toMatch(/^Inbox\/.+\.md$/);
	});

	it('leaves the note closed when asked to', async () => {
		serve(readFileSync(join(fixtures, 'apnews-article.html'), 'utf8'));
		const { app, opened } = fakeApp();

		await clipUrlToVault(app, { url: APNEWS, template: DEFAULT_TEMPLATE, open: false });

		expect(opened).toEqual([]);
	});

	it('sends the configured user agent', async () => {
		let seen: string | undefined;
		__setRequestUrl(async (params) => {
			seen = params.headers?.['User-Agent'];
			return { status: 200, text: readFileSync(join(fixtures, 'apnews-article.html'), 'utf8'), headers: {}, json: null, arrayBuffer: new ArrayBuffer(0) };
		});
		const { app } = fakeApp();

		await clipUrlToVault(app, { url: APNEWS, template: DEFAULT_TEMPLATE, userAgent: 'Defuddler/test' });

		expect(seen).toBe('Defuddler/test');
	});

	it('keeps a second clip beside the first, the way Obsidian names a duplicate', async () => {
		serve(readFileSync(join(fixtures, 'apnews-article.html'), 'utf8'));
		const { app, contents } = fakeApp();

		const first = await clipUrlToVault(app, { url: APNEWS, template: DEFAULT_TEMPLATE });
		const before = contents.get(first!.path);
		const second = await clipUrlToVault(app, { url: APNEWS, template: DEFAULT_TEMPLATE });
		const third = await clipUrlToVault(app, { url: APNEWS, template: DEFAULT_TEMPLATE });

		// The first is untouched; the others sit beside it as ` 1` and ` 2`.
		expect(contents.get(first!.path)).toBe(before);
		expect(second!.path).toBe(first!.path.replace(/\.md$/, ' 1.md'));
		expect(third!.path).toBe(first!.path.replace(/\.md$/, ' 2.md'));
	});
});
