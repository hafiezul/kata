// Injected on demand (activeTab) when the user uses the context menu or a
// shortcut. Shows a small card with the translation, or replaces the text in
// the focused text box.

import { getModel, langName } from './models';
import type { ContentMessage } from './messages';

declare global {
  interface Window {
    __kata?: boolean;
  }
}

if (!window.__kata) {
  window.__kata = true;
  init();
}

function init() {
  // -------------------------------------------------------------------------
  // Card UI in a shadow root so page styles can't leak in.

  const host = document.createElement('kata-translate-card');
  host.style.cssText = 'all: initial; position: fixed; z-index: 2147483647; top: 0; left: 0;';
  const root = host.attachShadow({ mode: 'closed' });
  root.innerHTML = `
    <style>
      :host { --bg:#fff; --fg:#1b1f24; --muted:#5f6b7a; --line:#e3e7ec; --accent:#0f766e; --err:#b42318; }
      @media (prefers-color-scheme: dark) {
        :host { --bg:#1d2127; --fg:#e8ebef; --muted:#9aa5b1; --line:#323842; --accent:#2dd4bf; --err:#f97066; }
      }
      .card { position: fixed; width: min(380px, calc(100vw - 24px)); box-sizing: border-box;
        background: var(--bg); color: var(--fg); border: 1px solid var(--line); border-radius: 12px;
        box-shadow: 0 8px 28px rgba(0,0,0,.18); font: 14px/1.5 system-ui, -apple-system, "Segoe UI", sans-serif;
        padding: 12px 14px; display: none; }
      .card.open { display: block; animation: in .14s ease-out; }
      @keyframes in { from { opacity: 0; transform: translateY(4px); } }
      @media (prefers-reduced-motion: reduce) { .card.open { animation: none; } }
      .head { display: flex; align-items: center; gap: 8px; font-size: 12px; color: var(--muted); margin-bottom: 6px; }
      .head .title { flex: 1; }
      .text { white-space: pre-wrap; max-height: 260px; overflow: auto; overflow-wrap: anywhere; }
      .text.err { color: var(--err); }
      .bar { height: 4px; border-radius: 2px; background: var(--line); overflow: hidden; margin-top: 8px; display: none; }
      .bar > i { display: block; height: 100%; width: 0; background: var(--accent); transition: width .2s; }
      .actions { display: flex; justify-content: flex-end; gap: 6px; margin-top: 10px; }
      button { font: inherit; font-size: 12px; border: 1px solid var(--line); background: transparent; color: var(--fg);
        border-radius: 8px; padding: 4px 10px; cursor: pointer; }
      button:hover { border-color: var(--accent); }
      button.x { border: 0; padding: 0 4px; font-size: 16px; line-height: 1; color: var(--muted); }
    </style>
    <div class="card" role="dialog" aria-label="Translation">
      <div class="head"><span class="title"></span><button class="x" aria-label="Close">×</button></div>
      <div class="text" aria-live="polite"></div>
      <div class="bar"><i></i></div>
      <div class="actions"><button class="copy">Copy</button></div>
    </div>`;

  const card = root.querySelector<HTMLDivElement>('.card')!;
  const title = root.querySelector<HTMLSpanElement>('.title')!;
  const body = root.querySelector<HTMLDivElement>('.text')!;
  const bar = root.querySelector<HTMLDivElement>('.bar')!;
  const barFill = root.querySelector<HTMLElement>('.bar > i')!;
  const actions = root.querySelector<HTMLDivElement>('.actions')!;
  const copyBtn = root.querySelector<HTMLButtonElement>('.copy')!;

  root.querySelector('.x')!.addEventListener('click', hide);
  copyBtn.addEventListener('click', async () => {
    await navigator.clipboard.writeText(body.textContent ?? '');
    copyBtn.textContent = 'Copied';
    setTimeout(() => (copyBtn.textContent = 'Copy'), 1200);
  });
  document.addEventListener('keydown', (e) => e.key === 'Escape' && hide(), true);
  document.addEventListener('mousedown', (e) => !e.composedPath().includes(host) && hide(), true);

  let hideTimer: number | undefined;

  function show(anchor: DOMRect | null) {
    clearTimeout(hideTimer);
    if (!host.isConnected) document.documentElement.appendChild(host);
    card.classList.add('open');
    const r = anchor ?? new DOMRect(innerWidth / 2 - 190, 24, 380, 0);
    const w = card.offsetWidth;
    const h = card.offsetHeight;
    let top = r.bottom + 8;
    if (top + h > innerHeight - 12) top = Math.max(12, r.top - h - 8);
    const left = Math.min(Math.max(12, r.left), innerWidth - w - 12);
    card.style.top = `${top}px`;
    card.style.left = `${left}px`;
  }

  function hide() {
    card.classList.remove('open');
  }

  function setState(opts: { title: string; text: string; error?: boolean; progress?: number; actions?: boolean }) {
    title.textContent = opts.title;
    body.textContent = opts.text;
    body.classList.toggle('err', !!opts.error);
    bar.style.display = opts.progress === undefined ? 'none' : 'block';
    barFill.style.width = `${opts.progress ?? 0}%`;
    actions.style.display = opts.actions ? 'flex' : 'none';
  }

  // -------------------------------------------------------------------------
  // Selection and text-field helpers

  let anchorRect: DOMRect | null = null;
  let field: FieldTarget | null = null;

  function selectionRect(): DOMRect | null {
    const sel = getSelection();
    if (sel && sel.rangeCount && !sel.isCollapsed) {
      const r = sel.getRangeAt(0).getBoundingClientRect();
      if (r.width || r.height) return r;
    }
    const el = deepActiveElement();
    return el ? el.getBoundingClientRect() : null;
  }

  function selectedText(): string {
    const el = deepActiveElement();
    if (isTextInput(el) && el.selectionStart !== el.selectionEnd) {
      return el.value.slice(el.selectionStart ?? 0, el.selectionEnd ?? 0);
    }
    return getSelection()?.toString() ?? '';
  }

  // -------------------------------------------------------------------------

  chrome.runtime.onMessage.addListener((msg: ContentMessage, _sender, sendResponse) => {
    switch (msg.type) {
      case 'selection:get':
        anchorRect = selectionRect();
        sendResponse(selectedText());
        break;

      case 'field:get':
        field = captureField();
        anchorRect = field ? field.rect : null;
        sendResponse(field ? field.text : null);
        break;

      case 'field:set':
        if (field) field.replace(msg.text);
        field = null;
        setState({ title: 'Translated', text: '✓ Replaced the text in the box' });
        show(anchorRect);
        hideTimer = window.setTimeout(hide, 1400);
        break;

      case 'card:loading':
        setState({ title: 'Kata', text: 'Translating…' });
        show(anchorRect);
        break;

      case 'card:progress': {
        const m = getModel(msg.modelId);
        const name = m ? `${langName(m.src)} → ${langName(m.tgt)}` : msg.modelId;
        setState({
          title: 'First-time setup',
          text: `Downloading the ${name} model (${m?.sizeMB ?? '?'} MB). This only happens once.`,
          progress: msg.percent,
        });
        show(anchorRect);
        break;
      }

      case 'card:result': {
        const via = msg.route.length > 1 ? ' · via English' : '';
        setState({ title: `${langName(msg.src)} → ${langName(msg.tgt)}${via}`, text: msg.text, actions: true });
        show(anchorRect);
        break;
      }

      case 'card:error':
        setState({ title: 'Kata', text: msg.error, error: true });
        show(anchorRect ?? selectionRect());
        break;
    }
    return false;
  });
}

