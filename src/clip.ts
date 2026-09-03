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
	// NOTE (M0/S1, GATE G3): upstream's clip() constructs Defuddle itself with `{ url }` and no
	// seam for other options, so `obsidianFetch` cannot reach it from here. Until G3 is decided,
	// Defuddle's site extractors run with the renderer's CORS-bound global fetch and silently lose
	// whatever they fetch — the YouTube transcript is the measured case: 262 chars instead of
	// 2,780. src/fetch.ts is written and proven; it is the wiring that is blocked.
	return upstreamClip({
		html: args.html,
		url: args.url,
		template: args.template,
		propertyTypes: args.propertyTypes,
		// A detached document. It has no layout, so Defuddle's getComputedStyle checks answer with
		// defaults rather than real values. M0/S1 measured this against the jsdom snapshots on all
		// five fixtures and found them identical, which is what P1 rests on.
		documentParser: new DOMParser(),
	});
}

/** Upstream's URL/schema trigger matching, re-exported so callers need not reach into vendor/. */
export { matchTemplate };
