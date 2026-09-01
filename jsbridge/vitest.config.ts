import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const root = dirname(fileURLToPath(import.meta.url));
const upstreamSrc = join(root, 'vendor/obsidian-clipper/src');

/**
 * Provides `virtual:assets`, which `shim/browser.ts` imports and `build.mjs` supplies through an
 * esbuild plugin. Without it the shim cannot be imported outside a bundle — and it has to be
 * importable, because the upstream tests below run against *our* shim rather than upstream's mock.
 *
 * `messages` is the real bundled locale, so `i18n.getMessage` resolves the same strings it does on
 * the device. `assets` stays empty: nothing under test resolves a stylesheet, and compiling SCSS
 * on every test run would cost more than it proves (the bundle tests already assert the CSS is
 * embedded).
 */
function virtualAssets() {
  return {
    name: 'virtual-assets',
    resolveId: (id: string) => (id === 'virtual:assets' ? '\0virtual:assets' : null),
    load(id: string) {
      if (id !== '\0virtual:assets') return null;
      const messages = readFileSync(join(upstreamSrc, '_locales/en/messages.json'), 'utf8');
      return `export const assets = {};\nexport const messages = ${messages};\n`;
    },
  };
}

export default defineConfig({
  plugins: [virtualAssets()],
  define: {
    // Upstream's modules reference this global; esbuild defines it at bundle time (build.mjs).
    DEBUG_MODE: 'false',
  },
  resolve: {
    alias: {
      // The same single seam the bundle uses (§4, B1): upstream funnels every extension API
      // through this specifier. Pointing it at our shim is what makes the upstream tests below
      // guard *our* configuration rather than upstream's own mock.
      'webextension-polyfill': join(root, 'shim/browser.ts'),
    },
  },
  test: {
    // Builds the bundle once for every suite that needs it — see the file for why this cannot be
    // a per-file beforeAll.
    globalSetup: ['test/global-setup.ts'],
    // Defuddle takes ~4.3 s on the 864 KB apnews fixture, against vitest's 5 s default — a margin
    // thin enough that a loaded machine tipped it over and failed the run. This harness guards every
    // submodule bump (D14); it must never fail for being slow, so the ceiling is set well clear of
    // the work rather than just above it.
    testTimeout: 30_000,
    include: [
      'test/**/*.test.ts',
      // M1.7 / D14: upstream's own highlighter suites, run against our shim. They guard M4 before
      // it is built, and they are the first thing a submodule bump breaks if upstream reworks the
      // highlighter. The rest of the vendored suite stays out — it needs upstream's node_modules.
      'vendor/obsidian-clipper/src/utils/highlighter.test.ts',
      'vendor/obsidian-clipper/src/utils/highlighter-overlays.test.ts',
    ],
  },
});
