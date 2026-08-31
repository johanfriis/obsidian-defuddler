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
