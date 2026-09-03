import { TFile, TFolder, normalizePath } from 'obsidian';
import type { App } from 'obsidian';
import { FetchError } from './fetch';

/**
 * Writing the note. M1 implements `create` only; the other five behaviours in `Template['behavior']`
 * are M4, which is the debt P2 records — Obsidian's URI used to implement them for us.
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

export async function createNote(
	app: App,
	args: { folder: string; noteName: string; content: string },
): Promise<TFile> {
	const folder = normalizePath(args.folder.replace(/\/+$/, ''));
	const path = normalizePath(`${folder && folder !== '/' ? `${folder}/` : ''}${args.noteName}.md`);

	// `create` means create. A collision is reported rather than resolved, because *how* to resolve
	// it is a rule M4 has to choose and record — Obsidian's URI made that choice invisibly before,
	// and quietly overwriting or silently renaming are both worse than saying so.
	if (app.vault.getAbstractFileByPath(path)) {
		throw new FetchError(`A note already exists at \`${path}\``);
	}

	await ensureFolder(app, folder);
	return app.vault.create(path, args.content);
}
