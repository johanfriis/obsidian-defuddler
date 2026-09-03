import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { preferredEnglishTrack, readCaptionTracks, transcriptLanguageFor } from '../src/youtube-captions';

const fixtures = join(dirname(fileURLToPath(import.meta.url)), 'fixtures');

describe('reading a watch page\'s caption tracks', () => {
	it('finds all eleven on the real page, and knows which are auto-generated', () => {
		const html = readFileSync(join(fixtures, 'youtube-multitrack.html'), 'utf8');
		const tracks = readCaptionTracks(html);

		expect(tracks.map((t) => t.languageCode)).toEqual([
			'en', 'en-US', 'fr', 'it', 'zh-Hant', 'ko', 'pl', 'pt-BR', 'ru', 'es', 'uk',
		]);
		// Only the bare `en` is auto-generated. That is the trap: Defuddle's exact-code match finds
		// it before it filters the auto-generated ones out.
		expect(tracks.filter((t) => t.auto).map((t) => t.languageCode)).toEqual(['en']);
	});

	it('picks the human-written en-US over the auto-generated en', () => {
		const html = readFileSync(join(fixtures, 'youtube-multitrack.html'), 'utf8');
		expect(transcriptLanguageFor(html)).toBe('en-US');
	});

	it('takes the auto-generated track when it is the only English one', () => {
		const html = readFileSync(join(fixtures, 'youtube-watch.html'), 'utf8');
		expect(transcriptLanguageFor(html)).toBeTruthy();
		expect(transcriptLanguageFor(html)!.toLowerCase().startsWith('en')).toBe(true);
	});
});

describe('choosing a track', () => {
	it('prefers human-written English, then any English, then nothing', () => {
		expect(
			preferredEnglishTrack([
				{ languageCode: 'zh-Hant', auto: false },
				{ languageCode: 'en', auto: true },
				{ languageCode: 'en-GB', auto: false },
			]),
		).toBe('en-GB');

		expect(preferredEnglishTrack([{ languageCode: 'en', auto: true }])).toBe('en');

		// No English at all: say nothing, and leave Defuddle's own behaviour in place.
		expect(preferredEnglishTrack([{ languageCode: 'da', auto: false }])).toBeUndefined();
		expect(preferredEnglishTrack([])).toBeUndefined();
	});

	it('does not mistake another language for English', () => {
		expect(preferredEnglishTrack([{ languageCode: 'eng-x', auto: false }])).toBeUndefined();
		expect(preferredEnglishTrack([{ languageCode: 'enm', auto: false }])).toBeUndefined();
	});
});

describe('when the page is not what we expect', () => {
	it('says nothing rather than guessing', () => {
		expect(transcriptLanguageFor('<html><body>an ordinary page</body></html>')).toBeUndefined();
		expect(transcriptLanguageFor('"captionTracks":')).toBeUndefined();
		expect(transcriptLanguageFor('"captionTracks":[{"languageCode":')).toBeUndefined();
		expect(transcriptLanguageFor('"captionTracks":[not json]')).toBeUndefined();
	});
});
