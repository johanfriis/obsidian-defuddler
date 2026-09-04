import { PluginSettingTab } from 'obsidian';
import type { App, Plugin, SettingDefinitionItem } from 'obsidian';
import { DEFAULT_USER_AGENT } from './fetch';

/**
 * Persisted settings. Everything lives in this one object, because `PluginSettingTab` reads and
 * writes `plugin.settings` wholesale and Obsidian's auto-persist clobbers sibling keys written
 * separately with `saveData` (P5). A control's `key` below is a key of this interface.
 */
export interface DefuddlerSettings {
	/** Where template files live. */
	templateFolder: string;
	/** Preselected in the picker when no template's trigger matches the URL. */
	defaultTemplate: string;
	/** Where a clip lands when its template names no path of its own. */
	outputFolder: string;
	/** Open the note after writing it. */
	openAfterClipping: boolean;
	/** Sent when fetching a page. Sites that vary by client should see something they recognise. */
	userAgent: string;
}

export const DEFAULT_SETTINGS: DefuddlerSettings = {
	templateFolder: 'Templates/Defuddler',
	defaultTemplate: '',
	outputFolder: 'Clippings',
	openAfterClipping: true,
	userAgent: DEFAULT_USER_AGENT,
};

export function withDefaults(loaded: unknown): DefuddlerSettings {
	return Object.assign({}, DEFAULT_SETTINGS, (loaded ?? {}) as Partial<DefuddlerSettings>);
}

/** What the tab needs from the plugin, without importing the plugin and creating a cycle. */
export interface SettingsHost extends Plugin {
	settings: DefuddlerSettings;
	templateNames(): string[];
}

/**
 * The settings tab, declared rather than rendered.
 *
 * `getSettingDefinitions()` is the whole of it — no `display()`, which `minAppVersion` 1.13.0 makes
 * dead code anyway, since a non-empty definition list bypasses it. `PluginSettingTab` reads and
 * persists `plugin.settings` on its own, so a control's `key` is all the wiring a value needs.
 *
 * The template dropdown is the one moving part: its options come from whatever is in the vault right
 * now, so the plugin calls `update()` when the folder reloads.
 */
export class DefuddlerSettingTab extends PluginSettingTab {
	constructor(
		app: App,
		private readonly host: SettingsHost,
	) {
		super(app, host);
	}

	getSettingDefinitions(): SettingDefinitionItem[] {
		const names = this.host.templateNames();
		const options: Record<string, string> = { '': names.length ? 'First in the list' : 'Built-in default' };
		for (const name of names) options[name] = name;

		return [
			{
				type: 'group',
				heading: 'Templates',
				items: [
					{
						name: 'Template folder',
						desc: 'Where template files live. Anything inside your Templater folder will also be offered by Templater as a note template.',
						control: { type: 'folder', key: 'templateFolder', placeholder: 'Templates/Defuddler' },
					},
					{
						name: 'Default template',
						desc: 'Preselected in the picker when no template matches the URL.',
						control: { type: 'dropdown', key: 'defaultTemplate', options },
					},
				],
			},
			{
				type: 'group',
				heading: 'Clipping',
				items: [
					{
						name: 'Output folder',
						desc: 'Where a clip lands when its template names no path of its own.',
						control: { type: 'folder', key: 'outputFolder', placeholder: 'Clippings' },
					},
					{
						name: 'Open the note after clipping',
						control: { type: 'toggle', key: 'openAfterClipping' },
					},
					{
						name: 'User agent',
						desc: 'Sent when fetching a page. Some sites serve a different page, or nothing at all, to a client they do not recognise.',
						control: {
							type: 'text',
							key: 'userAgent',
							placeholder: DEFAULT_SETTINGS.userAgent,
							validate: (value: string) =>
								value.trim() ? undefined : 'Leave this alone unless a site is refusing the default.',
						},
					},
				],
			},
		];
	}
}
