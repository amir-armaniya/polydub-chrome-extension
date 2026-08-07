export {};

chrome.runtime.onMessage.addListener((message: unknown, _sender, sendResponse) => {
  if (!message || typeof message !== 'object') return false;
  const msg = message as { type?: string; [k: string]: unknown };

  if (msg.type === 'polydub-translate-page') {
    sendResponse({ ok: false, error: 'Page translation will be available in Phase 1.' });
    return true;
  }

  if (msg.type === 'polydub-read-selection') {
    sendResponse({ ok: false, error: 'Read aloud will be available in Phase 2.' });
    return true;
  }

  return false;
});
