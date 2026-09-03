import { TFile, TFolder } from 'obsidian';

/**
 * An in-memory vault, enough for the save path and the pipeline. It is deliberately strict about the
 * two things `src/save.ts` relies on: `create` refuses an existing path, and `createFolder` refuses
 * a missing parent — both of which the real vault does.
 */
export function fakeApp() {
	const files = new Map<string, TFile>();
	const folders = new Map<string, TFolder>();
	const contents = new Map<string, string>();
	const opened: string[] = [];

	const vault = {
		getAbstractFileByPath: (path: string) => files.get(path) ?? folders.get(path) ?? null,
		createFolder: async (path: string) => {
			const folder = Object.assign(new TFolder(), { path });
			folders.set(path, folder);
			return folder;
		},
		create: async (path: string, data: string) => {
			if (files.has(path)) throw new Error('File already exists');
			const file = Object.assign(new TFile(), { path });
			files.set(path, file);
			contents.set(path, data);
			return file;
		},
		read: async (file: TFile) => contents.get(file.path) ?? '',
	};

	const workspace = {
		getLeaf: () => ({
			openFile: async (file: TFile) => {
				opened.push(file.path);
			},
		}),
	};

	return { app: { vault, workspace } as never, files, folders, contents, opened };
}
