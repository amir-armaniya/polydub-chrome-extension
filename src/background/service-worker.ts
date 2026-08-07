import { validateApiKey } from '../../lib/gemini';

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: 'polydub-read-selection',
    title: 'Read aloud with PolyDub',
    contexts: ['selection'],
  });
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === 'polydub-read-selection' && info.selectionText && tab?.id != null) {
    void chrome.tabs.sendMessage(tab.id, {
      type: 'polydub-read-selection',
      text: info.selectionText,
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

  return false;
});
