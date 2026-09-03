import { Plugin } from 'obsidian';
import { clipUrlToVault } from './src/pipeline';
import { DEFAULT_TEMPLATE, pickTemplate } from './src/templates';
import { UrlPrompt } from './src/ui/url-prompt';

export default class DefuddlerPlugin extends Plugin {
	async onload(): Promise<void> {
		this.addCommand({
			id: 'clip-from-clipboard',
			name: 'Clip from clipboard',
			callback: () => {
				void this.promptAndClip();
			},
		});
	}

	/**
	 * Reads the clipboard, then asks. P8: the clipboard is a prefill and never a requirement, so a
	 * read that throws — which is the shape of it on iOS, and the shape of an empty clipboard on
	 * Android — opens the same prompt with an empty field rather than aborting.
	 */
	private async promptAndClip(): Promise<void> {
		let prefill = '';
		try {
			const text = (await navigator.clipboard.readText()).trim();
			if (/^https?:\/\//i.test(text)) prefill = text;
		} catch {
			// Nothing to say. An unreadable clipboard is indistinguishable from an empty one here,
			// and both mean the same thing: the human types the URL.
		}

		new UrlPrompt(this.app, prefill, (url) => {
			// M2 replaces the single template with the vault's, and this call with a picker.
			void clipUrlToVault(this.app, url, pickTemplate([DEFAULT_TEMPLATE], url));
		}).open();
	}
}
