// Message shapes passed between the extension's contexts.

export interface Settings {
  /** Target language for "Translate selection". */
  targetLang: string;
  /** "Translate what I typed": from this language ("auto" = detect)… */
  fieldSourceLang: string;
  /** …into this one. */
  fieldTargetLang: string;
}

export const DEFAULT_SETTINGS: Settings = {
  targetLang: 'en',
  fieldSourceLang: 'auto',
  fieldTargetLang: 'en',
};

export interface TranslateResult {
  ok: true;
  text: string;
  src: string;
  tgt: string;
  /** Model ids used, e.g. ["id-en", "en-fr"] when pivoting through English. */
  route: string[];
}

export interface ErrorResult {
  ok: false;
  error: string;
}

export interface ModelStatus {
  ok: true;
  downloaded: string[];
}

/** Sent by the offscreen document while files download. */
export interface ProgressMessage {
  type: 'progress';
  modelId: string;
  loaded: number;
  total: number;
  done: boolean;
}

/** Requests the popup/options/content scripts send to the background. */
export type Request =
  | { type: 'translate'; text: string; src: string; tgt: string }
  | { type: 'models:status' }
  | { type: 'models:download'; modelId: string }
  | { type: 'models:delete'; modelId: string };

/** Requests the background forwards to the offscreen document. */
export type OffscreenRequest =
  | { target: 'offscreen'; type: 'translate'; text: string; modelId: string }
  | { target: 'offscreen'; type: 'status' }
  | { target: 'offscreen'; type: 'download'; modelId: string }
  | { target: 'offscreen'; type: 'delete'; modelId: string };

/** Messages the background sends to the injected content script. */
export type ContentMessage =
  | { type: 'card:loading'; anchor: 'selection' | 'field' }
  | { type: 'card:progress'; percent: number; modelId: string }
  | { type: 'card:result'; text: string; src: string; tgt: string; route: string[] }
  | { type: 'card:error'; error: string }
  | { type: 'selection:get' }
  | { type: 'field:get' }
  | { type: 'field:set'; text: string };

/** Omit that works across each member of a union. */
export type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;

export function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
