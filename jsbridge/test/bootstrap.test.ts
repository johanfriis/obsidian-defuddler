import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parseHTML } from 'linkedom';

// Phase 0 placeholder suite (playbook §5 acceptance). Real extraction fixtures land in M1.7.
const root = join(dirname(fileURLToPath(import.meta.url)), '..');

describe('jsbridge bootstrap', () => {
  it('vendored obsidian-clipper submodule is present at the expected layout', () => {
    const pkgPath = join(root, 'vendor/obsidian-clipper/package.json');
    expect(
      existsSync(pkgPath),
      'submodule missing — clone with --recursive or run: git submodule update --init',
    ).toBe(true);
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
    expect(pkg.name).toBe('obsidian-clipper');
    // The Layer A seam documented in playbook §3.
    expect(existsSync(join(root, 'vendor/obsidian-clipper/src/api.ts'))).toBe(true);
    // The Layer B seam.
    expect(existsSync(join(root, 'vendor/obsidian-clipper/src/utils/reader.ts'))).toBe(true);
  });

  it('defuddle is installed at the pinned version', () => {
    const pkg = JSON.parse(
      readFileSync(join(root, 'node_modules/defuddle/package.json'), 'utf8'),
    );
    expect(pkg.version).toBe('0.19.3');
  });

  it('linkedom provides a working DOM for future extraction tests', () => {
    const { document } = parseHTML('<html><body><h1>hello</h1></body></html>');
    expect(document.querySelector('h1')?.textContent).toBe('hello');
  });
});
