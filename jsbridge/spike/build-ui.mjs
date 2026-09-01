// Spike only — throwaway. Builds upstream's extension UI pages as if they were served from our
// own origin (the WebViewAssetLoader analogue), so we can see what actually comes up.
//
//   node spike/build-ui.mjs [--out <dir>] [--page <fixture.html>]

import { copyFileSync, mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as esbuild from 'esbuild';
import * as sass from 'sass';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const upstreamSrc = join(root, 'vendor/obsidian-clipper/src');

const arg = (name, fallback) => {
  const i = process.argv.indexOf(name);
  return i === -1 ? fallback : process.argv[i + 1];
};

const out = resolve(arg('--out', join(root, '.spike-ui')));
const pageFixture = arg('--page', 'stephango.html');

mkdirSync(out, { recursive: true });

// --- styles: upstream's own SCSS, compiled to a real file on our origin --------------
// Note what this buys: on our own origin `runtime.getURL` is a plain relative URL again, so
// D20's inline-CSS workaround is not needed for UI pages at all.
for (const [name, file] of [['style', 'style'], ['reader', 'reader']]) {
  const css = sass.compile(join(upstreamSrc, `${file}.scss`), {
    loadPaths: [upstreamSrc],
    style: 'expanded',
    silenceDeprecations: ['import', 'global-builtin', 'color-functions'],
    quietDeps: true,
  }).css;
  writeFileSync(join(out, `${name}.css`), css);
}


// The shim imports `virtual:assets` (build.mjs embeds reader.css et al there). On our own origin
// the UI pages don't need them, but the module still has to resolve.
function virtualAssetsPlugin() {
  const messages = JSON.parse(
    readFileSync(join(upstreamSrc, '_locales/en/messages.json'), 'utf8'),
  );
  return {
    name: 'virtual-assets',
    setup(build) {
      build.onResolve({ filter: /^virtual:assets$/ }, () => ({
        path: 'virtual:assets',
        namespace: 'virtual',
      }));
      build.onLoad({ filter: /.*/, namespace: 'virtual' }, () => ({
        contents:
          `export const assets = {};\n` +
          `export const messages = ${JSON.stringify(messages)};\n`,
        loader: 'js',
      }));
    },
  };
}

// --- scripts ---------------------------------------------------------------
const pageUrl = `http://localhost:8765/fixtures/${pageFixture}`;

await esbuild.build({
  entryPoints: {
    popup: join(root, 'spike/popup-entry.ts'),
    settings: join(root, 'spike/settings-entry.ts'),
  },
  outdir: out,
  bundle: true,
  format: 'iife',
  platform: 'browser',
  target: 'chrome120',
  minify: false,
  sourcemap: 'inline',
  alias: { 'webextension-polyfill': join(root, 'shim/browser.ts') },
  define: {
    DEBUG_MODE: 'true',
    __spikePageUrl: JSON.stringify(pageUrl),
    'process.env.NODE_ENV': '"development"',
  },
  loader: { '.json': 'json' },
  plugins: [virtualAssetsPlugin()],
  logLevel: 'info',
});

// --- html ------------------------------------------------------------------
// Two edits only: drop the extension's polyfill <script> (our shim is bundled in), and point
// the module script at the built file. Everything else is upstream's HTML verbatim.
for (const page of ['popup.html', 'side-panel.html', 'settings.html']) {
  const src = join(upstreamSrc, page);
  if (!existsSync(src)) continue;
  let html = readFileSync(src, 'utf8');
  html = html.replace(/\s*<script src="browser-polyfill\.min\.js"><\/script>/, '');
  // side-panel.html loads popup.js too.
  html = html.replace(/src="(popup|settings)\.js"/g, 'src="$1.js"');
  // The fixture the spike clips, as an off-screen same-origin frame standing in for the page
  // WebView. NOT display:none — Defuddle scores elements partly on layout, so a frame with no
  // layout extracts zero words. Off-screen but laid out is the difference.
  html = html.replace(
    '</body>',
    `\t<iframe id="spike-page" src="/fixtures/${pageFixture}" style="position:absolute;left:-20000px;top:0;width:1024px;height:2000px;border:0"></iframe>\n</body>`,
  );
  writeFileSync(join(out, page), html);
}

console.log(`spike UI -> ${out}`);
console.log(`  pages: popup.html, side-panel.html, settings.html`);
console.log(`  clipping fixture: ${pageFixture}`);
