export const STORAGE_KEYS = {
  apiKey: 'api_key',
  targetLang: 'target_lang',
  ttsVoice: 'tts_voice',
  ttsStyle: 'tts_style',
  captionOverlay: 'caption_overlay',
  monitorVolume: 'monitor_volume',
  translationCache: 'translation_cache',
} as const;

export interface Settings {
  apiKey: string;
  targetLang: string;
  ttsVoice: string;
  ttsStyle: string;
  captionOverlay: boolean;
  monitorVolume: number;
}

export const DEFAULT_SETTINGS: Settings = {
  apiKey: '',
  targetLang: 'fa',
  ttsVoice: 'Kore',
  ttsStyle: 'formal',
  captionOverlay: true,
  monitorVolume: 0.4,
};

function isSettings(value: unknown): value is Settings {
  if (!value || typeof value !== 'object') return false;
  const s = value as Record<string, unknown>;
  return (
    typeof s.apiKey === 'string' &&
    typeof s.targetLang === 'string' &&
    typeof s.ttsVoice === 'string' &&
    typeof s.ttsStyle === 'string' &&
    typeof s.captionOverlay === 'boolean' &&
    typeof s.monitorVolume === 'number'
  );
}

export async function getSettings(): Promise<Settings> {
  const stored = await chrome.storage.local.get([
    STORAGE_KEYS.apiKey,
    STORAGE_KEYS.targetLang,
    STORAGE_KEYS.ttsVoice,
    STORAGE_KEYS.ttsStyle,
    STORAGE_KEYS.captionOverlay,
    STORAGE_KEYS.monitorVolume,
  ]);
  return {
    apiKey: typeof stored[STORAGE_KEYS.apiKey] === 'string' ? stored[STORAGE_KEYS.apiKey] : DEFAULT_SETTINGS.apiKey,
    targetLang: typeof stored[STORAGE_KEYS.targetLang] === 'string' ? stored[STORAGE_KEYS.targetLang] : DEFAULT_SETTINGS.targetLang,
    ttsVoice: typeof stored[STORAGE_KEYS.ttsVoice] === 'string' ? stored[STORAGE_KEYS.ttsVoice] : DEFAULT_SETTINGS.ttsVoice,
    ttsStyle: typeof stored[STORAGE_KEYS.ttsStyle] === 'string' ? stored[STORAGE_KEYS.ttsStyle] : DEFAULT_SETTINGS.ttsStyle,
    captionOverlay: typeof stored[STORAGE_KEYS.captionOverlay] === 'boolean' ? stored[STORAGE_KEYS.captionOverlay] : DEFAULT_SETTINGS.captionOverlay,
    monitorVolume: typeof stored[STORAGE_KEYS.monitorVolume] === 'number' ? stored[STORAGE_KEYS.monitorVolume] : DEFAULT_SETTINGS.monitorVolume,
  };
}

export async function saveSettings(patch: Partial<Settings>): Promise<Settings> {
  const current = await getSettings();
  const next = { ...current, ...patch };
  if (isSettings(next)) {
    await chrome.storage.local.set({
      [STORAGE_KEYS.apiKey]: next.apiKey,
      [STORAGE_KEYS.targetLang]: next.targetLang,
      [STORAGE_KEYS.ttsVoice]: next.ttsVoice,
      [STORAGE_KEYS.ttsStyle]: next.ttsStyle,
      [STORAGE_KEYS.captionOverlay]: next.captionOverlay,
      [STORAGE_KEYS.monitorVolume]: next.monitorVolume,
    });
  }
  return next;
}

export async function hasApiKey(): Promise<boolean> {
  const s = await getSettings();
  return s.apiKey.trim().length > 0;
}

export async function getApiKey(): Promise<string> {
  const s = await getSettings();
  return s.apiKey.trim();
}

export type TranslationCache = Record<string, string>;

export async function getTranslationCache(): Promise<TranslationCache> {
  const stored = await chrome.storage.local.get(STORAGE_KEYS.translationCache);  const v = stored[STORAGE_KEYS.translationCache];
  if (!v || typeof v !== 'object' || Array.isArray(v)) return {};
  return v as TranslationCache;
}

export async function cacheTranslations(entries: Record<string, string>): Promise<void> {
  const cache = await getTranslationCache();
  const merged = { ...cache, ...entries };
  const keys = Object.keys(merged);
  if (keys.length > 2000) {
    for (const k of keys.slice(0, keys.length - 2000)) delete merged[k];
  }
  await chrome.storage.local.set({ [STORAGE_KEYS.translationCache]: merged });
}
