import { defineConfig } from 'vitest/config';

// Scope to our own tests: the vendored submodule carries upstream's vitest suite,
// which needs upstream's node_modules. M1.7 wires the relevant upstream tests
// (highlighter*) into this harness deliberately.
export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
  },
});
