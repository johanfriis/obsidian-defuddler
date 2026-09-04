import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const root = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      // Plugin code imports `obsidian`, which only exists inside the app. The stub is deliberately
      // hostile: everything a test has no business calling throws.
      obsidian: join(root, 'test/stubs/obsidian.ts'),
      // Mirrors esbuild.config.mjs. Upstream's api.ts reaches the polyfill transitively; see the
      // playbook's §3, fact 1.
      'webextension-polyfill': join(root, 'vendor/obsidian-clipper/src/utils/cli-stubs.ts'),
    },
  },
  define: {
    // Upstream's modules reference this global; esbuild defines it at bundle time.
    DEBUG_MODE: 'false',
  },
  test: {
    include: ['test/**/*.test.ts'],
    // Drops one expected-and-loud message from Defuddle; see the file for why.
    setupFiles: [join(root, 'test/setup.ts')],
    // Defuddle takes several seconds on the 864 KB apnews fixture, against vitest's 5 s default —
    // a margin thin enough that a loaded machine tipped it over and failed the run. This harness
    // guards every submodule and Defuddle bump; it must never fail for being slow.
    testTimeout: 30_000,
  },
});
