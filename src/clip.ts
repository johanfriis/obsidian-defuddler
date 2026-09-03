import Defuddle, { createMarkdownContent } from 'defuddle/full';
import type { DefuddleOptions } from 'defuddle/full';
import { createAsyncResolver, createSelectorProcessor, matchTemplate } from '../vendor/obsidian-clipper/src/api';
import type { ClipResult, Property, Template } from '../vendor/obsidian-clipper/src/api';
import { compileTemplate } from '../vendor/obsidian-clipper/src/utils/template-compiler';
import {
	buildVariables,
	formatPropertyValue,
	generateFrontmatter,
} from '../vendor/obsidian-clipper/src/utils/shared';
import { sanitizeFileName } from '../vendor/obsidian-clipper/src/utils/string-utils';
import { obsidianFetch } from './fetch';

export type { ClipResult, Template, Property };
export { matchTemplate };

/**
 * Our own `clip()`. GATE G3, Option A, decided 2026-09-04.
 *
 * This mirrors the body of upstream's `api.ts` `clip()` and exists because that function gives its
 * caller no way to reach Defuddle. It builds Defuddle with `{ url }` and nothing else, and
 * `ClipOptions` has no passthrough — so two things are unreachable from outside, and M0/S1 measured
 * both as mattering:
 *
 *   1. **`DefuddleOptions`.** Without them we cannot hand Defuddle a fetch that is not CORS-bound,
 *      and its site extractors silently lose everything they fetch. Measured on YouTube: 262 chars
 *      instead of 2,780. `language`, `includeReplies`, `removeImages` and `removeSmallImages` are
 *      behind the same wall and are all plausible settings.
 *   2. **`parseAsync()`.** Upstream calls the synchronous `parse()`, which never runs the async
 *      extractors at all. So injecting a fetch by any other route would still not have worked —
 *      measured over three runs: `parse()` 262 chars, `parseAsync()` 2,780.
 *   3. **It hands Defuddle the wrong object.** Upstream passes `doc.documentElement`; Defuddle
 *      wants a `Document`. With a real `DOMParser` that element is an `HTMLHtmlElement` and
 *      extraction returns nothing — 0 chars against 13,584. This one is not an enhancement we
 *      wanted, it is the reason the wrapper cannot be used here at all.
 *
 * **Everything else stays upstream's.** The variable builder, the template compiler, the filters,
 * the selector resolvers, the property formatting and the frontmatter generation are all imported,
 * not reimplemented. What is forked is the ~40 lines of wiring between them.
 *
 * `test/clip-parity.test.ts` holds this honest: it runs both implementations over every fixture and
 * fails if they disagree. A submodule bump that changes any helper's behaviour moves that test, and
 * one that changes a signature fails the typecheck in this file.
 */

export interface ClipArgs {
	html: string;
	url: string;
	template: Template;
	/** Merged *over* the types the template declares — this is how the vault's types win (G1). */
	propertyTypes?: Record<string, string>;
	/** Pre-parsed document, to avoid parsing twice when the caller already needed one. */
	parsedDocument?: Document;
	/** Defuddle options. The whole reason this function exists; see the note above. */
	defuddle?: Partial<DefuddleOptions>;
}

export async function clipHtml(args: ClipArgs): Promise<ClipResult> {
	const { html, url, template, propertyTypes, parsedDocument } = args;

	// A detached document. It has no layout, so Defuddle's getComputedStyle checks answer with
	// defaults rather than real values. S1 measured this against the jsdom harness on all five
	// fixtures and found them identical, which is what P1 rests on.
	const doc = parsedDocument ?? new DOMParser().parseFromString(html, 'text/html');

	// The Document, not `doc.documentElement`. Upstream passes the element, which is the third
	// reason this function is forked and the one that decides it: Defuddle needs a Document, and
	// with a real DOMParser `documentElement` is a plain HTMLHtmlElement, so upstream's clip()
	// extracts **nothing at all** in a browser. Measured on the stephango fixture: 13,584 chars
	// passing the document, 0 passing the element. It works for upstream's CLI only because
	// linkedom's `.documentElement` is document-like. `test/clip.test.ts` pins the defect, so if a
	// submodule bump fixes it upstream, that test fails and G3 is worth revisiting.
	const defuddleResult = await new Defuddle(doc, {
		url,
		fetch: obsidianFetch,
		...args.defuddle,
	}).parseAsync();

	const markdownContent = createMarkdownContent(defuddleResult.content, url);

	const variables = buildVariables({
		title: defuddleResult.title,
		author: defuddleResult.author,
		content: markdownContent,
		contentHtml: defuddleResult.content,
		url,
		fullHtml: html,
		description: defuddleResult.description,
		favicon: defuddleResult.favicon,
		image: defuddleResult.image,
		published: defuddleResult.published,
		site: defuddleResult.site,
		language: defuddleResult.language,
		wordCount: defuddleResult.wordCount,
		schemaOrgData: defuddleResult.schemaOrgData,
		metaTags: defuddleResult.metaTags,
		extractedContent: defuddleResult.variables,
	});

	const asyncResolver = createAsyncResolver(doc);
	const selectorProcessor = createSelectorProcessor(doc);
	const compile = (text: string) =>
		compileTemplate(0, text, variables, url, asyncResolver, selectorProcessor);

	const noteName = sanitizeFileName(await compile(template.noteNameFormat)) || 'Untitled';

	const properties: Property[] = await Promise.all(
		template.properties.map(async (property) => ({
			name: property.name,
			value: formatPropertyValue(
				await compile(property.value),
				property.type || 'text',
				property.value,
			),
			type: property.type,
		})),
	);

	const typeMap: Record<string, string> = {};
	for (const property of template.properties) {
		if (property.type) typeMap[property.name] = property.type;
	}
	if (propertyTypes) Object.assign(typeMap, propertyTypes);

	const frontmatter = generateFrontmatter(properties, typeMap);
	const content = await compile(template.noteContentFormat);

	return {
		noteName,
		frontmatter,
		content,
		fullContent: frontmatter ? frontmatter + content : content,
		properties,
		variables,
	};
}
