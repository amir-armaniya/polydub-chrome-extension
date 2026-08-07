import { validateApiKey } from '../../lib/gemini';
import { getApiKey } from '../../lib/storage';
import { pcmBase64ToWavDataUrl, synthesizeSpeech } from '../../lib/tts';

const TTS_VOICE = 'Kore';

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: 'polydub-read-selection',
    title: 'Read aloud with PolyDub',
    contexts: ['selection'],
  });
});

async function ensureOffscreen(): Promise<void> {
  if (await chrome.offscreen.hasDocument()) return;
  await chrome.offscreen.createDocument({
    url: 'offscreen/offscreen.html',
    reasons: [chrome.offscreen.Reason.AUDIO_PLAYBACK],
    justification: 'Play synthesized speech audio for the Read feature',
  });
}

async function readAloud(text: string): Promise<{ ok: boolean; error?: string }> {
  if (!text.trim()) return { ok: false, error: 'Nothing selected to read' };
  const apiKey = await getApiKey();
  if (!apiKey) return { ok: false, error: 'Add your API key in Settings first.' };
  const audio = await synthesizeSpeech(apiKey, text, TTS_VOICE);
  const dataUrl = pcmBase64ToWavDataUrl(audio.base64, audio.sampleRate);
  await ensureOffscreen();
  const res = (await chrome.runtime.sendMessage({ type: 'polydub-play-audio', dataUrl })) as {
    ok?: boolean;
    error?: string;
  };
  if (!res?.ok) return { ok: false, error: res?.error ?? 'Playback failed' };
  return { ok: true };
}

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === 'polydub-read-selection' && info.selectionText) {
    void readAloud(info.selectionText).catch((err: unknown) => {
      const tabId = tab?.id;
      if (tabId == null) return;
      void chrome.tabs.sendMessage(tabId, {
        type: 'polydub-read-error',
        error: err instanceof Error ? err.message : 'Read aloud failed',
      });
    });
  }
});

chrome.runtime.onMessage.addListener((message: unknown, _sender, sendResponse) => {
  if (!message || typeof message !== 'object') return false;
  const msg = message as { type?: string; [k: string]: unknown };

  if (msg.type === 'polydub-validate-key') {
    const key = typeof msg.apiKey === 'string' ? msg.apiKey : '';
    void validateApiKey(key)
      .then(() => sendResponse({ ok: true }))
      .catch((err: unknown) => sendResponse({ ok: false, error: err instanceof Error ? err.message : 'Invalid key' }));
    return true;
  }

  if (msg.type === 'polydub-inject-content') {
    const tabId = typeof msg.tabId === 'number' ? msg.tabId : null;
    if (tabId == null) {
      sendResponse({ ok: false, error: 'No tab id' });
      return false;
    }
    void chrome.scripting.executeScript({
      target: { tabId },
      files: ['content/content.js'],
    })
      .then(() => sendResponse({ ok: true }))
      .catch((err: unknown) => sendResponse({ ok: false, error: err instanceof Error ? err.message : 'Inject failed' }));
    return true;
  }

  if (msg.type === 'polydub-read-aloud') {
    const text = typeof msg.text === 'string' ? msg.text : '';
    void readAloud(text)
      .then((res) => sendResponse(res))
      .catch((err: unknown) => sendResponse({ ok: false, error: err instanceof Error ? err.message : 'Read failed' }));
    return true;
  }

  return false;
});
