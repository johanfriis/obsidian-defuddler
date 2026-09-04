import type { Property, Template } from '../vendor/obsidian-clipper/src/api';

/**
 * The template file format decided at GATE G1.
 *
 * A template is a markdown file. Its own frontmatter is the template *config*; the first fenced
 * block is the note's frontmatter; everything after that block is the note's body. Property types
 * are not written here at all — they come from the vault (see `src/property-types.ts`), which is
 * what keeps `{{title}}` placeholders out of the vault's property index.
 *
 * ````markdown
 * ---
 * name: Article
 * path: Clippings
 * noteNameFormat: "{{title}}"
 * triggers:
 *   - https://apnews.com/
 * ---
 *
 * ## Template
 *
 * ```
 * title: {{title}}
 * source: {{url}}
 * published: {{published|date:"YYYY-MM-DD"}}
 * ```
 *
 * {{content}}
 * ````
 *
 * **The fenced block is split on each line's first colon, and never parsed as YAML.** It is a
 * template *for* YAML, not YAML: `published: {{published|date:"YYYY-MM-DD"}}` is not a valid bare
 * scalar, because the leading brace opens a flow mapping. Parsing it as YAML would force every
 * placeholder to be quoted and make a forgotten quote fail in silence.
 *
 * Anything before the first fence is decoration and is ignored, so a heading or a note to self costs
 * nothing. A file with no fence has no properties and is all body.
 */

export class TemplateFileError extends Error {}

/**
 * There is one behaviour, and it is not configurable.
 *
 * Upstream's `Template` carries six — append and prepend to a named note or to today's daily note,
 * and overwrite — because the Web Clipper offers them. Johan's call on 2026-09-04: he wants none of
 * them, and would never clip a page meaning to append it to a daily note. All twelve of kepano's
 * published templates are `create` as well. So `behavior` is not read from a template file, not
 * written to one, and not taken from an import; it is set here and ignored everywhere else. The
 * field stays on the type only because the type is upstream's.
 */
const BEHAVIOR: Template['behavior'] = 'create';

/** The config keys we read out of a template file's own frontmatter. */
export interface TemplateFrontmatter {
	name?: unknown;
	path?: unknown;
	noteNameFormat?: unknown;
	triggers?: unknown;
}

function asString(value: unknown): string | undefined {
	return typeof value === 'string' ? value : undefined;
}

/**
 * Splits a file's markdown into the fenced properties block and the body after it.
 *
 * `body` is everything following the closing fence, with leading blank lines trimmed and **trailing
 * newlines removed**. A markdown file always ends with one, and that is a property of the file, not
 * of the template — without this, every clipped note inherits a blank line the author never wrote.
 * When there is no fence, `propertyLines` is empty and the whole thing is the body.
 */
