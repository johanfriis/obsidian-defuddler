import { requestUrl } from 'obsidian';

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
