import { normalizePath } from 'obsidian';
import type { App } from 'obsidian';

/**
 * The vault's property types, which is where GATE G1 puts them instead of in every template file.
 *
 * `clip()` merges these *over* whatever types a template declares, so a template can stay silent
 * about types and still get `tags` as a real YAML list and `published` as a bare date. Obsidian's
 * own vocabulary already overlaps upstream's almost exactly — both use the word `multitext` — so the
 * mapping below is two aliases and nothing else.
 *
 * The config directory is resolved through `app.vault.configDir` rather than hardcoding `.obsidian`,
 * because a vault can be configured to use another name.
 *
 * **A failure here is a downgrade, not a break.** With no types every property falls to
 * `generateFrontmatter`'s default branch, which emits quoted text — valid YAML, just less useful.
 * So every error path returns an empty map rather than throwing.
 */

/** Obsidian type names that upstream does not know, and the closest thing it does. */
const ALIASES: Record<string, string> = {
	tags: 'multitext',
	aliases: 'multitext',
};

export async function readVaultPropertyTypes(app: App): Promise<Record<string, string>> {
	const path = normalizePath(`${app.vault.configDir}/types.json`);

	let raw: string;
	try {
		if (!(await app.vault.adapter.exists(path))) return {};
		raw = await app.vault.adapter.read(path);
	} catch {
		return {};
	}

	let types: unknown;
	try {
		types = (JSON.parse(raw) as { types?: unknown }).types;
	} catch {
		return {};
	}
	if (!types || typeof types !== 'object') return {};

	const mapped: Record<string, string> = {};
	for (const [name, type] of Object.entries(types as Record<string, unknown>)) {
		if (typeof type !== 'string') continue;
		mapped[name] = ALIASES[type] ?? type;
	}
	return mapped;
}
