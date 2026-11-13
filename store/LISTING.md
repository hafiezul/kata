# Chrome Web Store listing: copy to paste

## Name
Kata – Private Offline Translator

(The manifest uses this full name so it shows up in Web Store searches for "offline translator"; `short_name` is "Kata".)

## Short description (≤132 characters)
Private translation that runs on your computer. Small AI models, no servers, works offline after a one-time download.

## Category
Productivity (or: Tools)

## Detailed description

Translate without sending your text anywhere.

Kata runs small AI translation models directly in your browser. Your emails, chats and
documents never leave your computer: there is no server, no account and no tracking.

• Translate selected text: right-click → Translate, or Alt+Shift+T
• Translate what you type: write in your language in any text box, press Alt+Shift+Y, and it's replaced with the translation
• Quick translate in the toolbar popup
• 25 languages including English, Indonesian, Chinese, Japanese, Korean, Vietnamese, Thai, Hindi, Arabic, Spanish, French, German and Russian
• Works offline once a language is downloaded
• Download only the languages you need (about 110 MB each), and delete them any time

How it works: the first time you use a language pair, the extension downloads an open-source
translation model (Opus-MT, from the University of Helsinki) and keeps it on your device. Every
translation after that runs locally.

## Single purpose (required field)
Translate text between languages using translation models that run locally in the browser.

## Permission justifications (required fields)

**activeTab**: When the user right-clicks "Translate" or presses a shortcut, the extension reads the selected text or the focused text box on that tab, and shows the translation there. It has no access to pages otherwise.

**scripting**: Injects the small script that shows the translation card or replaces text in the focused text box, only on the tab where the user invoked the extension (via activeTab).

**contextMenus**: Adds the "Translate selection" item to the right-click menu.

**offscreen**: Runs the translation model (WebAssembly) in an offscreen document, because extension service workers can't host long-running compute.

**storage**: Saves the user's language preferences.

**unlimitedStorage**: Translation models are about 110 MB each and are kept on the device so translation works offline. Without this, the browser may delete them under storage pressure, forcing large re-downloads.

**Remote code**: No. All JavaScript and WebAssembly ship in the package. The extension downloads only model weight files (data, not code) from huggingface.co.

## Data usage (privacy practices tab)
- Collects: **none** of the listed data types.
- Certify: not sold to third parties; not used for unrelated purposes; not used for creditworthiness.
- Privacy policy URL: host `store/PRIVACY.md` publicly and paste the link.

## Attribution (put in description footer or an About section)
Translation models: Opus-MT by Helsinki-NLP (CC-BY 4.0), ONNX conversions by Xenova.
Runtime: Transformers.js and ONNX Runtime Web (Apache-2.0 / MIT).
