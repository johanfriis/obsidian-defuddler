import { requestUrl } from 'obsidian';
import type { RequestUrlResponse } from 'obsidian';

/**
 * A `fetch` implementation backed by Obsidian's `requestUrl`, for handing to Defuddle.
 *
 * Why this exists is M0/S1's finding, and it is not an optimisation. Defuddle's site extractors
 * make their own HTTP requests during parsing — YouTube's transcript is fetched from YouTube's API,
 * not read out of the page — and in a renderer the global `fetch` is CORS-bound, so those requests
 * fail silently and the extractor falls back to whatever it can read locally. Measured on the
 * YouTube fixture: 262 chars and no transcript with the global fetch, 2,780 chars and 506 words
 * with this one. Defuddle documents the `fetch` option for exactly this case.
 *
 * `requestUrl` is not CORS-bound and works on mobile, which is what makes the transcript reachable
 * from inside Obsidian at all.
 *
 * Two deliberate gaps, both harmless to Defuddle's use:
 *   - `AbortSignal` is ignored. Defuddle passes `AbortSignal.timeout(...)`; `requestUrl` has no
 *     cancellation, so a slow request runs to its own completion instead of being cut short.
 *   - The returned object is Response-*like*, carrying only what Defuddle reads: `ok`, `status`,
 *     `headers`, `text()`, `json()` and `arrayBuffer()`.
 */
export const obsidianFetch: typeof globalThis.fetch = async (input, init) => {
	const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;

	const headers: Record<string, string> = {};
	if (init?.headers) {
		new Headers(init.headers).forEach((value, key) => {
			headers[key] = value;
		});
	}

	const response = await requestUrl({
		url,
		method: init?.method ?? 'GET',
		headers,
		body: init?.body as string | ArrayBuffer | undefined,
		// Defuddle probes endpoints that legitimately answer 4xx; a throw would lose the fallback
		// path inside the extractor, so hand it the status and let it decide.
		throw: false,
	});

	return {
		ok: response.status >= 200 && response.status < 300,
		status: response.status,
		statusText: String(response.status),
		headers: new Headers(response.headers),
		url,
		text: async () => response.text,
		json: async () => response.json,
		arrayBuffer: async () => response.arrayBuffer,
	} as unknown as Response;
};

/**
 * A failure with a sentence fit to show the human. Every path out of `fetchPage` that is not a page
 * produces one of these, because P8's lesson generalises: a failure the user cannot see is worse
 * than one they can.
 */
export class FetchError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'FetchError';
	}
}

/** Chrome on Android. Sites that vary by client should see something they recognise. */
export const DEFAULT_USER_AGENT =
	'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36';

const DEFAULT_TIMEOUT_MS = 30_000;

/** Rejects an http(s) URL we cannot use before anything reaches the network. */
export function parseUrl(input: string): URL {
	let url: URL;
	try {
		url = new URL(input.trim());
	} catch {
		throw new FetchError(`Not a URL: ${input.trim().slice(0, 80)}`);
	}
	if (url.protocol !== 'http:' && url.protocol !== 'https:') {
		throw new FetchError(`Only http and https can be clipped, not ${url.protocol.replace(':', '')}`);
	}
	return url;
}

function describeStatus(status: number, host: string): string {
	if (status === 404) return `${host} says that page does not exist (404)`;
	if (status === 401) return `${host} wants you signed in (401)`;
	if (status === 403) return `${host} refused the request (403). It may be blocking non-browser clients`;
	if (status === 429) return `${host} is rate-limiting us (429). Try again shortly`;
	if (status >= 500) return `${host} had a server error (${status})`;
	return `${host} answered ${status}`;
}

/**
 * Fetches a page's HTML, or throws a FetchError whose message says what went wrong.
 *
 * `requestUrl` has no cancellation, so the timeout here frees the *caller* rather than the request:
 * a page that never answers stops blocking the command, but keeps running until it gives up on its
 * own. That is a deliberate trade — an unbounded spinner is the worse failure.
 */
export async function fetchPage(
	input: string,
	options: { timeoutMs?: number; userAgent?: string } = {},
): Promise<{ html: string; url: string }> {
	const url = parseUrl(input);
	const host = url.host;

	let timer = 0;
	const timeout = new Promise<never>((_, reject) => {
		timer = window.setTimeout(
			() => reject(new FetchError(`${host} did not answer within ${(options.timeoutMs ?? DEFAULT_TIMEOUT_MS) / 1000}s`)),
			options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
		);
	});

	let response: RequestUrlResponse;
	try {
		response = await Promise.race([
			requestUrl({
				url: url.href,
				headers: { 'User-Agent': options.userAgent ?? DEFAULT_USER_AGENT },
				throw: false,
			}),
			timeout,
		]);
	} catch (error) {
		if (error instanceof FetchError) throw error;
		if (!navigator.onLine) throw new FetchError('You appear to be offline');
		const detail = error instanceof Error ? error.message : String(error);
		throw new FetchError(`Could not reach ${host}: ${detail}`);
	} finally {
		window.clearTimeout(timer);
	}

	if (response.status >= 400) throw new FetchError(describeStatus(response.status, host));

	const html = response.text;
	if (!html || !html.trim()) throw new FetchError(`${host} answered ${response.status} with an empty body`);

	return { html, url: url.href };
}
