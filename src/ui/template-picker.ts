import { FuzzySuggestModal } from 'obsidian';
import type { App, FuzzyMatch } from 'obsidian';
import type { Template } from '../../vendor/obsidian-clipper/src/api';

/**
 * Which template to clip with.
 *
 * The URL match is *preselected*, not applied: it sorts to the top and says why it is there, and the
 * human still confirms. That is P4 and the governing principle above it — when the machine could
 * decide or the human could, the human decides.
 */
export class TemplatePicker extends FuzzySuggestModal<Template> {
	constructor(
		app: App,
		private readonly templates: Template[],
		private readonly preselected: Template | undefined,
		/** Why it is preselected, shown beside it so the choice is legible rather than magic. */
		private readonly reason: string,
		private readonly onChoose: (template: Template) => void,
	) {
		super(app);
		this.setPlaceholder(
			preselected
				? `${preselected.name} — Enter to accept, or pick another`
				: 'Pick a template',
		);
	}

	getItems(): Template[] {
		if (!this.preselected) return this.templates;
		return [this.preselected, ...this.templates.filter((t) => t.id !== this.preselected!.id)];
	}

	getItemText(template: Template): string {
		return template.name;
	}

	renderSuggestion(match: FuzzyMatch<Template>, el: HTMLElement): void {
		super.renderSuggestion(match, el);
		const template = match.item;
		const note =
			template.id === this.preselected?.id ? this.reason : template.path || 'vault root';
		el.createDiv({ cls: 'defuddler-picker-note', text: note });
	}

	onChooseItem(template: Template): void {
		this.onChoose(template);
	}
}
