import { TFile, TFolder } from 'obsidian';

/**
 * An in-memory vault, enough for the save path, the template loader and the pipeline.
 *
 * It is deliberately strict about the three things our code leans on: `create` refuses an existing
 * path, `getAbstractFileByPath` distinguishes files from folders, and `getFileCache` returns
 * frontmatter only for files that were added with some — which is how a real metadata cache behaves
 * before it has indexed a file.
 */
export function fakeApp(options: { configDir?: string; types?: Record<string, string> | null } = {}) {
	const files = new Map<string, TFile>();
	const folders = new Map<string, TFolder>();
	const contents = new Map<string, string>();
	const frontmatters = new Map<string, Record<string, unknown>>();
	const opened: string[] = [];
	const configDir = options.configDir ?? '.obsidian';
	const configFiles = new Map<string, string>();

	if (options.types !== null) {
		configFiles.set(`${configDir}/types.json`, JSON.stringify({ types: options.types ?? {} }));
	}

	function folderFor(path: string): TFolder {
		if (!path) {
			let root = folders.get('');
			if (!root) {
				root = Object.assign(new TFolder(), { path: '', children: [] as unknown[] });
				folders.set('', root);
			}
			return root;
		}
		const existing = folders.get(path);
		if (existing) return existing;
		const folder = Object.assign(new TFolder(), { path, children: [] as unknown[] });
		folders.set(path, folder);
		const parent = folderFor(path.slice(0, Math.max(0, path.lastIndexOf('/'))));
		(parent as unknown as { children: unknown[] }).children.push(folder);
		return folder;
	}

	function makeFile(path: string, data: string): TFile {
		const slash = path.lastIndexOf('/');
		const name = path.slice(slash + 1);
		const dot = name.lastIndexOf('.');
		const file = Object.assign(new TFile(), {
			path,
			basename: dot === -1 ? name : name.slice(0, dot),
			extension: dot === -1 ? '' : name.slice(dot + 1),
		});
		files.set(path, file);
		contents.set(path, data);
		(folderFor(path.slice(0, Math.max(0, slash))) as unknown as { children: unknown[] }).children.push(file);
		return file;
	}

	const vault = {
		configDir,
		adapter: {
			exists: async (path: string) => configFiles.has(path),
			read: async (path: string) => {
				const value = configFiles.get(path);
				if (value === undefined) throw new Error(`no such file: ${path}`);
				return value;
			},
		},
		getAbstractFileByPath: (path: string) => files.get(path) ?? folders.get(path) ?? null,
		createFolder: async (path: string) => folderFor(path),
		create: async (path: string, data: string) => {
			if (files.has(path)) throw new Error('File already exists');
			return makeFile(path, data);
		},
		read: async (file: TFile) => contents.get(file.path) ?? '',
		cachedRead: async (file: TFile) => contents.get(file.path) ?? '',
	};

	const metadataCache = {
		getFileCache: (file: TFile) => {
			const frontmatter = frontmatters.get(file.path);
			return frontmatter ? { frontmatter } : {};
		},
	};

	const workspace = {
		getLeaf: () => ({
			openFile: async (file: TFile) => {
				opened.push(file.path);
			},
		}),
	};

	/** Adds a template file with its frontmatter already "indexed", as the real cache would have it. */
	function addTemplate(path: string, frontmatter: Record<string, unknown> | null, markdown: string) {
		const front = frontmatter
			? `---\n${Object.entries(frontmatter)
					.map(([k, v]) => (Array.isArray(v) ? `${k}:\n${v.map((i) => `  - ${i}`).join('\n')}` : `${k}: ${v}`))
					.join('\n')}\n---\n\n`
			: '';
		const file = makeFile(path, front + markdown);
		if (frontmatter) frontmatters.set(path, frontmatter);
		return file;
	}

	return {
		app: { vault, metadataCache, workspace } as never,
		files,
		folders,
		contents,
		opened,
		configFiles,
		addTemplate,
	};
}
