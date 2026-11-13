// Runs the same splitter + Opus-MT models the extension uses, under Node.
import { build } from 'esbuild';
import { pipeline } from '@huggingface/transformers';

await build({ entryPoints: ['src/split.ts', 'src/models.ts'], outdir: 'test/.out', format: 'esm', bundle: false, logLevel: 'silent' });
const { splitText } = await import('./.out/split.js');
const { findRoute, getModel } = await import('./.out/models.js');

const assert = (c, m) => { if (!c) { console.error('FAIL', m); process.exitCode = 1; } else console.log('ok  ', m); };

// Splitter keeps line breaks and round-trips.
const sample = 'Hello there. How are you?\n\n  Indented line.\nLast';
const pieces = splitText(sample, 'en');
assert(pieces.map((p) => p.text + p.after).join('') === sample.replace('there. How', 'there. How'), 'splitter round-trips text');
assert(splitText('a\n', 'en').map((p) => p.text + p.after).join('') === 'a\n', 'splitter keeps trailing newline');

// Routing
assert(findRoute('id', 'en')?.map((m) => m.id).join() === 'id-en', 'direct route id→en');
assert(findRoute('id', 'fr')?.map((m) => m.id).join() === 'id-en,en-fr', 'pivot id→en→fr');
assert(findRoute('ko', 'ja') === null, 'no route ko→ja');

async function run(id, text) {
  const m = getModel(id);
  const pipe = await pipeline('translation', m.repo, { dtype: 'q8' });
  const t0 = Date.now();
  const out = await pipe([(m.prefix ?? '') + text], { max_new_tokens: 512 });
  console.log(`     ${id}: "${text}" → "${out[0].translation_text}" (${Date.now() - t0} ms)`);
  return out[0].translation_text;
}
assert(/eat|rice/i.test(await run('id-en', 'Saya suka makan nasi goreng.')), 'id-en translates');
assert(/[一-鿿]/.test(await run('en-zh', 'Good morning, how are you?')), 'en-zh outputs Chinese with prefix');
