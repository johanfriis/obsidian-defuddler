/**
 * What we know about a YouTube watch page, and nowhere else knows.
 *
 * Two things Defuddle gets wrong on the bytes a server sends, both measured, both invisible unless
 * you compare against the browser extension: the transcript language, and the description.
 *
 * Given no `language` option, Defuddle drops the auto-generated tracks, looks for one whose code is
 * exactly `en`, and otherwise takes whichever track happens to be first. Measured on
 * `youtube-multitrack.html`, that first track is Traditional Chinese — for an English video. Asking
 * for a language the video does not carry lands in the same place, and asking for a bare `en` gets
 * the auto-generated captions even when a human-written `en-US` track exists, because the exact-code
 * match is made before the auto-generated ones are filtered out.
 *
 * So we choose the track and hand Defuddle its exact code. Johan's requirement, 2026-09-04: English
 * only, and a human-written track in preference to an auto-generated one.
 *
 * **The description** is the second. YouTube's server HTML carries *two* `<meta name="description">`
 * tags: its generic boilerplate first — localised, so ours arrived in Danish — and the video's real
 * description second. Defuddle takes the first. The browser extension does not hit this because by
 * the time it reads the page, YouTube's own script has replaced the boilerplate.
 *
 * **Everything here is written to lose quietly.** Anything unexpected — no caption block, no English
 * track, a shape that no longer parses, no description to be found — returns `undefined`, which
 * means "say nothing" and leaves Defuddle's own answer in place. A page that is not YouTube never
 * reaches here.
 */

export interface CaptionTrack {
	languageCode: string;
	/** YouTube marks auto-generated tracks with `"kind":"asr"`. Human-written ones carry no kind. */
	auto: boolean;
}

const MARKER = '"captionTracks":';

/**
 * Extracts the `captionTracks` array from a watch page.
 *
 * The array is real JSON inside the page's inline player data, so it is scanned to its matching
 * bracket and parsed rather than pattern-matched — the URLs inside carry escapes and separators that
 * defeat a regex.
 */
export function readCaptionTracks(html: string): CaptionTrack[] {
	const marker = html.indexOf(MARKER);
	if (marker === -1) return [];

	const start = html.indexOf('[', marker + MARKER.length);
	if (start === -1) return [];

	let depth = 0;
	let inString = false;
	let escaped = false;
	let end = -1;

	for (let i = start; i < html.length; i++) {
		const char = html[i];
		if (escaped) {
			escaped = false;
			continue;
		}
		if (inString) {
			if (char === '\\') escaped = true;
			else if (char === '"') inString = false;
			continue;
		}
		if (char === '"') inString = true;
		else if (char === '[' || char === '{') depth++;
		else if (char === ']' || char === '}') {
			depth--;
			if (depth === 0) {
				end = i;
				break;
			}
		}
	}
	if (end === -1) return [];

	try {
		const parsed: unknown = JSON.parse(html.slice(start, end + 1));
		if (!Array.isArray(parsed)) return [];
		return parsed
			.filter((track): track is { languageCode: string; kind?: string } =>
				!!track && typeof (track as { languageCode?: unknown }).languageCode === 'string',
			)
			.map((track) => ({ languageCode: track.languageCode, auto: track.kind === 'asr' }));
	} catch {
		return [];
	}
}

/**
 * The best English track's exact language code, or `undefined` when there is none.
 *
 * Human-written beats auto-generated; among equals, the order YouTube gave. A regional variant like
 * `en-US` is as English as `en`, and is usually the human-written one.
 */
export function preferredEnglishTrack(tracks: CaptionTrack[]): string | undefined {
	const english = tracks.filter((track) => /^en\b|^en-/i.test(track.languageCode));
	if (english.length === 0) return undefined;
	return (english.find((track) => !track.auto) ?? english[0]).languageCode;
}

/** The whole decision, from a fetched page. `undefined` means "leave Defuddle to it". */
export function transcriptLanguageFor(html: string): string | undefined {
	return preferredEnglishTrack(readCaptionTracks(html));
}

/**
 * The video's real description, or `undefined` when it cannot be found.
 *
 * `shortDescription` in the inline player data is the canonical copy and is unescaped JSON, so it is
 * tried first; `og:description` is the fallback and needs its HTML entities decoded. The boilerplate
 * `<meta name="description">` is what we are avoiding, so it is never consulted.
 */
export function descriptionFor(html: string): string | undefined {
	const short = /"shortDescription":"((?:[^"\\]|\\.)*)"/.exec(html);
	if (short) {
		try {
			const value = JSON.parse(`"${short[1]}"`) as string;
			if (value.trim()) return value;
		} catch {
			// Fall through to og:description.
		}
	}

	const og = /<meta[^>]+property="og:description"[^>]+content="([^"]*)"/.exec(html);
	if (og && og[1].trim()) return decodeEntities(og[1]);

	return undefined;
}

/** The handful of entities a `content="…"` attribute can carry. */
function decodeEntities(value: string): string {
	return value
		.replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)))
		.replace(/&quot;/g, '"')
		.replace(/&apos;/g, "'")
		.replace(/&lt;/g, '<')
		.replace(/&gt;/g, '>')
		.replace(/&amp;/g, '&');
}
