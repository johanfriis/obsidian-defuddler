/**
 * Picking a YouTube transcript language, because Defuddle will not pick a good one on its own.
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
 * **This is the one place that knows what a YouTube page looks like**, and it is written to lose
 * quietly. Anything unexpected — no caption block, a shape that no longer parses, no English track —
 * returns `undefined`, which means "say nothing to Defuddle" and leaves its own behaviour in place.
 * A page that is not YouTube never reaches here.
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
