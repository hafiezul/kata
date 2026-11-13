// Service worker: routes requests, owns the offscreen document, handles the
// context menu and keyboard shortcuts.

import { findRoute, getModel, langName, LANGUAGES, normaliseLang } from './models';
import {
  DEFAULT_SETTINGS,
  errorMessage,
  type ContentMessage,
  type DistributiveOmit,
  type ErrorResult,
  type OffscreenRequest,
  type ProgressMessage,
  type Request,
  type Settings,
  type TranslateResult,
} from './messages';

// ---------------------------------------------------------------------------
// Offscreen document

let creating: Promise<void> | null = null;

async function ensureOffscreen() {
  const contexts = await chrome.runtime.getContexts({
    contextTypes: [chrome.runtime.ContextType.OFFSCREEN_DOCUMENT],
  });
  if (contexts.length) return;
  creating ??= chrome.offscreen
    .createDocument({
      url: 'offscreen.html',
      reasons: [chrome.offscreen.Reason.WORKERS],
      justification: 'Runs translation models locally with WebAssembly so text never leaves the device.',
    })
    .finally(() => {
      creating = null;
    });
  await creating;
}

async function toOffscreen<T>(msg: DistributiveOmit<OffscreenRequest, 'target'>): Promise<T> {
  await ensureOffscreen();
  const res = await chrome.runtime.sendMessage({ ...msg, target: 'offscreen' });
  if (!res?.ok) throw new Error(res?.error ?? 'Translation engine did not respond');
  return res as T;
}

// ---------------------------------------------------------------------------
// Translation

async function getSettings(): Promise<Settings> {
  return { ...DEFAULT_SETTINGS, ...(await chrome.storage.sync.get(DEFAULT_SETTINGS)) } as Settings;
}

/**
 * Languages the detector reports that we translate with a close relative's
 * model. The detector often labels Indonesian as Malay, and the Indonesian
 * model handles Malay reasonably well.
 */
const DETECT_ALIASES: Record<string, string> = { ms: 'id' };

async function detectLanguage(text: string): Promise<string> {
  const res = await chrome.i18n.detectLanguage(text.slice(0, 2000));
  const ranked = [...res.languages]
    .sort((a, b) => b.percentage - a.percentage)
    .map((l) => normaliseLang(l.language))
    .map((l) => DETECT_ALIASES[l] ?? l);
  if (!ranked.length) throw new Error("Couldn't detect the language. Pick the source language instead.");
  return ranked.find((l) => LANGUAGES[l]) ?? ranked[0];
}

async function translate(text: string, src: string, tgt: string): Promise<TranslateResult> {
  if (!text.trim()) throw new Error('Nothing to translate.');
  const from = src === 'auto' ? await detectLanguage(text) : src;
  if (!LANGUAGES[from]) throw new Error(`${langName(from)} (${from}) isn't supported yet.`);
  if (from === tgt) return { ok: true, text, src: from, tgt, route: [] };

  const route = findRoute(from, tgt);
  if (!route) throw new Error(`No model for ${langName(from)} → ${langName(tgt)} yet.`);

  let out = text;
  for (const model of route) {
    out = (await toOffscreen<{ text: string }>({ type: 'translate', text: out, modelId: model.id })).text;
  }
  return { ok: true, text: out, src: from, tgt, route: route.map((m) => m.id) };
}

// ---------------------------------------------------------------------------
// Messages from popup, options and content scripts

async function handle(msg: Request): Promise<unknown> {
  switch (msg.type) {
    case 'translate':
      return translate(msg.text, msg.src, msg.tgt);
    case 'models:status':
      return toOffscreen({ type: 'status' });
    case 'models:download':
      if (!getModel(msg.modelId)) throw new Error('Unknown model');
      return toOffscreen({ type: 'download', modelId: msg.modelId });
    case 'models:delete':
      return toOffscreen({ type: 'delete', modelId: msg.modelId });
  }
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.target === 'offscreen') return false;
  if (msg?.type === 'progress') {
    forwardProgress(msg as ProgressMessage);
    return false;
  }
  handle(msg as Request).then(sendResponse, (e) =>
    sendResponse({ ok: false, error: errorMessage(e) } satisfies ErrorResult),
  );
  return true;
});

