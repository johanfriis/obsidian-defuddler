// Builds android/app/src/main/assets/clipper-bundle.js from the vendored obsidian-clipper
// (git submodule, pinned — see playbook "Pinned upstream") plus our shim.
//
// Cross-platform by construction (D6): esbuild + sass through their Node APIs, no shell.
//   node build.mjs            debug bundle (sourcemap, DEBUG_MODE on)
//   node build.mjs --prod     release bundle (minified, DEBUG_MODE off)

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as esbuild from 'esbuild';
import * as sass from 'sass';

const root = dirname(fileURLToPath(import.meta.url));
const upstream = join(root, 'vendor/obsidian-clipper');
const upstreamSrc = join(upstream, 'src');
const outfile = join(root, '../android/app/src/main/assets/clipper-bundle.js');

const prod = process.argv.includes('--prod');
// Inline sourcemaps map back to individual .ts files but add ~4.7 MB, and the bundle is injected
// into every page. Unminified output is readable enough in chrome://inspect on its own, so this
// is opt-in: node build.mjs --sourcemap
const sourcemap = process.argv.includes('--sourcemap');

// --- bundle trims ----------------------------------------------------------
// Upstream builds for a desktop extension where a few MB of assets cost nothing. We inject this
// bundle into every page, so two of its dependencies are trimmed. Both degrade gracefully; both
// are one-line reverts if they ever bite. Measured on the pinned commit: 3.3 MB -> 1.1 MB (prod).

// UI languages kept in the bundle (~40 KB each). Upstream ships 30+; getMessage falls back to
// English for anything not bundled, so trimming changes the UI language, never correctness.
const LOCALES = ['en'];

// 'highlight.js/lib/common' covers ~40 mainstream languages; the full build adds ~150 more
// (1c, Mathematica, ISBL...) for ~700 KB. highlightElement leaves an unregistered language
// unstyled rather than throwing. Set to 'highlight.js' for the full set.
const HLJS = 'highlight.js/lib/common';

// --- assets ----------------------------------------------------------------
// Upstream ships reader.css / highlighter.css as separate web-accessible resources and injects
// them at runtime via browser.runtime.getURL (utils/reader.ts) — they are not imported by any
// module, so esbuild alone would miss them. We compile them here and embed them; the shim's
// getURL hands them back as blob URLs.

function compileScss(name) {
  const result = sass.compile(join(upstreamSrc, `${name}.scss`), {
    loadPaths: [upstreamSrc],
    style: prod ? 'compressed' : 'expanded',
    // Upstream still uses @import and global built-ins; that is upstream's migration to make,
    // not ours, and the warnings would drown the build output.
    silenceDeprecations: ['import', 'global-builtin', 'color-functions'],
    quietDeps: true,
  });
  return result.css;
}

function collectAssets() {
  return {
    'reader.css': compileScss('reader'),
    'highlighter.css': compileScss('highlighter'),
    // Injected as a <script> by utils/flatten-shadow-dom.ts when a page uses shadow roots.
    'flatten-shadow-dom.js': readFileSync(join(upstreamSrc, 'flatten-shadow-dom.js'), 'utf8'),
  };
}

/** Drops the messages.json of every locale outside LOCALES. */
function trimLocalesPlugin() {
  const keep = new Set(LOCALES);
  return {
    name: 'trim-locales',
    setup(build) {
      // esbuild resolves upstream's `require(`../_locales/${lang}/messages.json`)` as a glob and
      // pulls in every language. Go's regexp has no lookahead, so filter broadly and decide here.
      build.onLoad({ filter: /_locales[\\/][^\\/]+[\\/]messages\.json$/ }, (args) => {
        const locale = args.path.split(/[\\/]/).at(-2);
        return keep.has(locale) ? null : { contents: '{}', loader: 'json' };
      });
    },
  };
}

/** Resolves `virtual:assets` (imported by shim/browser.ts) to the embedded blobs. */
function virtualAssetsPlugin(assets, messages) {
  return {
    name: 'virtual-assets',
    setup(build) {
      build.onResolve({ filter: /^virtual:assets$/ }, () => ({
        path: 'virtual:assets',
        namespace: 'virtual',
      }));
      build.onLoad({ filter: /.*/, namespace: 'virtual' }, () => ({
        contents:
          `export const assets = ${JSON.stringify(assets)};\n` +
          `export const messages = ${JSON.stringify(messages)};\n`,
        loader: 'js',
      }));
    },
  };
}

// --- build -----------------------------------------------------------------

const assets = collectAssets();
const messages = JSON.parse(readFileSync(join(upstreamSrc, '_locales/en/messages.json'), 'utf8'));

mkdirSync(dirname(outfile), { recursive: true });

const result = await esbuild.build({
  entryPoints: [join(root, 'src/bundle-entry.ts')],
  outfile,
  bundle: true,
  format: 'iife',
  platform: 'browser',
  // Android 16 WebView; no need to down-level.
  target: 'chrome120',
  minify: prod,
  sourcemap: sourcemap && !prod ? 'inline' : false,
  // The single seam: upstream funnels every extension API through
  // src/utils/browser-polyfill.ts, whose only import is this specifier.
  alias: {
    'webextension-polyfill': join(root, 'shim/browser.ts'),
    'highlight.js': HLJS,
  },
  define: {
    DEBUG_MODE: String(!prod),
    'process.env.NODE_ENV': JSON.stringify(prod ? 'production' : 'development'),
  },
  plugins: [trimLocalesPlugin(), virtualAssetsPlugin(assets, messages)],
  logLevel: 'info',
  metafile: true,
});

const bytes = readFileSync(outfile).length;
console.log(
  `clipper-bundle.js  ${(bytes / 1024).toFixed(0)} KB  ` +
    `(${prod ? 'prod' : 'debug'}${sourcemap && !prod ? '+sourcemap' : ''}; reader.css ${(assets['reader.css'].length / 1024).toFixed(0)} KB embedded)`,
);

writeFileSync(join(root, 'build-meta.json'), JSON.stringify(result.metafile));
