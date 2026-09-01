// Ambients the vendored submodule expects from its own tsconfig (`types: [chrome,
// webextension-polyfill, …]`), which we do not adopt — upstream is a pinned build input, checked
// by upstream's CI, and esbuild strips its types without checking them.
declare const chrome: any;

// build.mjs aliases this specifier to shim/browser.ts; the declaration only exists so tsc can
// resolve `src/utils/browser-polyfill.ts`'s import.
declare module 'webextension-polyfill' {
  const browser: any;
  export = browser;
}

// Replaced at build time by esbuild's `define` (true for the local debug build, false for the
// committed prod artifact — D28). Upstream declares it in its own build; our code reads it too.
declare const DEBUG_MODE: boolean;
