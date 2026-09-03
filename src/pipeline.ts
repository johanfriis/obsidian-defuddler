import { Notice, TFile } from 'obsidian';
import type { App } from 'obsidian';
import type { Template } from '../vendor/obsidian-clipper/src/api';
import { clipHtml, readableText } from './clip';
import { FetchError, fetchPage } from './fetch';
import { createNote } from './save';
import { transcriptLanguageFor } from './youtube-captions';

/**
 * URL in, note out. The whole of M1's happy path, and the seam every entry point uses: the command,
 * and from M5 the `obsidian://clip` handler.
 *
 * Nothing here fails silently. Every branch ends in a Notice the human can read and act on, which is
 * the governing principle applied to failure — surface it, never reroute around it.
 */
export async function clipUrlToVault(
	app: App,
	url: string,
	template: Template,
	/** The vault's property types, which win over the template's (GATE G1). */
	propertyTypes?: Record<string, string>,
): Promise<TFile | null> {
	const progress = new Notice('Fetching…', 0);

	try {
		const page = await fetchPage(url);

		progress.setMessage('Extracting…');
		// Only a YouTube watch page has caption tracks, so this is `undefined` everywhere else and
		// Defuddle keeps its own behaviour. See src/youtube-captions.ts for why it needs help here.
		const language = transcriptLanguageFor(page.html);
		const result = await clipHtml({
			html: page.html,
			// The URL we actually fetched, so a redirect is reflected in {{url}} and in relative links.
			url: page.url,
			template,
			propertyTypes,
			defuddle: language ? { language } : undefined,
		});

		progress.setMessage('Saving…');
		const file = await createNote(app, {
			folder: template.path,
			noteName: result.noteName,
			content: result.fullContent,
		});

		progress.hide();
		// P10: extraction that yields nothing is not an error. The note lands with its frontmatter
		// and whatever body there was, and says so rather than looking like a plain success.
		// The test is on readable text, not on the body's length — see `readableText`.
		new Notice(
			readableText(result.content)
				? `Clipped “${result.noteName}”`
				: `Clipped “${result.noteName}” — no readable body on that page`,
		);
		await app.workspace.getLeaf(true).openFile(file);
		return file;
	} catch (error) {
		progress.hide();
		if (error instanceof FetchError) {
			new Notice(error.message, 8000);
		} else {
			new Notice(`Could not clip: ${error instanceof Error ? error.message : String(error)}`, 8000);
		}
		return null;
	}
}
