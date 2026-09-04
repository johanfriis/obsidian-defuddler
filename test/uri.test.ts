import { describe, expect, it } from 'vitest';
import type { ObsidianProtocolData } from 'obsidian';
import type { Template } from '../vendor/obsidian-clipper/src/api';
import { resolveClipUri } from '../src/uri';

const template = (name: string): Template => ({
	id: name,
	name,
	behavior: 'create',
	path: 'Clippings',
	noteNameFormat: '{{title}}',
	noteContentFormat: '{{content}}',
	properties: [],
});

const templates = [template('Default'), template('YouTube')];
const params = (rest: Record<string, string>): ObsidianProtocolData => ({ action: 'clip', ...rest });

describe('obsidian://clip', () => {
	it('picks a template when only a url is given', () => {
		expect(resolveClipUri(params({ url: 'https://example.com/a' }), templates)).toEqual({
			kind: 'pick',
			url: 'https://example.com/a',
		});
	});

	it('honours a named template', () => {
		expect(resolveClipUri(params({ url: 'https://example.com/a', template: 'YouTube' }), templates)).toEqual({
			kind: 'clip',
			url: 'https://example.com/a',
			template: templates[1],
		});
	});

	it('says so when the name is unknown, and still lets the human choose', () => {
		const outcome = resolveClipUri(
			params({ url: 'https://example.com/a', template: 'Gone' }),
			templates,
		);

		// Not an error: the clip is not thrown away, it just stops guessing at the shape.
		expect(outcome.kind).toBe('pick');
		expect(outcome).toMatchObject({ url: 'https://example.com/a' });
		expect((outcome as { message: string }).message).toContain('Gone');
	});

	it('complains about a missing or empty url rather than doing nothing', () => {
		expect(resolveClipUri(params({}), templates)).toMatchObject({ kind: 'error' });
		expect(resolveClipUri(params({ url: '   ' }), templates)).toMatchObject({ kind: 'error' });
		expect((resolveClipUri(params({}), templates) as { message: string }).message).toContain('url');
	});

	it('trims what it is given, since a share sheet often adds whitespace', () => {
		expect(
			resolveClipUri(params({ url: '  https://example.com/a  ', template: '  YouTube  ' }), templates),
		).toMatchObject({ kind: 'clip', url: 'https://example.com/a' });
	});

	// A malformed URL is not this function's business: the pipeline validates it and names the
	// problem in one place, whether it arrived from the command or from a URI.
	it('passes a malformed url through for the pipeline to reject', () => {
		expect(resolveClipUri(params({ url: 'not a url' }), templates)).toMatchObject({ kind: 'pick' });
	});
});
