import { cacheTranslations, getApiKey, getTranslationCache } from '../../lib/storage';
import { translateItems } from '../../lib/translate';
import {
  applyTranslations,
  collectTextNodes,
  restoreText,
  type TextNodeRef,
} from '../../lib/extract';

export {};

const MAX_ELEMENTS = 100;

interface TranslatedState {
  originals: TextNodeRef[];
}

let state: TranslatedState | null = null;

async function translatePage(): Promise<{ count: number }> {
  const apiKey = await getApiKey();
  if (!apiKey) throw new Error('Add your API key in Settings first.');

  const refs = collectTextNodes(document.body, MAX_ELEMENTS);
  if (refs.length === 0) return { count: 0 };

  const cache = await getTranslationCache();
  const translations: string[] = new Array(refs.length).fill('');
  const uncached: { ref: TextNodeRef; index: number }[] = [];

  refs.forEach((ref, i) => {
    const key = ref.text.trim();
    const hit = cache[key];
    if (hit) {
      translations[i] = hit;
    } else {
      uncached.push({ ref, index: i });
    }
  });

  if (uncached.length > 0) {
    const inputs = uncached.map((u, idx) => ({ id: idx, text: u.ref.text.trim() }));
    const outputs = await translateItems(apiKey, inputs, 'fa');
    const entries: Record<string, string> = {};
    outputs.forEach((out) => {
      const original = inputs[out.id]?.text ?? '';
      if (original && out.text !== original) entries[original] = out.text;
    });
    if (Object.keys(entries).length > 0) await cacheTranslations(entries);
    outputs.forEach((out) => {
      const slot = uncached[out.id];
      if (slot) translations[slot.index] = out.text;
    });
  }

  const count = applyTranslations(refs, translations);
  state = { originals: refs.map((r) => ({ node: r.node, text: r.text })) };
  return { count };
}

async function revertPage(): Promise<{ count: number }> {
  if (!state) return { count: 0 };
  const count = restoreText(state.originals);
  state = null;
  return { count };
}

chrome.runtime.onMessage.addListener((message: unknown, _sender, sendResponse) => {
  if (!message || typeof message !== 'object') return false;
  const msg = message as { type?: string; [k: string]: unknown };

  if (msg.type === 'polydub-translate-page') {
    void translatePage().then(
      (data) => sendResponse({ ok: true, data }),
      (err) => sendResponse({ ok: false, error: err instanceof Error ? err.message : 'Translation failed' }),
    );
    return true;
  }

  if (msg.type === 'polydub-revert-page') {
    void revertPage().then(
      (data) => sendResponse({ ok: true, data }),
      (err) => sendResponse({ ok: false, error: err instanceof Error ? err.message : 'Revert failed' }),
    );
    return true;
  }

  if (msg.type === 'polydub-get-state') {
    sendResponse({ ok: true, data: { translated: state !== null } });
    return true;
  }

  if (msg.type === 'polydub-get-selection') {
    sendResponse({ ok: true, data: { text: window.getSelection()?.toString() ?? '' } });
    return true;
  }

  if (msg.type === 'polydub-read-error') {
    sendResponse({ ok: true, data: { error: typeof msg.error === 'string' ? msg.error : 'Read aloud failed' } });
    return true;
  }

  return false;
});
