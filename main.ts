import { Notice, Plugin, TAbstractFile, debounce, normalizePath } from 'obsidian';
import type { Template } from './vendor/obsidian-clipper/src/api';
import { clipUrlToVault } from './src/pipeline';
import { readVaultPropertyTypes } from './src/property-types';
import { DEFAULT_SETTINGS, DefuddlerSettingTab, withDefaults } from './src/settings';
import type { DefuddlerSettings } from './src/settings';
import { DEFAULT_TEMPLATE, ensureTemplateFolder, loadTemplates, matchByUrl } from './src/templates';
import { JsonImport } from './src/ui/json-import';
import { TemplatePicker } from './src/ui/template-picker';
import { UrlPrompt } from './src/ui/url-prompt';

export default class DefuddlerPlugin extends Plugin {
	settings: DefuddlerSettings = DEFAULT_SETTINGS;
	private templates: Template[] = [];
	private settingTab?: DefuddlerSettingTab;

	/** The template dropdown's options. Read on every render of the settings tab. */
	templateNames(): string[] {
		return this.templates.map((template) => template.name);
	}

	async onload(): Promise<void> {
		this.settings = withDefaults(await this.loadData());
		this.settingTab = new DefuddlerSettingTab(this.app, this);
		this.addSettingTab(this.settingTab);

		this.addCommand({
			id: 'clip-from-clipboard',
			name: 'Clip from clipboard',
			callback: () => {
				void this.promptAndClip();
			},
		});

		this.addCommand({
			id: 'import-template-json',
			name: 'Import a template from JSON',
			callback: () => {
				void this.importTemplate();
			},
		});

		// The folder is seeded and read once the vault is indexed, not during onload — a template
		// whose frontmatter the metadata cache has not parsed yet is unreadable, and would report as
		// broken rather than as early.
		this.app.workspace.onLayoutReady(() => {
			void this.refreshTemplates(true);
		});

		// Registered one by one rather than in a loop: `rename` has a different callback shape from
		// the other three, so the union does not typecheck as one handler.
		const refresh = debounce(() => void this.refreshTemplates(false), 400, true);
		const onTouched = (file: TAbstractFile, oldPath?: string) => {
			if (this.inTemplateFolder(file.path) || (oldPath && this.inTemplateFolder(oldPath))) refresh();
		};
		this.registerEvent(this.app.metadataCache.on('resolved', refresh));
		this.registerEvent(this.app.vault.on('create', onTouched));
		this.registerEvent(this.app.vault.on('modify', onTouched));
		this.registerEvent(this.app.vault.on('delete', onTouched));
		this.registerEvent(this.app.vault.on('rename', onTouched));
	}

	private inTemplateFolder(path: string): boolean {
		const folder = normalizePath(this.settings.templateFolder);
		return !!folder && (path === folder || path.startsWith(`${folder}/`));
	}

	/**
	 * Re-reads the template folder. Bad files name themselves and are skipped; the rest still load,
	 * so one broken template never costs the others.
	 */
	private async refreshTemplates(seed: boolean): Promise<void> {
		try {
			if (seed) await ensureTemplateFolder(this.app, this.settings.templateFolder);
			const { templates, errors } = await loadTemplates(this.app, this.settings.templateFolder);
			this.templates = templates;
			// The default-template dropdown is built from what is in the vault, so the tab has to be
			// told when that changes. Cheap, and only touches definitions.
			this.settingTab?.update();
			for (const error of errors) new Notice(`Template \`${error.file}\`: ${error.message}`, 10000);
		} catch (error) {
			new Notice(
				`Could not read the template folder: ${error instanceof Error ? error.message : String(error)}`,
			);
		}
	}

	/**
	 * Reads the clipboard, then asks. P8: the clipboard is a prefill and never a requirement, so a
	 * read that throws — which is the shape of it on iOS, and of an empty clipboard on Android —
	 * opens the same prompt with an empty field rather than aborting.
	 */
	private async promptAndClip(): Promise<void> {
		const clipboard = await readClipboard();
		const prefill = /^https?:\/\//i.test(clipboard) ? clipboard : '';

		new UrlPrompt(this.app, prefill, (url) => {
			void this.pickTemplateAndClip(url);
		}).open();
	}

	/**
	 * The picker opens whenever there is a choice to make. With exactly one template there is none,
	 * so it does not — deferring to the human means letting them decide, not making them confirm.
	 */
	private async pickTemplateAndClip(url: string): Promise<void> {
		const available = this.templates.length ? this.templates : [DEFAULT_TEMPLATE];

		const clip = async (template: Template) => {
			await clipUrlToVault(this.app, {
				url,
				template,
				propertyTypes: await readVaultPropertyTypes(this.app),
				outputFolder: this.settings.outputFolder,
				open: this.settings.openAfterClipping,
				userAgent: this.settings.userAgent,
			});
		};

		if (available.length === 1) {
			await clip(available[0]);
			return;
		}

		// A trigger match preselects; failing that, the configured default does. Neither applies the
		// template — the human still confirms (P4).
		const matched = matchByUrl(available, url);
		const preselected =
			matched ?? available.find((template) => template.name === this.settings.defaultTemplate);
		const reason = matched
			? `matches ${matched.triggers?.[0] ?? 'this URL'}`
			: 'your default template';

		new TemplatePicker(this.app, available, preselected, reason, (template) => {
			void clip(template);
		}).open();
	}

	private async importTemplate(): Promise<void> {
		const clipboard = await readClipboard();
		const prefill = clipboard.trimStart().startsWith('{') ? clipboard : '';
		await ensureTemplateFolder(this.app, this.settings.templateFolder);
		new JsonImport(this.app, prefill, this.settings.templateFolder).open();
	}
}

/** Never throws. An unreadable clipboard and an empty one mean the same thing to every caller. */
async function readClipboard(): Promise<string> {
	try {
		return (await navigator.clipboard.readText()).trim();
	} catch {
		return '';
	}
}
