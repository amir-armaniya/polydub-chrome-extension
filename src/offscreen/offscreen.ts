export {};

export interface AudioState {
  state: 'idle' | 'playing' | 'paused';
  position?: number;
  duration?: number;
  error?: string;
}

let audio: HTMLAudioElement | null = null;
let currentDataUrl: string | null = null;
let currentState: AudioState = { state: 'idle' };

function report(state: AudioState): void {
  currentState = state;
  void chrome.runtime.sendMessage({ type: 'polydub-audio-state-update', data: state }).catch(() => {});
}

function playDataUrl(dataUrl: string): void {
  if (!audio) {
    audio = new Audio();
    audio.addEventListener('play', () =>
      report({ state: 'playing', position: audio?.currentTime, duration: audio?.duration }),
    );
    audio.addEventListener('pause', () => {
      if (audio && !audio.ended && audio.currentTime > 0 && audio.src) {
        report({ state: 'paused', position: audio.currentTime, duration: audio.duration });
      }
    });
    audio.addEventListener('ended', () => {
      audio?.remove();
      audio = null;
      currentDataUrl = null;
      report({ state: 'idle' });
    });
    audio.addEventListener('error', () => report({ state: 'idle', error: 'Audio playback failed' }));
  }
  if (dataUrl === currentDataUrl) {
    if (audio.paused) void audio.play();
    return;
  }
  audio.src = dataUrl;
  currentDataUrl = dataUrl;
  void audio.play();
}

function handleCommand(command: string): AudioState {
  switch (command) {
    case 'play':
      if (audio && currentDataUrl) void audio.play();
      break;
    case 'pause':
      audio?.pause();
      break;
    case 'stop': {
      if (audio) {
        audio.pause();
        audio.currentTime = 0;
        audio.src = '';
        audio.remove();
      }
      audio = null;
      currentDataUrl = null;
      report({ state: 'idle' });
      break;
    }
  }
  return { ...currentState, position: audio?.currentTime };
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
    playDataUrl(dataUrl);
    sendResponse({ ok: true, data: currentState });
    return true;
  }

  if (msg.type === 'polydub-audio-command') {
    const command = typeof msg.command === 'string' ? msg.command : '';
    sendResponse({ ok: true, data: handleCommand(command) });
    return true;
  }

  if (msg.type === 'polydub-audio-state-get') {
    sendResponse({ ok: true, data: { ...currentState, position: audio?.currentTime } });
    return true;
  }

  return false;
});
