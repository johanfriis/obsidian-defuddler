// Typechecks our code, not upstream's.
//
// The vendored submodule is a pinned *build input*: it has its own tsconfig, its own `types` and
// its own CI, and esbuild strips its types without checking them. It does not pass under our
// options, and it does not have to. `exclude` cannot express this, because tsc still checks any
// file reachable by import from an included one, and src/clip.ts imports upstream's api.ts by
// design (playbook P3).
//
// So: run tsc, report diagnostics from our files, count the submodule's and move on. A real fault
// in our code still surfaces, because our files are where we would write it.

import { spawnSync } from 'node:child_process';

const tsc = spawnSync(
  process.platform === 'win32' ? 'npx.cmd' : 'npx',
  ['tsc', '--noEmit', '--pretty', 'false'],
  { encoding: 'utf8' },
);

const lines = `${tsc.stdout ?? ''}${tsc.stderr ?? ''}`.split(/\r?\n/).filter(Boolean);
const ours = lines.filter((line) => !line.startsWith('vendor/'));
const upstream = lines.length - ours.length;

for (const line of ours) console.error(line);
if (upstream > 0) {
  console.log(`typecheck: ${upstream} diagnostic(s) inside vendor/ ignored — upstream's code.`);
}

if (ours.length > 0) {
  console.error(`typecheck: ${ours.length} error(s) in our code.`);
  process.exit(1);
}
console.log('typecheck: clean.');