export function splitTemplateBody(markdown: string): { propertyLines: string[]; body: string } {
	const lines = markdown.split('\n');
	const trimBody = (text: string) => text.replace(/^\s*\n/, '').replace(/\n+$/, '');

	const openIndex = lines.findIndex((line) => /^\s*(```|~~~)/.test(line));
	if (openIndex === -1) return { propertyLines: [], body: trimBody(markdown) };

	const marker = /^\s*(```+|~~~+)/.exec(lines[openIndex])![1];
	const closeIndex = lines.findIndex(
		(line, index) => index > openIndex && line.trimStart().startsWith(marker),
	);
	if (closeIndex === -1) {
		throw new TemplateFileError('the properties block opens with a fence that is never closed');
	}

	return {
		propertyLines: lines.slice(openIndex + 1, closeIndex),
		body: trimBody(lines.slice(closeIndex + 1).join('\n')),
	};
}

/** One property per line, split on the first colon. Blank lines and `#` comments are skipped. */
export function parseProperties(lines: string[]): Property[] {
	const properties: Property[] = [];
	for (const line of lines) {
		if (!line.trim() || line.trimStart().startsWith('#')) continue;
		const colon = line.indexOf(':');
		if (colon === -1) {
			throw new TemplateFileError(`property line has no colon: \`${line.trim().slice(0, 60)}\``);
		}
		const name = line.slice(0, colon).trim();
		if (!name) throw new TemplateFileError(`property line has no name: \`${line.trim().slice(0, 60)}\``);
		// No type. Types come from the vault — GATE G1.
		properties.push({ name, value: line.slice(colon + 1).trim() });
	}
	return properties;
}

/**
 * Builds a Template from a file's frontmatter and its markdown body.
 *
 * `frontmatter` is Obsidian's own parse of the file's properties, so quoting and list syntax are its
 * problem rather than ours. `id` is the caller's to supply — real web-clipper exports have none, so
 * the file's base name is what stands in.
 */
export function buildTemplate(
	id: string,
	frontmatter: TemplateFrontmatter | null,
	markdown: string,
): Template {
	const fm = frontmatter ?? {};
	const rawTriggers = fm.triggers;
	const triggers = Array.isArray(rawTriggers)
		? rawTriggers.filter((t): t is string => typeof t === 'string')
		: asString(rawTriggers)
			? [asString(rawTriggers)!]
			: undefined;

	const { propertyLines, body } = splitTemplateBody(markdown);

	return {
		id,
		name: asString(fm.name) ?? id,
		behavior: BEHAVIOR,
		path: asString(fm.path) ?? '',
		noteNameFormat: asString(fm.noteNameFormat) ?? '{{title}}',
		noteContentFormat: body,
		properties: parseProperties(propertyLines),
		triggers,
	};
}

/** Writes a Template back out in the G1 format — for the default template and for JSON imports. */
export function serialiseTemplate(template: Template): string {
	const quote = (value: string) => (/[:{}[\]#&*!|>'"%@`]/.test(value) ? JSON.stringify(value) : value);

	const front = [
		'---',
		`name: ${quote(template.name)}`,
		`path: ${quote(template.path)}`,
		`noteNameFormat: ${quote(template.noteNameFormat)}`,
	];
	if (template.triggers?.length) {
		front.push('triggers:');
		for (const trigger of template.triggers) front.push(`  - ${quote(trigger)}`);
	}
	front.push('---');

	return [
		...front,
		'',
		'## Template',
		'',
		'```',
		...template.properties.map((property) => `${property.name}: ${property.value}`),
		'```',
		'',
		template.noteContentFormat,
		'',
	].join('\n');
}

/**
 * Converts a Web Clipper JSON export into a Template.
 *
 * **Three things real exports do that the `Template` interface does not describe**, all measured
 * against kepano/clipper-templates:
 *
 *   - they carry a `schemaVersion` the interface has no field for, which is ignored rather than
 *     rejected;
 *   - they have **no `id`**, which the interface requires, so the template's name supplies one;
 *   - they declare a `type` on each property, which is dropped. Since GATE G1 types come from the
 *     vault, and a type carried in a template would quietly win over the vault's for that one
 *     template — the surprise being worse than the loss.
 *
 * `behavior` is dropped too, for the reason at `BEHAVIOR` above. The caller is expected to say so
 * when an export asked for something other than `create`, rather than letting the coercion pass in
 * silence.
 */
export function templateFromExport(json: unknown): Template {
	if (!json || typeof json !== 'object') {
		throw new TemplateFileError('that is not a template object');
	}
	const source = json as Partial<Template> & { schemaVersion?: string };

	const name = (asString(source.name) ?? '').trim();
	if (!name) throw new TemplateFileError('that JSON has no `name`, so there is nothing to call it');

	return {
		id: name,
		name,
		behavior: BEHAVIOR,
		path: asString(source.path) ?? '',
		noteNameFormat: asString(source.noteNameFormat) ?? '{{title}}',
		noteContentFormat: asString(source.noteContentFormat) ?? '{{content}}',
		properties: (source.properties ?? [])
			.filter((property) => property && typeof property.name === 'string')
			.map((property) => ({ name: property.name, value: property.value ?? '' })),
		triggers: Array.isArray(source.triggers)
			? source.triggers.filter((t): t is string => typeof t === 'string')
			: undefined,
	};
}
