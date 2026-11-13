// Loads dist/ into Chromium and checks the real thing end to end:
// options page → download model → popup translation (direct + via English),
// plus the in-page text-box replacement logic.
//
//   npm run build && node test/e2e.mjs
import { chromium } from 'playwright';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const dist = resolve('dist');
const ctx = await chromium.launchPersistentContext(mkdtempSync(join(tmpdir(), 'lt-')), {
  channel: 'chromium',
  executablePath: process.env.CHROME_PATH,
  headless: true,
  args: [`--disable-extensions-except=${dist}`, `--load-extension=${dist}`],
});
const fail = (m) => {
  console.error('FAIL', m);
  process.exitCode = 1;
};
const ok = (c, m) => (c ? console.log('ok  ', m) : fail(m));

try {
  const sw = ctx.serviceWorkers()[0] ?? (await ctx.waitForEvent('serviceworker'));
  const id = new URL(sw.url()).host;
  console.log('extension', id);

  // Options page opens on install; use our own tab to be deterministic.
  const options = await ctx.newPage();
  options.on('console', (m) => m.type() === 'error' && console.log('[options]', m.text()));
  await options.goto(`chrome-extension://${id}/options.html`);
  await options.waitForSelector('#rows tr');
  ok((await options.locator('#rows tr').count()) > 40, 'options lists models');

  // Download Indonesian → English from the model manager.
  await options.selectOption('#filter', 'id');
  const row = options.locator('#rows tr', { hasText: 'Indonesian → English' });
  const t0 = Date.now();
  await row.getByRole('button', { name: 'Download' }).click();
  await row.getByText('Ready').waitFor({ timeout: 300_000 });
  ok(true, `downloaded id-en in ${((Date.now() - t0) / 1000).toFixed(1)} s`);

  // The offscreen document should be cross-origin isolated (multi-threaded WASM).
  const offscreen = await sw.evaluate(async () => {
    const c = await chrome.runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'] });
    return c.length;
  });
  ok(offscreen === 1, 'offscreen document running');

  // Popup translation.
  const popup = await ctx.newPage();
  popup.on('console', (m) => m.type() === 'error' && console.log('[popup]', m.text()));
  await popup.goto(`chrome-extension://${id}/popup.html`);
  const translate = async (src, tgt, text) => {
    await popup.selectOption('#src', src);
    await popup.selectOption('#tgt', tgt);
    await popup.fill('#input', text);
    await popup.evaluate(() => (document.getElementById('out').textContent = ''));
    const t = Date.now();
    await popup.click('#go');
    await popup.waitForFunction(
      () => document.getElementById('out').textContent || document.getElementById('status').className.includes('err'),
      null,
      { timeout: 300_000 },
    );
    const out = await popup.textContent('#out');
    const status = await popup.textContent('#status');
    console.log(`     ${src}→${tgt}: ${JSON.stringify(out)} [${status}] ${Date.now() - t} ms`);
    return out;
  };
  ok(/rice/i.test(await translate('id', 'en', 'Saya suka makan nasi goreng.')), 'popup id→en');
  ok(
    (await translate('id', 'en', 'Selamat pagi.\n\nTerima kasih banyak.')).includes('\n\n'),
    'popup keeps paragraph breaks',
  );
  ok(/riz|aime/i.test(await translate('id', 'fr', 'Saya suka makan nasi goreng.')), 'popup id→fr via English');
  ok(/rice/i.test(await translate('auto', 'en', 'Saya sangat suka makan nasi goreng di pagi hari bersama keluarga.')), 'popup auto-detect');

  // Content script: text-box replacement with a stubbed extension API.
  const page = await ctx.newPage();
  await page.setContent(`<textarea id="t">Halo dunia</textarea><div id="ce" contenteditable>Halo dunia</div>`);
  await page.evaluate(() => {
    Object.defineProperty(window, 'chrome', {
      configurable: true,
      value: { runtime: { onMessage: { addListener: (fn) => (window.__listener = fn) } } },
    });
  });
  await page.addScriptTag({ content: readFileSync(join(dist, 'content.js'), 'utf8') });
  const call = (msg) =>
    page.evaluate((m) => new Promise((r) => window.__listener(m, {}, r) || r(undefined)), msg);
  for (const sel of ['#t', '#ce']) {
    await page.focus(sel);
    ok((await call({ type: 'field:get' })) === 'Halo dunia', `${sel}: reads focused field`);
    await call({ type: 'field:set', text: 'Hello world' });
    const v = await page.$eval(sel, (el) => ('value' in el ? el.value : el.innerText));
    ok(v === 'Hello world', `${sel}: replaces text`);
  }
} finally {
  await ctx.close();
}
