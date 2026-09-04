import { Modal, Notice, Setting, TFile, normalizePath } from 'obsidian';
import type { App } from 'obsidian';
import type { Template } from '../../vendor/obsidian-clipper/src/api';
import { TemplateFileError, serialiseTemplate, templateFromExport } from '../template-file';

/**
 * Imports a Web Clipper template export and writes it out in the G1 format.
 *
 * Paste rather than file-pick, because that is how a template actually arrives: copied from
 * kepano/clipper-templates or from the extension's own export button, on a phone as often as a
 * desktop. The field is prefilled from the clipboard when that read works — same rule as the URL
 * prompt (P8).
 *
 * **Two things real exports do that the `Template` interface does not describe**, both measured
 * against kepano's: they carry a `schemaVersion` we ignore, and they have no `id`, so the template's
 * name supplies one.
 */
export class JsonImport extends Modal {
	private json: string;

	constructor(
		app: App,
		initial: string,
		private readonly folder: string,
	) {
		super(app);
		this.json = initial;
	}

	onOpen(): void {
		this.setTitle('Import a template from JSON');

		let area: HTMLTextAreaElement | undefined;
		new Setting(this.contentEl)
			.setName('Template JSON')
			.setDesc('An export from Web Clipper, or a file from kepano/clipper-templates.')
			.addTextArea((text) => {
				text.setValue(this.json).onChange((value) => {
					this.json = value;
				});
				area = text.inputEl;
				text.inputEl.rows = 12;
				text.inputEl.addClass('defuddler-json-input');
			});

		new Setting(this.contentEl).addButton((button) =>
			button
				.setButtonText('Import')
				.setCta()
				.onClick(() => {
					void this.import();
				}),
		);

		area?.focus();
	}

	private async import(): Promise<void> {
		let template: Template;
		let parsed: unknown;
		try {
			parsed = JSON.parse(this.json);
			template = templateFromExport(parsed);
		} catch (error) {
			new Notice(
				error instanceof TemplateFileError
					? `Cannot import: ${error.message}`
					: `That is not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
			);
			return;
		}

		// Defuddler only creates notes. Coercing an export that asked for something else is fine, but
		// doing it in silence is not — that is the mistake the old `behavior` handling made.
		const asked = (parsed as { behavior?: unknown }).behavior;
		if (typeof asked === 'string' && asked !== 'create') {
			new Notice(`That template asked to ${asked}. Defuddler only creates notes, so it will create one.`, 8000);
		}

		const name = template.name;
		const path = normalizePath(`${this.folder}/${name}.md`);
		if (this.app.vault.getAbstractFileByPath(path)) {
			new Notice(`A template already exists at \`${path}\``);
			return;
		}

		try {
			const file = await this.app.vault.create(path, serialiseTemplate(template));
			this.close();
			new Notice(`Imported “${name}”`);
			if (file instanceof TFile) await this.app.workspace.getLeaf(true).openFile(file);
		} catch (error) {
			new Notice(`Could not write the template: ${error instanceof Error ? error.message : String(error)}`);
		}
	}

	onClose(): void {
		this.contentEl.empty();
	}
}
