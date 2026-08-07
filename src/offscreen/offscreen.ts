export {};

chrome.runtime.onMessage.addListener((message: unknown, _sender, sendResponse) => {
  if (!message || typeof message !== 'object') return false;
  const msg = message as { type?: string };
  if (msg.type === 'polydub-offscreen-ping') {
    sendResponse({ ok: true, data: { phase: 'offscreen-ready' } });
    return true;
  }
  return false;
});
