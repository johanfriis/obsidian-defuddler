import { matchTemplate } from '../vendor/obsidian-clipper/src/api';
import type { Template } from '../vendor/obsidian-clipper/src/api';

/**
 * The template M1 clips with, and the one M2 writes into the vault on first run.
 *
 * Modelled on the clips already in Sanctum's `Clippings` folder: title, source, author, published,
 * a creation stamp and an empty tag list to fill in by hand. Types are spelled out here because
 * nothing reads the vault's property configuration yet — that is M2, and it will make most of these
 * redundant (GATE G1).
 */
export const DEFAULT_TEMPLATE: Template = {
	id: 'default',
	name: 'Default',
	behavior: 'create',
	path: 'Clippings',
	noteNameFormat: '{{title}}',
	noteContentFormat: '{{content}}',
	properties: [
		{ name: 'title', value: '{{title}}', type: 'text' },
		{ name: 'source', value: '{{url}}', type: 'text' },
		{ name: 'author', value: '{{author}}', type: 'text' },
		{ name: 'published', value: '{{published}}', type: 'date' },
		{ name: 'created', value: '{{date}} {{time}}', type: 'datetime' },
		{ name: 'tags', value: '', type: 'multitext' },
	],
};

/**
 * Upstream's trigger matching, with a fallback. M1 has one template so this always returns it; M2
 * gives it a list and a picker, where the match becomes a *preselection* rather than a choice
 * (P4, and the governing principle above it).
 *
 * Schema triggers are not passed: they need Defuddle to have parsed already (§3, fact 3), so M1
 * matches on URL triggers alone.
 */
export function pickTemplate(templates: Template[], url: string): Template {
	return matchTemplate(templates, url) ?? templates[0];
}
