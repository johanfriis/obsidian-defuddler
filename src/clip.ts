import { clip as upstreamClip, matchTemplate } from '../vendor/obsidian-clipper/src/api';
import type { ClipResult, Template } from '../vendor/obsidian-clipper/src/api';

export type { ClipResult, Template };

/**
 * The engine binding: upstream's environment-agnostic `clip()` with Obsidian's DOM supplied as the
 * parser. See the playbook's §3 for what `clip()` does and for the two esbuild aliases this import
 * depends on.
 *
 * `propertyTypes` is how the vault's own property configuration reaches the frontmatter generator —
 * it is merged *over* whatever types the template declares, which is what lets a template file stay
 * silent about types (GATE G1).
 */
export function clipHtml(args: {
	html: string;
	url: string;
	template: Template;
	propertyTypes?: Record<string, string>;
}): Promise<ClipResult> {
	return upstreamClip({
		html: args.html,
		url: args.url,
		template: args.template,
		propertyTypes: args.propertyTypes,
		// A detached document. It has no layout, so Defuddle's getComputedStyle checks answer with
		// defaults rather than real values — the thing M0's S1 spike measures against the jsdom
		// snapshots before anything is built on top of it.
		documentParser: new DOMParser(),
	});
}

/** Upstream's URL/schema trigger matching, re-exported so callers need not reach into vendor/. */
export { matchTemplate };
