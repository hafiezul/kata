import { findRoute, langName, MODELS, SOURCE_LANGS, TARGET_LANGS, type ModelInfo } from './models';
import { DEFAULT_SETTINGS, type ErrorResult, type ModelStatus, type ProgressMessage, type Settings } from './messages';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

let downloaded = new Set<string>();
const busy = new Set<string>();
const progress = new Map<string, number>();

function fill(select: HTMLSelectElement, codes: string[], extra?: [string, string]) {
  const opts = codes.map((c) => [c, langName(c)] as const).sort((a, b) => a[1].localeCompare(b[1]));
  if (extra) opts.unshift(extra);
  select.replaceChildren(...opts.map(([v, t]) => new Option(t, v)));
}

// ---------------------------------------------------------------------------
// Settings

const targetLang = $<HTMLSelectElement>('targetLang');
const fieldSourceLang = $<HTMLSelectElement>('fieldSourceLang');
const fieldTargetLang = $<HTMLSelectElement>('fieldTargetLang');
fill(targetLang, TARGET_LANGS);
fill(fieldSourceLang, SOURCE_LANGS, ['auto', 'Detect language']);
fill(fieldTargetLang, TARGET_LANGS);

async function loadSettings() {
  const s = (await chrome.storage.sync.get(DEFAULT_SETTINGS)) as Settings;
  targetLang.value = s.targetLang;
  fieldSourceLang.value = s.fieldSourceLang;
  fieldTargetLang.value = s.fieldTargetLang;
}

for (const el of [targetLang, fieldSourceLang, fieldTargetLang]) {
  el.addEventListener('change', async () => {
    await chrome.storage.sync.set({ [el.id]: el.value });
    renderNeeds();
  });
}

/** Suggest the models the "what I typed" setting needs. */
function renderNeeds() {
  const box = $('needs');
  const from = fieldSourceLang.value;
  const to = fieldTargetLang.value;
  box.hidden = true;
  if (from === 'auto' || from === to) return;
  const route = findRoute(from, to);
  const text = $('needs-text');
  box.hidden = false;
  if (!route) {
    text.className = 'err';
    text.textContent = `${langName(from)} → ${langName(to)} isn't available yet.`;
    $('needs-btn').hidden = true;
    return;
  }
  const missing = route.filter((m) => !downloaded.has(m.id));
  if (!missing.length) {
    box.hidden = true;
    return;
  }
  const mb = missing.reduce((n, m) => n + m.sizeMB, 0);
  text.className = '';
  text.textContent = `This needs ${missing.length} model${missing.length > 1 ? 's' : ''} (${mb} MB).`;
  const btn = $<HTMLButtonElement>('needs-btn');
  btn.hidden = false;
  btn.onclick = () => missing.forEach(download);
}

// ---------------------------------------------------------------------------
// Shortcuts

async function loadShortcuts() {
  for (const c of await chrome.commands.getAll()) {
    const el = document.getElementById(`key-${c.name}`);
    if (!el) continue;
    el.replaceChildren();
    if (c.shortcut) {
      const k = document.createElement('kbd');
      k.textContent = c.shortcut;
      el.append(k);
    } else {
      el.textContent = 'Not set';
      el.className = 'muted';
    }
  }
}
$('shortcuts').addEventListener('click', () => chrome.tabs.create({ url: 'chrome://extensions/shortcuts' }));

// ---------------------------------------------------------------------------
// Models

const filter = $<HTMLSelectElement>('filter');
fill(
  filter,
  [...new Set(MODELS.flatMap((m) => [m.src, m.tgt]))].filter((c) => c !== 'en'),
  ['', 'All languages'],
);
filter.addEventListener('change', render);

async function refreshStatus() {
  const res = (await chrome.runtime.sendMessage({ type: 'models:status' })) as ModelStatus | ErrorResult;
  if (res.ok) downloaded = new Set(res.downloaded);
  render();
  renderNeeds();
  const est = await navigator.storage.estimate();
  $('usage').textContent = `Using ${Math.round((est.usage ?? 0) / 1e6)} MB on this device`;
}

async function download(m: ModelInfo) {
  if (busy.has(m.id)) return;
  busy.add(m.id);
  progress.set(m.id, 0);
  render();
  const res = (await chrome.runtime.sendMessage({ type: 'models:download', modelId: m.id })) as { ok: true } | ErrorResult;
  busy.delete(m.id);
  progress.delete(m.id);
  if (!res.ok) alert(`Couldn't download ${m.id}: ${res.error}`);
  await refreshStatus();
}

async function remove(m: ModelInfo) {
  busy.add(m.id);
  render();
  await chrome.runtime.sendMessage({ type: 'models:delete', modelId: m.id });
  busy.delete(m.id);
  await refreshStatus();
}

function render() {
  const f = filter.value;
  const list = MODELS.filter((m) => !f || m.src === f || m.tgt === f).sort((a, b) => {
    const d = Number(downloaded.has(b.id)) - Number(downloaded.has(a.id));
    return d || label(a).localeCompare(label(b));
  });

  $('rows').replaceChildren(
    ...list.map((m) => {
      const tr = document.createElement('tr');
      const name = document.createElement('td');
      name.textContent = label(m);
      if (downloaded.has(m.id)) {
        const pill = document.createElement('span');
        pill.className = 'pill';
        pill.textContent = 'Ready';
        name.append(' ', pill);
      }
      const size = document.createElement('td');
      size.className = 'size';
      size.textContent = `${m.sizeMB} MB`;
      const act = document.createElement('td');
      act.className = 'act';
      const btn = document.createElement('button');
      if (busy.has(m.id) && progress.has(m.id)) {
        btn.textContent = `${progress.get(m.id)}%`;
        btn.disabled = true;
        const bar = document.createElement('div');
        bar.className = 'bar';
        bar.innerHTML = `<i style="width:${progress.get(m.id)}%"></i>`;
        act.append(btn, bar);
      } else {
        btn.textContent = downloaded.has(m.id) ? 'Delete' : 'Download';
        btn.disabled = busy.has(m.id);
        btn.onclick = () => (downloaded.has(m.id) ? remove(m) : download(m));
        act.append(btn);
      }
      tr.append(name, size, act);
      return tr;
    }),
  );
}

function label(m: ModelInfo) {
  return `${langName(m.src)} → ${langName(m.tgt)}`;
}

chrome.runtime.onMessage.addListener((msg: ProgressMessage) => {
  if (msg?.type !== 'progress' || !msg.total) return;
  if (!busy.has(msg.modelId)) return;
  progress.set(msg.modelId, Math.round((msg.loaded / msg.total) * 100));
  render();
});

$('refresh').addEventListener('click', refreshStatus);

loadSettings().then(refreshStatus);
loadShortcuts();
