# Kata

*Kata* means "word" in Malay and Indonesian.

A Chrome extension that translates text with small AI models running on the
user's own computer. Nothing is sent to a translation server. Models download
once from Hugging Face (~110 MB per language direction) and then work offline.

## What it does

| Feature | How |
|---|---|
| Translate in the popup | Click the toolbar icon, pick languages (or "Detect"), type, <kbd>Ctrl</kbd>+<kbd>Enter</kbd> |
| Translate a selection | Right-click → **Translate “…”**, or <kbd>Alt</kbd>+<kbd>Shift</kbd>+<kbd>T</kbd>. A card appears next to the text |
| Translate what you typed | In any text box, <kbd>Alt</kbd>+<kbd>Shift</kbd>+<kbd>Y</kbd> replaces your text (or just the selected part) with the translation |
| Model manager | Options page: download/delete models, see sizes and storage used |

25 languages, 54 models. Pairs without a direct model go through English
(e.g. Indonesian → French = `id-en` + `en-fr`). Source language detection uses
Chrome's built-in, on-device `chrome.i18n.detectLanguage`.

## How it works

```
popup / options / content card
        │  chrome.runtime messages
        ▼
background.js (service worker)  ── routing, language detection, context menu, shortcuts
        │
        ▼
offscreen.html / offscreen.js   ── transformers.js + ONNX Runtime (WebAssembly)
        │                          runs Opus-MT (MarianMT) models, 8-bit quantised
        ▼
Cache API ("transformers-cache") ── downloaded model files, persisted with unlimitedStorage
```

- **Models:** [Helsinki-NLP Opus-MT](https://github.com/Helsinki-NLP/Opus-MT) converted to ONNX
  (`Xenova/opus-mt-*` on Hugging Face). Licence: CC-BY 4.0, so commercial use is fine with attribution.
  The catalogue lives in [`src/models.ts`](src/models.ts).
- **No remote code:** ONNX Runtime's `.wasm` ships inside the extension (`dist/ort/`), and the
  build strips transformers.js's CDN fallback (see `build.mjs`). Only model *weights* are downloaded.
- **Minimal permissions:** no host permissions. The content script is injected on demand via
  `activeTab` when the user right-clicks or presses a shortcut.
- **Long text** is split into sentences (≤400 characters per chunk) and translated in batches,
  keeping line breaks.

## Develop

```sh
npm install
npm run build        # → dist/
npm run typecheck
node test/core.test.mjs   # splitter, routing, real models under Node
node test/e2e.mjs         # loads dist/ in Chromium (npx playwright install chromium,
                          # or CHROME_PATH=/path/to/chrome-for-testing)
```

Load it: `chrome://extensions` → Developer mode → **Load unpacked** → pick `dist/`.

## Publish to the Chrome Web Store

1. `npm run zip` → `kata-<version>.zip`
2. Register at the [Chrome Web Store developer dashboard](https://chrome.google.com/webstore/devconsole) (one-time US$5 fee).
3. Upload the zip, then fill in the listing using [`store/LISTING.md`](store/LISTING.md)
   (description, permission justifications, data-use answers).
4. Privacy policy URL: <https://hafiezul.github.io/kata/privacy.html> (served by GitHub Pages from `docs/`;
   keep [`docs/privacy.html`](docs/privacy.html) in sync with [`store/PRIVACY.md`](store/PRIVACY.md)).
5. Screenshots: 1280×800 of the popup, the in-page card, and the model manager.

## Ideas for next versions

- **Smaller models:** Mozilla's Firefox Translations (Bergamot) models are ~15–40 MB per direction
  versus ~110 MB here. Add them as a second engine.
- **Chrome's built-in Translator API** as a zero-download engine where it's available.
- **Malay:** no Opus-MT `ms` models in ONNX form yet. Options are converting `Helsinki-NLP/opus-mt-mul-en`
  / `en-mul`, or using NLLB (but NLLB is non-commercial).
- **WebGPU** for faster translation of long pages; whole-page translation.
- **Glossary** of terms that must not be translated (names, product terms).

## License

Code: [MIT](LICENSE). Translation models: Opus-MT, CC-BY 4.0 (University of Helsinki).
