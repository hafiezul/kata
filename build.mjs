// Builds the extension into dist/. `node build.mjs --zip` also makes a Web Store zip.
import { build } from 'esbuild';
import { cpSync, mkdirSync, rmSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const watch = process.argv.includes('--watch');
const zip = process.argv.includes('--zip');
const out = 'dist';

rmSync(out, { recursive: true, force: true });
mkdirSync(`${out}/ort`, { recursive: true });

// Static files (manifest, HTML, CSS, icons).
cpSync('static', out, { recursive: true });

// ONNX Runtime WebAssembly, shipped locally (no remote code allowed in MV3).
for (const f of ['ort-wasm-simd-threaded.asyncify.mjs', 'ort-wasm-simd-threaded.asyncify.wasm']) {
  cpSync(`node_modules/onnxruntime-web/dist/${f}`, `${out}/ort/${f}`);
}

// transformers.js falls back to loading ONNX Runtime from a CDN. Point that
// fallback at our local copy so the bundle contains no remote-code URL.
const noCdn = {
  name: 'no-cdn',
  setup(b) {
    b.onLoad({ filter: /transformers\.web\.js$/ }, (args) => {
      const src = readFileSync(args.path, 'utf8');
      const cdn = 'https://cdn.jsdelivr.net/npm/onnxruntime-web@${ONNX_ENV.versions.web}/dist/';
      if (!src.includes(cdn)) throw new Error('transformers.js CDN fallback changed; update build.mjs');
      return { contents: src.replace(cdn, '/ort/'), loader: 'js' };
    });
  },
};

const common = { bundle: true, target: 'chrome116', minify: !watch, sourcemap: watch, logLevel: 'info' };

await Promise.all([
  build({ ...common, entryPoints: ['src/offscreen.ts'], outfile: `${out}/offscreen.js`, format: 'esm', plugins: [noCdn] }),
  build({ ...common, entryPoints: ['src/background.ts'], outfile: `${out}/background.js`, format: 'iife' }),
  build({ ...common, entryPoints: ['src/content.ts'], outfile: `${out}/content.js`, format: 'iife' }),
  build({ ...common, entryPoints: ['src/popup.ts'], outfile: `${out}/popup.js`, format: 'iife' }),
  build({ ...common, entryPoints: ['src/options.ts'], outfile: `${out}/options.js`, format: 'iife' }),
]);

if (zip) {
  const { version } = JSON.parse(readFileSync('static/manifest.json', 'utf8'));
  const file = `kata-${version}.zip`;
  rmSync(file, { force: true });
  execFileSync('zip', ['-qr', `../${file}`, '.'], { cwd: out });
  console.log(`Wrote ${file}`);
}