// ---------------------------------------------------------------------------
// In-page card (context menu + shortcuts)

/** Tab currently waiting on a translation, so download progress can be shown there. */
let activeTabId: number | null = null;

function forwardProgress(p: ProgressMessage) {
  if (activeTabId === null || !p.total) return;
  send(activeTabId, {
    type: 'card:progress',
    modelId: p.modelId,
    percent: Math.round((p.loaded / p.total) * 100),
  });
}

async function injectContent(tabId: number): Promise<boolean> {
  try {
    await chrome.scripting.executeScript({ target: { tabId }, files: ['content.js'] });
    return true;
  } catch {
    // chrome://, the Web Store and similar pages can't be scripted.
    return false;
  }
}

function send<T = unknown>(tabId: number, msg: ContentMessage): Promise<T | undefined> {
  return chrome.tabs.sendMessage(tabId, msg).catch(() => undefined);
}

async function translateIntoCard(tabId: number, text: string) {
  const settings = await getSettings();
  await send(tabId, { type: 'card:loading', anchor: 'selection' });
  activeTabId = tabId;
  try {
    const res = await translate(text, 'auto', settings.targetLang);
    await send(tabId, { type: 'card:result', text: res.text, src: res.src, tgt: res.tgt, route: res.route });
  } catch (e) {
    await send(tabId, { type: 'card:error', error: errorMessage(e) });
  } finally {
    activeTabId = null;
  }
}

async function translateSelection(tabId: number, menuSelection?: string) {
  if (!(await injectContent(tabId))) return;
  // Prefer the page's own selection: it keeps line breaks, which the menu's copy drops.
  const text = (await send<string>(tabId, { type: 'selection:get' })) || menuSelection;
  if (!text?.trim()) {
    await send(tabId, { type: 'card:error', error: 'Select some text first.' });
    return;
  }
  await translateIntoCard(tabId, text);
}

async function translateField(tabId: number) {
  if (!(await injectContent(tabId))) return;
  const text = await send<string | null>(tabId, { type: 'field:get' });
  if (text === null || text === undefined) {
    await send(tabId, { type: 'card:error', error: 'Click into a text box first.' });
    return;
  }
  if (!text.trim()) return;
  const settings = await getSettings();
  await send(tabId, { type: 'card:loading', anchor: 'field' });
  activeTabId = tabId;
  try {
    const res = await translate(text, settings.fieldSourceLang, settings.fieldTargetLang);
    await send(tabId, { type: 'field:set', text: res.text });
  } catch (e) {
    await send(tabId, { type: 'card:error', error: errorMessage(e) });
  } finally {
    activeTabId = null;
  }
}

chrome.runtime.onInstalled.addListener(async ({ reason }) => {
  chrome.contextMenus.create({
    id: 'translate-selection',
    title: 'Translate “%s”',
    contexts: ['selection'],
  });
  if (reason === chrome.runtime.OnInstalledReason.INSTALL) {
    // Default the target to the browser's language when we support it.
    const ui = normaliseLang(chrome.i18n.getUILanguage());
    if (LANGUAGES[ui] && ui !== 'en') await chrome.storage.sync.set({ targetLang: ui });
    chrome.runtime.openOptionsPage();
  }
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === 'translate-selection' && tab?.id !== undefined) {
    translateSelection(tab.id, info.selectionText);
  }
});

chrome.commands.onCommand.addListener((command, tab) => {
  if (tab?.id === undefined) return;
  if (command === 'translate-selection') translateSelection(tab.id);
  if (command === 'translate-field') translateField(tab.id);
});
