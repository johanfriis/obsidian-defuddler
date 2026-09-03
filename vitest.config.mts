import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    // Defuddle takes several seconds on the 864 KB apnews fixture, against vitest's 5 s default —
    // a margin thin enough that a loaded machine tipped it over and failed the run. This harness
    // guards every submodule and Defuddle bump; it must never fail for being slow.
    testTimeout: 30_000,
  },
});
