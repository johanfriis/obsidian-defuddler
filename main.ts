import { Plugin } from 'obsidian';
import { clipHtml } from './src/clip';

/**
 * Phase 0 skeleton. It loads, it unloads, and it exposes the engine binding — nothing more. The
 * clip command, the template loader, the settings tab and the protocol handler arrive in M1–M5.
 * See docs/plan for the playbook.
 */
export default class DefuddlerPlugin extends Plugin {
	/**
	 * The clip engine. M1 hangs the command off this; Phase 0 holds it so the build measures the
	 * real bundle rather than an empty one.
	 */
	readonly clip = clipHtml;

	async onload(): Promise<void> {
		// Intentionally empty until M1.
	}
}
