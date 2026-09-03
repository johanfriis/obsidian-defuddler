/**
 * Persisted settings. Everything lives in this one object and is written with `saveData`, because
 * Obsidian's auto-persist clobbers sibling keys written separately (P5).
 *
 * The settings *tab* is M3. M2 only needs somewhere to keep the template folder.
 */
export interface DefuddlerSettings {
	/** Where template files live. Kept out of `Templates/` so Templater does not list them. */
	templateFolder: string;
}

export const DEFAULT_SETTINGS: DefuddlerSettings = {
	templateFolder: 'Defuddler',
};

export function withDefaults(loaded: unknown): DefuddlerSettings {
	return Object.assign({}, DEFAULT_SETTINGS, (loaded ?? {}) as Partial<DefuddlerSettings>);
}
