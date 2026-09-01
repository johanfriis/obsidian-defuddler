// Builds the two JS artifacts the app ships, both from the vendored obsidian-clipper
// (git submodule, pinned — see playbook "Pinned upstream") plus our shim:
//
//   assets/clipper-bundle.js   injected into the PAGE WebView — Layer B, the reader
//   assets/ui/*                served to the UI WebView from our own origin — upstream's
//                              extension pages, verbatim (playbook D31)
//
// The second exists because we host upstream's clipper rather than reimplementing it. Its pages
// are ordinary files on an https origin WebViewAssetLoader owns, so unlike the page bundle they
// are subject to no site's CSP: runtime.getURL is a plain relative URL there and CSS is a real
// <link> (D20 is narrowed to the page WebView).
//
// Cross-platform by construction (D6): esbuild + sass through their Node APIs, no shell.
//   node build.mjs --prod     the committed artifact — minified, DEBUG_MODE off (D28)
//   node build.mjs            local Layer B build — unminified, DEBUG_MODE on, readable in
//                             chrome://inspect. Never commit this; `npm run verify` will say so.
//   --sourcemap               adds inline sourcemaps to a local build (~3x the size)
//   --outfile <path>          write the page bundle somewhere other than the committed asset
//                             (the tests do this, so running them can never dirty the artifact).
//                             Implies --no-ui: a test run must not touch assets/ui/ either.
//   --no-ui                   skip the UI pages; page bundle only

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as esbuild from 'esbuild';
import * as sass from 'sass';

const root = dirname(fileURLToPath(import.meta.url));
const upstream = join(root, 'vendor/obsidian-clipper');
const upstreamSrc = join(upstream, 'src');
const outfileFlag = process.argv.indexOf('--outfile');
const outfile =
  outfileFlag === -1
    ? join(root, '../android/app/src/main/assets/clipper-bundle.js')
    : resolve(process.argv[outfileFlag + 1]);

const prod = process.argv.includes('--prod');
// The UI pages live beside the bundle in one assets tree, so D28's rule covers them too: whatever
// is committed is what a release APK ships.
const uiOutdir = join(root, '../android/app/src/main/assets/ui');
const buildUi = !process.argv.includes('--no-ui') && outfileFlag === -1;
// Inline sourcemaps map back to individual .ts files but add ~4.7 MB, and the bundle is injected
// into every page. An unminified build is readable enough in chrome://inspect on its own, so this
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
  // `@charset` is only legal as the first thing in a stylesheet *file*; the inline-<style>
  // fallback (see bundle-entry.ts) would make it a parse warning. Both our delivery paths
  // declare UTF-8 by other means.
  return result.css.replace(/^@charset\s+"[^"]*";\s*/i, '');
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

// --- UI pages (D31) --------------------------------------------------------
// Upstream's own webpack.config.js declares these entries and copies these HTML files; this is the
// same list, built with our alias instead of theirs. Nothing here is patched — the only edit to the
// HTML is dropping the extension's browser-polyfill <script>, which our shim replaces at bundle time.

/** The upstream pages we host, and the entry that drives each. */
const UI_PAGES = {
  'popup.html': 'popup',
  'side-panel.html': 'popup',
  'settings.html': 'settings',
};

async function buildUiPages() {
  mkdirSync(uiOutdir, { recursive: true });

  // Upstream compiles style.scss to the style.css every page links. On our origin it is a real
  // file, so unlike reader.css it needs no embedding and no blob URL.
  writeFileSync(join(uiOutdir, 'style.css'), compileScss('style'));

  const ui = await esbuild.build({
    entryPoints: {
      popup: join(root, 'src/ui-popup-entry.ts'),
      settings: join(root, 'src/ui-settings-entry.ts'),
    },
    outdir: uiOutdir,
    bundle: true,
    format: 'iife',
    platform: 'browser',
    target: 'chrome120',
    minify: prod,
    sourcemap: sourcemap && !prod ? 'inline' : false,
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

  for (const [page, entry] of Object.entries(UI_PAGES)) {
    let html = readFileSync(join(upstreamSrc, page), 'utf8');
    // Our shim is bundled into the page script; upstream's polyfill file does not exist here.
    html = html.replace(/[\t ]*<script src="browser-polyfill\.min\.js"><\/script>\r?\n?/, '');
    // side-panel.html already points at popup.js; settings.html at settings.js. Assert rather than
    // rewrite, so an upstream rename surfaces here instead of as a blank page on the device.
    if (!html.includes(`src="${entry}.js"`)) {
      throw new Error(`${page} no longer loads ${entry}.js — upstream renamed an entry (playbook §14)`);
    }
    writeFileSync(join(uiOutdir, page), html);
  }

  const sizes = Object.keys(ui.metafile.outputs)
    .filter((f) => f.endsWith('.js'))
    .map((f) => `${f.split('/').pop()} ${(ui.metafile.outputs[f].bytes / 1024).toFixed(0)} KB`)
    .join(', ');
  console.log(`ui/  ${sizes}  (${Object.keys(UI_PAGES).length} pages + style.css)`);
}

if (buildUi) await buildUiPages();
