// Builds main.js, the single artifact Obsidian loads.
//
//   node esbuild.config.mjs --prod     minified, what a release ships
//   node esbuild.config.mjs            unminified, for the dev symlink
//   node esbuild.config.mjs --watch    rebuild on change
//
// Two configuration choices here are load-bearing and are documented in the playbook's §3
// ("Ground truth: upstream integration points"). Both are one line each and both fail in ways that
// look like something else, so read that section before changing either.

import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { statSync } from 'node:fs';
import * as esbuild from 'esbuild';

const root = dirname(fileURLToPath(import.meta.url));
const upstream = join(root, 'vendor/obsidian-clipper');

const prod = process.argv.includes('--prod');
const watch = process.argv.includes('--watch');

/**
 * §3 fact 2. api.ts imports the Defuddle class from 'defuddle' and createMarkdownContent from
 * 'defuddle/full', and full already contains core — so both copies land in the bundle, 1.06 MB of
 * the 1.18 MB total. 'defuddle/full' default-exports the same class, so resolving the bare
 * specifier to it removes ~320 KB with no behaviour change.
 *
 * This is a resolver rather than an `alias` entry because esbuild's alias substitutes prefixes:
 * aliasing 'defuddle' also rewrites 'defuddle/full' into 'defuddle/full/full', which does not
 * resolve. The exact-match filter is the point.
 */
function dedupeDefuddle() {
  return {
    name: 'dedupe-defuddle',
    setup(build) {
      build.onResolve({ filter: /^defuddle$/ }, () => ({
        path: join(root, 'node_modules/defuddle/dist/index.full.js'),
      }));
    },
  };
}

/** @type {import('esbuild').BuildOptions} */
const options = {
  entryPoints: [join(root, 'main.ts')],
  outfile: join(root, 'main.js'),
  bundle: true,
  format: 'cjs',
  platform: 'browser',
  target: 'es2022',
  // Obsidian provides these at runtime; bundling them would be wrong and would not work.
  external: ['obsidian', 'electron'],
  minify: prod,
  sourcemap: prod ? false : 'inline',
  logLevel: 'info',
  define: {
    // Upstream's modules reference this global; esbuild substitutes it at bundle time.
    DEBUG_MODE: 'false',
  },
  alias: {
    // §3 fact 1. api.ts reaches webextension-polyfill transitively, through
    // storage-utils.ts -> browser-polyfill.ts. Upstream's own API build aliases it to these
    // stubs (see vendor/obsidian-clipper/scripts/build-api.mjs); without this the bundle throws
    // at load with an error that names the polyfill, not us.
    'webextension-polyfill': join(upstream, 'src/utils/cli-stubs.ts'),

  },
  plugins: [dedupeDefuddle()],
};

if (watch) {
  const ctx = await esbuild.context(options);
  await ctx.watch();
  console.log('watching');
} else {
  await esbuild.build(options);
  const { size } = statSync(options.outfile);
  console.log(`main.js  ${(size / 1024).toFixed(0)} KB${prod ? ' (minified)' : ''}`);
}
