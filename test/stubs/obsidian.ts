/**
 * Stands in for Obsidian's module inside vitest. Anything here that a test actually depends on
 * should be a deliberate fake; everything else throws, so a test that wanders into the real API
 * says so instead of quietly passing.
 */
export function requestUrl(): never {
	throw new Error('requestUrl is not available in tests — pass an explicit fetch instead');
}

export class Plugin {}
export class Notice {
	constructor(public message: string) {}
}
export class TFile {}
export const Platform = { isMobileApp: false, isDesktopApp: true, isIosApp: false, isAndroidApp: false };
export function normalizePath(path: string): string {
	return path;
}
