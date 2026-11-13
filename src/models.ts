// Catalogue of local translation models and the routing between languages.
//
// Every model is a MarianMT (Opus-MT) model converted to ONNX by Xenova and
// hosted on Hugging Face. Sizes are the 8-bit ("q8") download in MB:
// encoder + merged decoder + tokenizer + config.

export const LANGUAGES: Record<string, string> = {
  af: 'Afrikaans',
  ar: 'Arabic',
  cs: 'Czech',
  da: 'Danish',
  de: 'German',
  en: 'English',
  es: 'Spanish',
  et: 'Estonian',
  fi: 'Finnish',
  fr: 'French',
  hi: 'Hindi',
  hu: 'Hungarian',
  id: 'Indonesian',
  it: 'Italian',
  ja: 'Japanese',
  ko: 'Korean',
  nl: 'Dutch',
  pl: 'Polish',
  ro: 'Romanian',
  ru: 'Russian',
  sv: 'Swedish',
  th: 'Thai',
  tr: 'Turkish',
  uk: 'Ukrainian',
  vi: 'Vietnamese',
  zh: 'Chinese',
};

export interface ModelInfo {
  /** "<src>-<tgt>", e.g. "id-en" */
  id: string;
  src: string;
  tgt: string;
  /** Hugging Face repo */
  repo: string;
  /** Approximate download size in MB */
  sizeMB: number;
  /** Some multi-target models need a target-language token in front of the input. */
  prefix?: string;
}

const SIZES: Record<string, number> = {
  'af-en': 111, 'ar-en': 118, 'cs-en': 117, 'da-en': 113, 'de-en': 112,
  'en-af': 111, 'en-ar': 118, 'en-cs': 117, 'en-da': 113, 'en-de': 112,
  'en-es': 119, 'en-fi': 119, 'en-fr': 113, 'en-hi': 117, 'en-hu': 117,
  'en-id': 108, 'en-it': 136, 'en-nl': 122, 'en-ro': 113, 'en-ru': 118,
  'en-sv': 110, 'en-uk': 117, 'en-vi': 107, 'en-zh': 119, 'es-en': 119,
  'et-en': 112, 'fi-en': 113, 'fr-en': 113, 'hi-en': 116, 'hu-en': 117,
  'id-en': 108, 'it-en': 137, 'ja-en': 115, 'ko-en': 120, 'nl-en': 122,
  'pl-en': 118, 'ru-en': 118, 'sv-en': 110, 'th-en': 117, 'tr-en': 117,
  'uk-en': 117, 'vi-en': 107, 'zh-en': 119, 'de-fr': 115, 'fr-de': 115,
  'de-es': 115, 'es-de': 115, 'fr-es': 131, 'es-fr': 131, 'it-es': 113,
  'es-it': 113, 'it-fr': 113, 'ru-uk': 113, 'uk-ru': 113,
};

const PREFIXES: Record<string, string> = {
  // opus-mt-en-zh is multi-target; this selects Simplified Mandarin.
  'en-zh': '>>cmn_Hans<< ',
};

export const MODELS: ModelInfo[] = Object.entries(SIZES).map(([id, sizeMB]) => {
  const [src, tgt] = id.split('-');
  return { id, src, tgt, repo: `Xenova/opus-mt-${id}`, sizeMB, prefix: PREFIXES[id] };
});

const BY_ID = new Map(MODELS.map((m) => [m.id, m]));

export function getModel(id: string): ModelInfo | undefined {
  return BY_ID.get(id);
}

/**
 * Models needed to go from `src` to `tgt`. Uses a direct model when one
 * exists, otherwise pivots through English. Returns null when impossible.
 */
export function findRoute(src: string, tgt: string): ModelInfo[] | null {
  if (src === tgt) return [];
  const direct = BY_ID.get(`${src}-${tgt}`);
  if (direct) return [direct];
  if (src !== 'en' && tgt !== 'en') {
    const a = BY_ID.get(`${src}-en`);
    const b = BY_ID.get(`en-${tgt}`);
    if (a && b) return [a, b];
  }
  return null;
}

/** Languages we can translate *from* (to at least one other language). */
export const SOURCE_LANGS = Object.keys(LANGUAGES).filter((s) =>
  Object.keys(LANGUAGES).some((t) => t !== s && findRoute(s, t)),
);

/** Languages we can translate *into*. */
export const TARGET_LANGS = Object.keys(LANGUAGES).filter((t) =>
  Object.keys(LANGUAGES).some((s) => s !== t && findRoute(s, t)),
);

export function langName(code: string): string {
  return LANGUAGES[code] ?? code;
}

/** Normalise a detector/browser code such as "zh-CN" or "en-US" to ours. */
export function normaliseLang(code: string): string {
  return code.toLowerCase().split(/[-_]/)[0];
}
