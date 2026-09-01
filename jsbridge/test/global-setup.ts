import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Builds the bundle once, before any test file runs.
 *
 * Two things make this a global step rather than a `beforeAll` in each file. It is built `--prod`
 * to a scratch path so the suite exercises exactly what ships without ever touching the committed
 * asset (D28) — and because vitest runs files in parallel, two suites each building to that one
 * scratch path raced, so a file could read a half-written bundle. That surfaced as a whole suite
 * skipping, intermittently, which is the worst possible failure mode for the harness that guards
 * every submodule bump.
 */
const root = dirname(dirname(fileURLToPath(import.meta.url)));

export const SCRATCH_BUNDLE = join(root, '.tmp/clipper-bundle.js');

export default function setup() {
  execFileSync(process.execPath, ['build.mjs', '--prod', '--outfile', SCRATCH_BUNDLE], {
    cwd: root,
    stdio: 'pipe',
  });
}
