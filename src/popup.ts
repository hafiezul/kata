import { findRoute, getModel, langName, SOURCE_LANGS, TARGET_LANGS } from './models';
import type { ErrorResult, ProgressMessage, TranslateResult } from './messages';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const src = $<HTMLSelectElement>('src');
const tgt = $<HTMLSelectElement>('tgt');
const input = $<HTMLTextAreaElement>('input');
const out = $<HTMLDivElement>('out');
const status = $<HTMLSpanElement>('status');
const go = $<HTMLButtonElement>('go');
const bar = $<HTMLDivElement>('bar');

function fill(select: HTMLSelectElement, codes: string[], extra?: [string, string]) {
  const opts = codes
    .map((c) => [c, langName(c)] as const)
    .sort((a, b) => a[1].localeCompare(b[1]));
  if (extra) opts.unshift(extra);
  select.replaceChildren(...opts.map(([v, t]) => new Option(t, v)));
}

fill(src, SOURCE_LANGS, ['auto', 'Detect language']);
fill(tgt, TARGET_LANGS);

async function restore() {
  const s = (await chrome.storage.local.get({ popupSrc: 'auto', popupTgt: 'en', draft: '' })) as {
    popupSrc: string;
    popupTgt: string;
    draft: string;
  };
  src.value = s.popupSrc;
  tgt.value = s.popupTgt;
  input.value = s.draft;
  checkPair();
}

function save() {
  chrome.storage.local.set({ popupSrc: src.value, popupTgt: tgt.value, draft: input.value });
}

function checkPair() {
  if (src.value === 'auto') {
    status.textContent = '';
    return;
  }
  const route = findRoute(src.value, tgt.value);
  status.className = 'status ' + (route ? 'muted' : 'err');
  status.textContent = !route
    ? `${langName(src.value)} → ${langName(tgt.value)} isn't available yet`
    : route.length > 1
      ? 'Goes via English (2 models)'
      : '';
}

async function translate() {
  const text = input.value;
  if (!text.trim()) return;
  go.disabled = true;
  status.className = 'status muted';
  status.textContent = 'Translating…';
  const res = (await chrome.runtime.sendMessage({
    type: 'translate',
    text,
    src: src.value,
    tgt: tgt.value,
  })) as TranslateResult | ErrorResult;
  go.disabled = false;
  bar.style.display = 'none';
  if (res.ok) {
    out.textContent = res.text;
    status.textContent =
      (src.value === 'auto' ? `Detected ${langName(res.src)}` : '') + (res.route.length > 1 ? ' · via English' : '');
  } else {
    status.className = 'status err';
    status.textContent = res.error;
  }
}

chrome.runtime.onMessage.addListener((msg: ProgressMessage) => {
  if (msg?.type !== 'progress' || !msg.total || go.disabled === false) return;
  const m = getModel(msg.modelId);
  bar.style.display = msg.done ? 'none' : 'block';
  (bar.firstElementChild as HTMLElement).style.width = `${(msg.loaded / msg.total) * 100}%`;
  status.textContent = `Downloading ${m ? `${langName(m.src)} → ${langName(m.tgt)}` : ''} model, once only…`;
});

go.addEventListener('click', translate);
input.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) translate();
});
input.addEventListener('input', save);
src.addEventListener('change', () => (save(), checkPair()));
tgt.addEventListener('change', () => (save(), checkPair()));
$('swap').addEventListener('click', () => {
  if (src.value === 'auto') return;
  const s = src.value;
  if (!TARGET_LANGS.includes(s) || !SOURCE_LANGS.includes(tgt.value)) return;
  src.value = tgt.value;
  tgt.value = s;
  if (out.textContent) [input.value, out.textContent] = [out.textContent, ''];
  save();
  checkPair();
});
$('copy').addEventListener('click', () => navigator.clipboard.writeText(out.textContent ?? ''));
$('manage').addEventListener('click', (e) => {
  e.preventDefault();
  chrome.runtime.openOptionsPage();
});

restore();
