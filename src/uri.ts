import type { ObsidianProtocolData } from 'obsidian';
import type { Template } from '../vendor/obsidian-clipper/src/api';

/**
 * What `obsidian://clip` should do, decided separately from doing it.
 *
 * The handler itself is three lines in `main.ts`; this is the part with rules in it, and the part
 * worth testing without an app around it.
 *
 * A named template is an explicit choice and is honoured. An unknown name is *said out loud* and
 * then falls through to the picker rather than quietly clipping with the wrong shape — surfacing the
 * failure instead of rerouting around it, which is the governing principle applied to a URL that
 * arrived from somewhere else.
 */
export type ClipUriOutcome =
	| { kind: 'error'; message: string }
	| { kind: 'clip'; url: string; template: Template }
	| { kind: 'pick'; url: string; message?: string };

export function resolveClipUri(
	params: ObsidianProtocolData,
	templates: Template[],
): ClipUriOutcome {
	const url = typeof params.url === 'string' ? params.url.trim() : '';
	if (!url) {
		return { kind: 'error', message: 'obsidian://clip needs a `url` parameter' };
	}

	const wanted = typeof params.template === 'string' ? params.template.trim() : '';
	if (!wanted) return { kind: 'pick', url };

	const named = templates.find((template) => template.name === wanted);
	if (named) return { kind: 'clip', url, template: named };

	return { kind: 'pick', url, message: `No template called “${wanted}” — pick one instead` };
}
