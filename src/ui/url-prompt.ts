import { Modal, Setting } from 'obsidian';
import type { App } from 'obsidian';

/**
 * Asks for the URL, prefilled from the clipboard when that worked.
 *
 * It opens every time rather than only on failure. That is P8 and the governing principle it serves:
 * the clipboard is a convenience, the human confirms what gets clipped, and a clipboard read that
 * throws on a phone degrades this to an empty field instead of an aborted command.
 */
export class UrlPrompt extends Modal {
	private value: string;
	private submitted = false;

	constructor(
		app: App,
		initial: string,
		private readonly onSubmit: (url: string) => void,
	) {
		super(app);
		this.value = initial;
	}

	onOpen(): void {
		this.setTitle('Clip a page');

		let input: HTMLInputElement | undefined;

		new Setting(this.contentEl).setName('URL').addText((text) => {
			text
				.setPlaceholder('https://example.com/article')
				.setValue(this.value)
				.onChange((value) => {
					this.value = value;
				});
			input = text.inputEl;
			text.inputEl.type = 'url';
			text.inputEl.addClass('defuddler-url-input');
			text.inputEl.addEventListener('keydown', (event) => {
				if (event.key === 'Enter') {
					event.preventDefault();
					this.submit();
				}
			});
		});

		new Setting(this.contentEl).addButton((button) =>
			button
				.setButtonText('Clip')
				.setCta()
				.onClick(() => this.submit()),
		);

		// Select rather than just focus, so a prefilled URL can be replaced by typing over it.
		input?.focus();
		input?.select();
	}

	private submit(): void {
		const url = this.value.trim();
		if (!url) return;
		this.submitted = true;
		this.close();
		this.onSubmit(url);
	}

	onClose(): void {
		this.contentEl.empty();
		if (!this.submitted) {
			// Cancelling is a decision, not a failure. Nothing is said and nothing is written.
		}
	}
}
