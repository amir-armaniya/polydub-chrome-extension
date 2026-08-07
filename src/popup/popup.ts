import {
  getSettings,
  hasApiKey,
  saveSettings,
} from '../../lib/storage';
import { validateApiKey } from '../../lib/gemini';

const $ = <T extends HTMLElement>(id: string): T => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Missing element #${id}`);
  return el as T;
};

const tabButtons = Array.from(document.querySelectorAll<HTMLButtonElement>('.tab'));
const panels = Array.from(document.querySelectorAll<HTMLElement>('.panel'));
const apiKeyInput = $<HTMLInputElement>('api-key');
const saveKeyBtn = $<HTMLButtonElement>('save-key');
const clearKeyBtn = $<HTMLButtonElement>('clear-key');
const testKeyBtn = $<HTMLButtonElement>('test-key');
const settingsStatus = $<HTMLParagraphElement>('settings-status');
const footerNote = $<HTMLSpanElement>('footer-note');
const statusDot = $<HTMLSpanElement>('status-dot');
const translatePageBtn = $<HTMLButtonElement>('translate-page');
const readSelectionBtn = $<HTMLButtonElement>('read-selection');
const audioPlayBtn = $<HTMLButtonElement>('audio-play');
const audioStopBtn = $<HTMLButtonElement>('audio-stop');
const dubToggleBtn = $<HTMLButtonElement>('dub-toggle');
const translateStatus = $<HTMLParagraphElement>('translate-status');
const readStatus = $<HTMLParagraphElement>('read-status');
const dubStatus = $<HTMLParagraphElement>('dub-status');

const tabs = ['translate', 'read', 'live', 'settings'] as const;

async function ensureContent(tabId: number): Promise<boolean> {
  try {
    await chrome.tabs.sendMessage(tabId, { type: 'polydub-get-state' });
    return true;
  } catch {
    const res = await chrome.runtime.sendMessage({ type: 'polydub-inject-content', tabId });
    return res?.ok === true;
  }
}

function switchTab(name: (typeof tabs)[number]): void {
  for (const btn of tabButtons) {
    btn.setAttribute('aria-selected', String(btn.dataset.tab === name));
  }
  for (const p of panels) {
    p.hidden = p.dataset.panel !== name;
  }
}

for (const btn of tabButtons) {
  btn.addEventListener('click', () => switchTab((btn.dataset.tab as (typeof tabs)[number]) ?? 'settings'));
}

function setStatus(el: HTMLElement, msg: string, kind: 'info' | 'ok' | 'error' = 'info'): void {
  el.textContent = msg;
  el.classList.toggle('error', kind === 'error');
  el.classList.toggle('ok', kind === 'ok');
}

async function refreshKeyState(): Promise<void> {
  const settings = await getSettings();
  const hasKey = settings.apiKey.length > 0;
  apiKeyInput.value = hasKey ? '' : '';
  apiKeyInput.placeholder = hasKey ? '•••••••••••••••• (saved)' : 'Paste key from Google AI Studio';
  saveKeyBtn.hidden = hasKey;
  clearKeyBtn.hidden = !hasKey;
  testKeyBtn.hidden = !hasKey;
  translatePageBtn.disabled = !hasKey;
  readSelectionBtn.disabled = !hasKey;
  dubToggleBtn.disabled = !hasKey;
  footerNote.textContent = hasKey ? 'Ready. Open a page and press Translate Page.' : 'Add your Gemini API key to get started.';
  statusDot.classList.toggle('ok', hasKey);
}

saveKeyBtn.addEventListener('click', async () => {
  const key = apiKeyInput.value.trim();
  if (!key) {
    setStatus(settingsStatus, 'Paste a Gemini API key first.', 'error');
    return;
  }
  settingsStatus.textContent = 'Validating key…';
  try {
    await validateApiKey(key);
  } catch (err) {
    setStatus(settingsStatus, err instanceof Error ? `Invalid key: ${err.message}` : 'Invalid key.', 'error');
    return;
  }
  await saveSettings({ apiKey: key });
  setStatus(settingsStatus, 'Key saved on device.', 'ok');
  await refreshKeyState();
});

clearKeyBtn.addEventListener('click', async () => {
  await saveSettings({ apiKey: '' });
  setStatus(settingsStatus, 'Key cleared.', 'info');
  await refreshKeyState();
});

testKeyBtn.addEventListener('click', async () => {
  const { apiKey } = await getSettings();
  settingsStatus.textContent = 'Testing connection…';
  try {
    await validateApiKey(apiKey);
    setStatus(settingsStatus, 'Connection OK.', 'ok');
  } catch (err) {
    setStatus(settingsStatus, err instanceof Error ? err.message : 'Connection failed.', 'error');
  }
});

function setTranslateButton(translated: boolean): void {
  translatePageBtn.textContent = translated ? 'Revert Page' : 'Translate Page';
}

