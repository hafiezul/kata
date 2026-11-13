// Runs the translation models. Lives in an offscreen document because MV3
// service workers can't host long-running WebAssembly workloads reliably.

import { env, pipeline, type TranslationPipeline } from '@huggingface/transformers';
import { getModel, type ModelInfo } from './models';
import { splitText } from './split';
import { errorMessage, type OffscreenRequest, type ProgressMessage } from './messages';

const CACHE_NAME = 'transformers-cache';
const DTYPE = 'q8';
const MODEL_FILES = ['encoder_model_quantized.onnx', 'decoder_model_merged_quantized.onnx'];
/** How many models to keep loaded in memory at once (~100–150 MB each). */
const MAX_LOADED = 2;

// The Chrome Web Store forbids remotely hosted code, so the ONNX Runtime
// WebAssembly files ship inside the extension instead of coming from a CDN.
env.allowLocalModels = false;
env.useBrowserCache = true;
env.cacheKey = CACHE_NAME;
env.useWasmCache = false;
const wasm = env.backends.onnx.wasm!;
wasm.wasmPaths = {
  mjs: chrome.runtime.getURL('ort/ort-wasm-simd-threaded.asyncify.mjs'),
  wasm: chrome.runtime.getURL('ort/ort-wasm-simd-threaded.asyncify.wasm'),
};
wasm.numThreads = self.crossOriginIsolated ? Math.min(4, navigator.hardwareConcurrency || 1) : 1;

// ---------------------------------------------------------------------------
// Model loading

const loaded = new Map<string, Promise<TranslationPipeline>>();

function loadModel(model: ModelInfo): Promise<TranslationPipeline> {
  const existing = loaded.get(model.id);
  if (existing) {
    // Refresh LRU position.
    loaded.delete(model.id);
    loaded.set(model.id, existing);
    return existing;
  }

  const files = new Map<string, { loaded: number; total: number }>();
  let lastSent = 0;
  const report = (done = false) => {
    const now = Date.now();
    if (!done && now - lastSent < 150) return;
    lastSent = now;
    let l = 0;
    let t = 0;
    for (const f of files.values()) {
      l += f.loaded;
      t += f.total;
    }
    const msg: ProgressMessage = { type: 'progress', modelId: model.id, loaded: l, total: t, done };
    chrome.runtime.sendMessage(msg).catch(() => {});
  };

  const promise = (
    pipeline('translation', model.repo, {
      dtype: DTYPE,
      device: 'wasm',
      progress_callback: (p: any) => {
        if (p.status === 'progress' && p.file) {
          files.set(p.file, { loaded: p.loaded ?? 0, total: p.total ?? 0 });
          report();
        }
      },
    }) as Promise<TranslationPipeline>
  ).then(
    (pipe) => {
      report(true);
      return pipe;
    },
    (err) => {
      loaded.delete(model.id);
      report(true);
      throw err;
    },
  );

  loaded.set(model.id, promise);
  evictExtra();
  return promise;
}

function evictExtra() {
  while (loaded.size > MAX_LOADED) {
    const [oldestId, oldest] = loaded.entries().next().value!;
    loaded.delete(oldestId);
    oldest.then((p) => p.dispose()).catch(() => {});
  }
}

async function unloadModel(id: string) {
  const p = loaded.get(id);
  loaded.delete(id);
  if (p) await p.then((pipe) => pipe.dispose()).catch(() => {});
}

/** Sentences translated per model call. */
const BATCH_SIZE = 8;

async function translate(text: string, model: ModelInfo): Promise<string> {
  const pipe = await loadModel(model);
  const pieces = splitText(text, model.src);
  const todo = pieces.filter((p) => p.text);
  const noSpaceJoin = ['zh', 'ja', 'th'].includes(model.tgt);

  for (let i = 0; i < todo.length; i += BATCH_SIZE) {
    const batch = todo.slice(i, i + BATCH_SIZE);
    const out = (await pipe(
      batch.map((p) => (model.prefix ?? '') + p.text),
      { max_new_tokens: 512 } as any,
    )) as Array<{ translation_text: string }>;
    batch.forEach((p, j) => {
      p.text = out[j]?.translation_text ?? p.text;
      if (noSpaceJoin && p.after === ' ') p.after = '';
    });
  }
  return pieces.map((p) => p.text + p.after).join('').trimEnd();
}

// ---------------------------------------------------------------------------
// Cache inspection (the Cache API is shared by every page of the extension).

async function downloadedModels(): Promise<string[]> {
  if (!(await caches.has(CACHE_NAME))) return [];
  const cache = await caches.open(CACHE_NAME);
  const urls = (await cache.keys()).map((r) => r.url);
  const ids = new Set<string>();
  for (const url of urls) {
    const m = url.match(/\/Xenova\/opus-mt-([a-z]+-[a-z]+)\//);
    if (m) ids.add(m[1]);
  }
  return [...ids].filter((id) =>
    MODEL_FILES.every((f) => urls.some((u) => u.includes(`/opus-mt-${id}/`) && u.endsWith(f))),
  );
}

async function deleteModel(id: string) {
  await unloadModel(id);
  const cache = await caches.open(CACHE_NAME);
  for (const req of await cache.keys()) {
    if (req.url.includes(`/Xenova/opus-mt-${id}/`)) await cache.delete(req);
  }
}

// ---------------------------------------------------------------------------

async function handle(msg: OffscreenRequest): Promise<unknown> {
  switch (msg.type) {
    case 'translate': {
      const model = getModel(msg.modelId);
      if (!model) throw new Error(`Unknown model ${msg.modelId}`);
      return { ok: true, text: await translate(msg.text, model) };
    }
    case 'status':
      return { ok: true, downloaded: await downloadedModels() };
    case 'download': {
      const model = getModel(msg.modelId);
      if (!model) throw new Error(`Unknown model ${msg.modelId}`);
      await loadModel(model);
      return { ok: true };
    }
    case 'delete':
      await deleteModel(msg.modelId);
      return { ok: true };
  }
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.target !== 'offscreen') return false;
  handle(msg as OffscreenRequest).then(sendResponse, (e) =>
    sendResponse({ ok: false, error: errorMessage(e) }),
  );
  return true;
});
