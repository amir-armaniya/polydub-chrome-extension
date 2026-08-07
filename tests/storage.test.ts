import { describe, expect, it, beforeEach } from 'vitest';
import {
  DEFAULT_SETTINGS,
  STORAGE_KEYS,
  cacheTranslations,
  getSettings,
  getTranslationCache,
  saveSettings,
} from '../lib/storage';

const store = new Map<string, unknown>();

(globalThis as Record<string, unknown>).chrome = {
  storage: {
    local: {
      async get(keys: string | string[] | Record<string, unknown>) {
        const keyList = typeof keys === 'string' ? [keys] : Array.isArray(keys) ? keys : Object.keys(keys);
        const out: Record<string, unknown> = {};
        for (const k of keyList) {
          if (store.has(k)) out[k] = store.get(k);
        }
        return out;
      },
      async set(items: Record<string, unknown>) {
        for (const [k, v] of Object.entries(items)) store.set(k, v);
      },
    },
  },
};

describe('storage', () => {
  beforeEach(() => {
    store.clear();
  });

  it('returns defaults when nothing is stored', async () => {
    const s = await getSettings();
    expect(s).toEqual(DEFAULT_SETTINGS);
  });

  it('persists a partial patch and keeps other fields', async () => {
    await saveSettings({ apiKey: 'AIza-test' });
    const s = await getSettings();
    expect(s.apiKey).toBe('AIza-test');
    expect(s.targetLang).toBe('fa');
    expect(s.ttsVoice).toBe('Kore');
  });

  it('overwrites stored values', async () => {
    await saveSettings({ apiKey: 'AIza-test', ttsVoice: 'Puck', captionOverlay: false });
    const s = await getSettings();
    expect(s.ttsVoice).toBe('Puck');
    expect(s.captionOverlay).toBe(false);
  });

  it('caches translations and evicts over the limit', async () => {
    for (let i = 0; i < 2100; i++) {
      await cacheTranslations({ [`key${i}`]: `val${i}` });
    }
    const cache = await getTranslationCache();
    expect(Object.keys(cache)).toHaveLength(2000);
    expect(cache.key2099).toBe('val2099');
  });
});