translatePageBtn.addEventListener('click', async () => {
  if (!(await hasApiKey())) {
    setStatus(translateStatus, 'Add your API key in Settings first.', 'error');
    switchTab('settings');
    return;
  }
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) throw new Error('No active tab');
    if (!(await ensureContent(tab.id))) throw new Error('Cannot reach page (try a normal web page)');

    const stateRes = (await chrome.tabs.sendMessage(tab.id, {
      type: 'polydub-get-state',
    })) as { ok: boolean; data?: { translated?: boolean }; error?: string };
    const isTranslated = stateRes?.data?.translated === true;

    const res = (await chrome.tabs.sendMessage(tab.id, {
      type: isTranslated ? 'polydub-revert-page' : 'polydub-translate-page',
    })) as { ok: boolean; data?: { count?: number }; error?: string };

    if (!res?.ok) throw new Error(res?.error ?? 'Failed');
    const count = res.data?.count ?? 0;
    setTranslateButton(!isTranslated);
    setStatus(
      translateStatus,
      isTranslated ? `Restored ${count} elements.` : `Translated ${count} elements.`,
      'ok',
    );
  } catch (err) {
    setStatus(translateStatus, err instanceof Error ? err.message : 'Translation failed.', 'error');
  }
});

interface AudioState {
  state: 'idle' | 'playing' | 'paused';
  position?: number;
  duration?: number;
  error?: string;
}

let audioState: AudioState = { state: 'idle' };
let playbackActive = false;

function applyAudioState(state: AudioState): void {
  audioState = state;
  const playing = state.state === 'playing';
  const active = state.state !== 'idle';
  audioPlayBtn.disabled = !active && !playbackActive;
  audioPlayBtn.textContent = playing ? 'Pause' : active ? 'Resume' : 'Play / Pause';
  audioStopBtn.disabled = !active && !playbackActive;
  if (state.error) {
    setStatus(readStatus, state.error, 'error');
    playbackActive = false;
    audioPlayBtn.disabled = true;
    audioStopBtn.disabled = true;
  } else if (state.state === 'playing') {
    setStatus(readStatus, 'Playing…', 'info');
  } else if (state.state === 'paused') {
    setStatus(readStatus, 'Paused.', 'info');
  } else if (playbackActive) {
    playbackActive = false;
    setStatus(readStatus, 'Done.', 'ok');
  }
}

chrome.runtime.onMessage.addListener((message: unknown) => {
  if (!message || typeof message !== 'object') return;
  const msg = message as { type?: string; data?: AudioState };
  if (msg.type === 'polydub-audio-state-update' && msg.data) applyAudioState(msg.data);
});

async function readSelection(): Promise<void> {
  if (!(await hasApiKey())) {
    setStatus(readStatus, 'Add your API key in Settings first.', 'error');
    switchTab('settings');
    return;
  }
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) throw new Error('No active tab');
    if (!(await ensureContent(tab.id))) throw new Error('Cannot reach page (try a normal web page)');

    const sel = (await chrome.tabs.sendMessage(tab.id, {
      type: 'polydub-get-selection',
    })) as { ok: boolean; data?: { text?: string }; error?: string };
    const text = (sel?.data?.text ?? '').trim();
    if (!text) throw new Error('Select some text on the page first.');

    setStatus(readStatus, 'Reading…');
    const res = (await chrome.runtime.sendMessage({ type: 'polydub-read-aloud', text })) as {
      ok: boolean;
      error?: string;
    };
    if (!res?.ok) throw new Error(res?.error ?? 'Read failed');
    playbackActive = true;
    applyAudioState({ state: 'playing' });
  } catch (err) {
    setStatus(readStatus, err instanceof Error ? err.message : 'Read failed.', 'error');
  }
}

readSelectionBtn.addEventListener('click', () => {
  void readSelection();
});

audioPlayBtn.addEventListener('click', () => {
  const command = audioState.state === 'playing' ? 'pause' : 'play';
  void chrome.runtime.sendMessage({ type: 'polydub-audio-command', command });
});

audioStopBtn.addEventListener('click', () => {
  void chrome.runtime.sendMessage({ type: 'polydub-audio-command', command: 'stop' });
});

dubToggleBtn.addEventListener('click', () => {
  setStatus(dubStatus, 'Live dubbing will be available in Phase 4.');
});

(async () => {
  await refreshKeyState();
  void chrome.runtime.sendMessage({ type: 'polydub-audio-state-get' }).then((res: unknown) => {
    const r = res as { ok?: boolean; data?: AudioState } | null;
    if (r?.ok && r.data) {
      playbackActive = r.data.state !== 'idle';
      applyAudioState(r.data);
    }
  }).catch(() => {});
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) return;
    if (!(await ensureContent(tab.id))) return;
    const res = (await chrome.tabs.sendMessage(tab.id, {
      type: 'polydub-get-state',
    })) as { ok?: boolean; data?: { translated?: boolean } };
    if (res?.ok && res.data) setTranslateButton(res.data.translated === true);
  } catch {
    // page not ready or not injectable — leave default label
  }
})();
