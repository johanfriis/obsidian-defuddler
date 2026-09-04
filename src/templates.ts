import { TFile, TFolder, normalizePath } from 'obsidian';
import type { App } from 'obsidian';
import { matchTemplate } from '../vendor/obsidian-clipper/src/api';
import type { Template } from '../vendor/obsidian-clipper/src/api';
import { TemplateFileError, buildTemplate, serialiseTemplate, splitFrontmatter } from './template-file';

/**
 * The template M2 writes into the vault on first run, and the one M1 clipped with.
 *
 * Modelled on the clips already in Sanctum's `Clippings` folder: title, source, author, published, a
 * creation stamp, and an empty tag list to fill in by hand. The types here are vestigial — since
 * GATE G1 the vault supplies them, and a template file cannot express one.
 */
export const DEFAULT_TEMPLATE: Template = {
	id: 'Default',
	name: 'Default',
	behavior: 'create',
	path: 'Clippings',
	noteNameFormat: '{{title}}',
	noteContentFormat: '{{content}}',
	properties: [
		{ name: 'title', value: '{{title}}' },
		{ name: 'source', value: '{{url}}' },
		{ name: 'author', value: '{{author}}' },
		{ name: 'published', value: '{{published}}' },
		// `{{date}}` and `{{time}}` are the same full timestamp, not a date and a time — so writing
		// both duplicated it. The filter is what shapes it, and this shape matches the `created`
		// already in Sanctum's clips.
		{ name: 'created', value: '{{date|date:"YYYY-MM-DD HH:mm"}}' },
		{ name: 'tags', value: '' },
	],
};

export interface TemplateLoadError {
	file: string;
	message: string;
}

export interface LoadedTemplates {
	templates: Template[];
	errors: TemplateLoadError[];
}

function collectMarkdown(folder: TFolder, into: TFile[]): void {
	for (const child of folder.children) {
		if (child instanceof TFolder) collectMarkdown(child, into);
		else if (child instanceof TFile && child.extension === 'md') into.push(child);
	}
}

/**
 * Reads every template in the folder.
 *
 * A bad file names itself and is skipped; it never takes the others down with it.
 *
 * The frontmatter is parsed here rather than read from `metadataCache` — see `splitFrontmatter` for
 * why. In short: the cache is not always ready, and a template it had not indexed yet loaded with no
 * triggers and no error, which is how URL matching came to look broken on mobile.
 */
export async function loadTemplates(app: App, folderPath: string): Promise<LoadedTemplates> {
	const folder = app.vault.getAbstractFileByPath(normalizePath(folderPath));
	if (!(folder instanceof TFolder)) return { templates: [], errors: [] };

	const files: TFile[] = [];
	collectMarkdown(folder, files);
	files.sort((a, b) => a.basename.localeCompare(b.basename));

	const templates: Template[] = [];
	const errors: TemplateLoadError[] = [];

	for (const file of files) {
		try {
			const { frontmatter, body } = splitFrontmatter(await app.vault.cachedRead(file));
			templates.push(buildTemplate(file.basename, frontmatter, body));
		} catch (error) {
			errors.push({
				file: file.path,
				message:
					error instanceof TemplateFileError
						? error.message
						: error instanceof Error
							? error.message
							: String(error),
			});
		}
	}

	return { templates, errors };
}

/** Creates the folder if missing, and seeds the default template when it holds no markdown. */
export async function ensureTemplateFolder(app: App, folderPath: string): Promise<void> {
	const path = normalizePath(folderPath);
	if (!path) return;

	const existing = app.vault.getAbstractFileByPath(path);
	if (existing instanceof TFile) return;
	if (!existing) await app.vault.createFolder(path);

	const { templates } = await loadTemplates(app, path);
	if (templates.length > 0) return;

	const seedPath = normalizePath(`${path}/${DEFAULT_TEMPLATE.name}.md`);
	if (!app.vault.getAbstractFileByPath(seedPath)) {
		await app.vault.create(seedPath, serialiseTemplate(DEFAULT_TEMPLATE));
	}
}

/**
 * Upstream's trigger matching. The result is a *preselection* for the picker, never an application
 * (P4, and the governing principle above it).
 *
 * Schema triggers are not passed: they need Defuddle to have parsed already (§3, fact 3), so URL
 * triggers — prefixes and `/regex/` — are what matches here.
 */
export function matchByUrl(templates: Template[], url: string): Template | undefined {
	return matchTemplate(templates, url);
}
