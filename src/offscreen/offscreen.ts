export {};

import { PlayQueue } from '../../lib/play-queue';

export interface AudioState {
  state: 'idle' | 'playing' | 'paused';
  position?: number;
  duration?: number;
  index?: number;
  total?: number;
  error?: string;
}

const queue = new PlayQueue();
let audio: HTMLAudioElement | null = null;
let lastError: string | undefined;

function snapshotState(): AudioState {
  const s = queue.snapshot;
  return {
    state: s.state,
    index: s.index >= 0 ? s.index : undefined,
    total: s.total > 0 ? s.total : undefined,
    position: audio?.currentTime,
    duration: audio?.duration,
    error: lastError,
  };
}

function report(): void {
  void chrome.runtime.sendMessage({ type: 'polydub-audio-state-update', data: snapshotState() }).catch(() => {});
}

function ensureAudio(): HTMLAudioElement {
  if (audio) return audio;
  audio = new Audio();
  audio.addEventListener('ended', () => {
    queue.onEnded();
    const next = queue.currentClip;
    if (audio && next) {
      audio.src = next;
      void audio.play().catch(() => {});
    }
    report();
  });
  audio.addEventListener('pause', () => {
    if (queue.snapshot.state === 'playing') queue.pause();
    report();
  });
  audio.addEventListener('error', () => {
    lastError = 'Audio playback failed';
    report();
  });
  return audio;
}

function play(): void {
  const el = ensureAudio();
  queue.play();
  const clip = queue.currentClip;
  if (!clip) return;
  if (el.src !== clip) {
    el.src = clip;
    lastError = undefined;
  }
  void el.play().catch(() => {});
}

function pause(): void {
  queue.pause();
  audio?.pause();
}

function stop(): void {
  queue.stop();
  audio?.pause();
}

function clearQueue(): void {
  queue.clear();
  if (audio) {
    audio.pause();
    audio.removeAttribute('src');
    audio.load();
  }
  lastError = undefined;
}

function handleCommand(command: string): AudioState {
  switch (command) {
    case 'play':
      play();
      break;
    case 'pause':
      pause();
      break;
    case 'stop':
      stop();
      break;
    case 'clear-queue':
      clearQueue();
      break;
  }
  return snapshotState();
}

chrome.runtime.onMessage.addListener((message: unknown, _sender, sendResponse) => {
  if (!message || typeof message !== 'object') return false;
  const msg = message as { type?: string; [k: string]: unknown };

  if (msg.type === 'polydub-offscreen-ping') {
    sendResponse({ ok: true, data: { phase: 'offscreen-ready' } });
    return true;
  }

  if (msg.type === 'polydub-play-audio') {
    const dataUrl = typeof msg.dataUrl === 'string' ? msg.dataUrl : '';
    if (!dataUrl) {
      sendResponse({ ok: false, error: 'No audio data' });
      return true;
    }
    queue.enqueue(dataUrl);
    play();
    sendResponse({ ok: true, data: snapshotState() });
    return true;
  }

  if (msg.type === 'polydub-audio-command') {
    const command = typeof msg.command === 'string' ? msg.command : '';
    sendResponse({ ok: true, data: handleCommand(command) });
    return true;
  }

  if (msg.type === 'polydub-audio-state-get') {
    sendResponse({ ok: true, data: snapshotState() });
    return true;
  }

  return false;
});
