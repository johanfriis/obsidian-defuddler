import { TFile, TFolder, normalizePath } from 'obsidian';
import type { App } from 'obsidian';
import { FetchError } from './fetch';

/**
 * Writing the note.
 *
 * There is one behaviour: create. Upstream's `Template` type carries six — append and prepend to a
 * named note or to today's daily note, and overwrite — and Johan's call on 2026-09-04 was that he
 * wants none of them. All twelve of kepano's published templates are `create` too. The field stays
 * in the type because it is upstream's, and is ignored everywhere.
 */

/** Creates the folder chain if it is missing, and complains if the path is a file. */
async function ensureFolder(app: App, folder: string): Promise<void> {
	if (!folder) return;
	const existing = app.vault.getAbstractFileByPath(folder);
	if (existing instanceof TFolder) return;
	if (existing instanceof TFile) {
		throw new FetchError(`Cannot save into \`${folder}\` — there is a note there, not a folder`);
	}
	await app.vault.createFolder(folder);
}

/**
 * The first free path for a note, following Obsidian's own convention: `Name`, then `Name 1`,
 * `Name 2`, and so on.
 *
 * Obsidian's public API exposes this only for attachments, and its note equivalent is not part of
 * the documented surface — so the convention is matched rather than the private helper called. The
 * point is that a second clip of the same page behaves the way a second note of the same name does
 * anywhere else in the app: it is kept, beside the first, not refused and not silently replaced.
 */
export function availablePath(app: App, folder: string, noteName: string): string {
	const prefix = folder && folder !== '/' ? `${folder}/` : '';
	const first = normalizePath(`${prefix}${noteName}.md`);
	if (!app.vault.getAbstractFileByPath(first)) return first;

	for (let n = 1; ; n++) {
		const candidate = normalizePath(`${prefix}${noteName} ${n}.md`);
		if (!app.vault.getAbstractFileByPath(candidate)) return candidate;
	}
}

export async function createNote(
	app: App,
	args: { folder: string; noteName: string; content: string },
): Promise<TFile> {
	const folder = normalizePath(args.folder.replace(/\/+$/, ''));
	await ensureFolder(app, folder);
	return app.vault.create(availablePath(app, folder, args.noteName), args.content);
}