// ---------------------------------------------------------------------------
// Text fields

interface FieldTarget {
  text: string;
  rect: DOMRect;
  replace(text: string): void;
}

type TextInput = HTMLInputElement | HTMLTextAreaElement;

function deepActiveElement(): HTMLElement | null {
  let el = document.activeElement as HTMLElement | null;
  while (el?.shadowRoot?.activeElement) el = el.shadowRoot.activeElement as HTMLElement;
  return el && el !== document.body ? el : null;
}

function isTextInput(el: Element | null): el is TextInput {
  if (el instanceof HTMLTextAreaElement) return !el.readOnly && !el.disabled;
  if (el instanceof HTMLInputElement) {
    return ['text', 'search', ''].includes(el.type) && !el.readOnly && !el.disabled;
  }
  return false;
}

function captureField(): FieldTarget | null {
  const el = deepActiveElement();
  if (!el) return null;

  if (isTextInput(el)) {
    const hasSel = el.selectionStart !== el.selectionEnd;
    const start = hasSel ? el.selectionStart ?? 0 : 0;
    const end = hasSel ? el.selectionEnd ?? el.value.length : el.value.length;
    return {
      text: el.value.slice(start, end),
      rect: el.getBoundingClientRect(),
      replace(text) {
        el.focus();
        el.setSelectionRange(start, end);
        // execCommand keeps undo history and fires the events frameworks like React listen for.
        if (!document.execCommand('insertText', false, text)) {
          const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), 'value')!.set!;
          setter.call(el, el.value.slice(0, start) + text + el.value.slice(end));
          el.dispatchEvent(new Event('input', { bubbles: true }));
        }
      },
    };
  }

  if (el.isContentEditable) {
    let editor: HTMLElement = el;
    while (editor.parentElement?.isContentEditable) editor = editor.parentElement;
    const sel = getSelection();
    const useSel = !!sel && sel.rangeCount > 0 && !sel.isCollapsed && editor.contains(sel.anchorNode);
    const range = useSel ? sel!.getRangeAt(0).cloneRange() : null;
    return {
      text: useSel ? sel!.toString() : editor.innerText,
      rect: editor.getBoundingClientRect(),
      replace(text) {
        editor.focus();
        const s = getSelection()!;
        s.removeAllRanges();
        if (range) s.addRange(range);
        else {
          const all = document.createRange();
          all.selectNodeContents(editor);
          s.addRange(all);
        }
        if (!document.execCommand('insertText', false, text)) editor.innerText = text;
      },
    };
  }

  return null;
}
