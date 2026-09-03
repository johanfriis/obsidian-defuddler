/**
 * Stands in for Obsidian's module inside vitest.
 *
 * Anything a test legitimately depends on is a deliberate fake; everything else throws, so a test
 * that wanders into the real API says so rather than quietly passing. `requestUrl` starts as a
 * throw and has to be installed per test, which keeps a suite from reaching the network by accident.
 */

type RequestUrlImpl = (params: { url: string; headers?: Record<string, string> }) => Promise<{
	status: number;
	text: string;
	headers: Record<string, string>;
	json: unknown;
	arrayBuffer: ArrayBuffer;
}>;

let requestUrlImpl: RequestUrlImpl | null = null;

/** Installs the fake for one test. Pass `null` to put the throw back. */
export function __setRequestUrl(impl: RequestUrlImpl | null): void {
	requestUrlImpl = impl;
}

export function requestUrl(params: { url: string; headers?: Record<string, string> }) {
	if (!requestUrlImpl) {
		throw new Error('requestUrl is not available in tests — install one with __setRequestUrl');
	}
	return requestUrlImpl(params);
}

/** Every Notice raised during a test, in order, so a test can assert on what the human was told. */
export const __notices: string[] = [];

export class Notice {
	constructor(message: string) {
		__notices.push(message);
	}
	setMessage(message: string): this {
		__notices.push(message);
		return this;
	}
	hide(): void {}
}

export class Plugin {}
export class TFile {
	path = '';
	basename = '';
	extension = '';
}
export class TFolder {
	path = '';
	children: unknown[] = [];
}
export class Modal {}
export class Setting {}
export const Platform = { isMobileApp: false, isDesktopApp: true, isIosApp: false, isAndroidApp: false };
export function normalizePath(path: string): string {
	return path.replace(/\/+/g, '/').replace(/^\/|\/$/g, '');
}
