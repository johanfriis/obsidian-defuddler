import { Notice, Platform, TFile, normalizePath, requestUrl } from 'obsidian';
import type { App } from 'obsidian';
import Defuddle from 'defuddle/full';
import { obsidianFetch } from './fetch';

/**
 * M0's spike, as a command. Temporary: it exists to close GATE G0 and gets deleted with it.
 *
 * It answers S3's questions in one run on the phone — does requestUrl work, does DOMParser plus
 * Defuddle complete and how slowly, does the clipboard read, does the CORS-free fetch reach
 * YouTube's API — and it answers S2's remaining half, whether requestUrl's bytes extract the same
 * as curl's. It writes its findings to a note, because a Notice cannot be read carefully on a
 * phone and cannot be copied off it.
 *
 * It deliberately does not use upstream's clip(): that path is blocked on GATE G3, and none of
 * these questions need a template.
 */

const CASES: Array<{ name: string; url: string; expect: string }> = [
	{ name: 'stephango', url: 'https://stephango.com/vault', expect: '13584 chars / 1631 words' },
	{
		name: 'apnews',
		url: 'https://apnews.com/article/apple-iphone-keyboard-typing-tricks-shortcuts-78fd9488e6a1ebc0840be8a0d1d42032',
		expect: '3901 chars / 619 words',
	},
	{ name: 'github', url: 'https://github.com/obsidianmd/obsidian-clipper', expect: '6328 chars / 478 words' },
	{
		name: 'youtube',
		url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
		expect: '2780 chars / 506 words WITH a CORS-free fetch, 262 / 0 without',
	},
	{ name: 'instagram', url: 'https://www.instagram.com/explore/', expect: '22221 chars / 0 words' },
];

const UA =
	'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36';

async function clipboardProbe(): Promise<string> {
	try {
		const text = await navigator.clipboard.readText();
		return text ? `read ${text.length} chars, starts \`${text.slice(0, 40)}\`` : 'read succeeded but empty';
	} catch (error) {
		return `THREW: ${error instanceof Error ? error.message : String(error)}`;
	}
}

async function runCase(c: { name: string; url: string; expect: string }): Promise<string[]> {
	const lines: string[] = [`### ${c.name}`, '', `- url: ${c.url}`, `- desktop baseline: ${c.expect}`];

	let html: string;
	const fetchStart = Date.now();
	try {
		const response = await requestUrl({ url: c.url, headers: { 'User-Agent': UA }, throw: false });
		html = response.text;
		lines.push(`- requestUrl: ${response.status}, ${html.length} chars, ${Date.now() - fetchStart} ms`);
		if (response.status >= 400) {
			lines.push('', '**stopped: HTTP error**', '');
			return lines;
		}
	} catch (error) {
		lines.push(`- requestUrl: **THREW** ${error instanceof Error ? error.message : String(error)}`, '');
		return lines;
	}

	for (const [label, options] of [
		['global fetch', {}],
		['requestUrl fetch', { fetch: obsidianFetch }],
	] as const) {
		const start = Date.now();
		try {
			const doc = new DOMParser().parseFromString(html, 'text/html');
			const result = await new Defuddle(doc, { url: c.url, ...options }).parseAsync();
			const chars = (result.content ?? '').replace(/\s+/g, ' ').trim().length;
			lines.push(
				`- ${label}: ${chars} chars / ${result.wordCount ?? 0} words / ${Date.now() - start} ms` +
					` / title \`${(result.title ?? '').slice(0, 50)}\``,
			);
		} catch (error) {
			lines.push(`- ${label}: **THREW** ${error instanceof Error ? error.message : String(error)}`);
		}
	}

	lines.push('');
	return lines;
}

export async function runSpike(app: App): Promise<void> {
	new Notice('Defuddler spike: running, this takes a minute…');
	const started = Date.now();

	const lines: string[] = [
		`# Defuddler M0 spike — ${new Date().toISOString()}`,
		'',
		'## Environment',
		'',
		`- platform: ${Platform.isMobileApp ? 'mobile app' : Platform.isDesktopApp ? 'desktop app' : 'other'}` +
			`${Platform.isIosApp ? ' (iOS)' : Platform.isAndroidApp ? ' (Android)' : ''}`,
		`- obsidian: ${(window as unknown as { app?: { version?: string } }).app?.version ?? 'unknown'}`,
		`- clipboard read: ${await clipboardProbe()}`,
		'',
		'## Cases',
		'',
		'S1 measured every desktop baseline below through a real DOMParser. A row that matches its',
		'baseline is a pass. The youtube row is the one that separates the two fetches.',
		'',
	];

	for (const c of CASES) lines.push(...(await runCase(c)));

	lines.push('---', '', `Total ${Math.round((Date.now() - started) / 1000)} s.`);

	const path = normalizePath(`Defuddler spike ${Date.now()}.md`);
	const existing = app.vault.getAbstractFileByPath(path);
	if (existing instanceof TFile) {
		await app.vault.process(existing, () => lines.join('\n'));
	} else {
		await app.vault.create(path, lines.join('\n'));
	}
	new Notice(`Defuddler spike: done, wrote ${path}`);
	const leaf = app.workspace.getLeaf(true);
	const file = app.vault.getAbstractFileByPath(path);
	if (file instanceof TFile) await leaf.openFile(file);
}
