import { beforeEach, describe, expect, it, vi } from 'vitest';

const sendMessageMock = vi.fn();
const tabsSendMessageMock = vi.fn();
const tabsQueryMock = vi.fn();
const executeScriptMock = vi.fn();
const onClickedListeners: Array<(info: unknown, tab: unknown) => void> = [];

interface SentMessage {
  type: string;
  [k: string]: unknown;
}

function installChromeMock(): void {
  sendMessageMock.mockReset();
  sendMessageMock.mockImplementation(async () => ({ ok: true }));
  tabsSendMessageMock.mockReset();
  tabsSendMessageMock.mockImplementation(async (_tabId: number, msg: SentMessage) => {
    if (msg.type === 'polydub-get-state') {
      return { ok: true, data: { translated: false, busy: false } };
    }
    return { ok: true, data: { count: 42 } };
  });
  tabsQueryMock.mockReset();
  tabsQueryMock.mockImplementation(async () => [{ id: 5 }]);
  executeScriptMock.mockReset();
  executeScriptMock.mockImplementation(async () => {});
  onClickedListeners.length = 0;
  (globalThis as Record<string, unknown>).chrome = {
    runtime: {
      onInstalled: { addListener: vi.fn() },
      onMessage: { addListener: vi.fn() },
      sendMessage: sendMessageMock,
    },
    contextMenus: {
      create: vi.fn(),
      onClicked: {
        addListener: (fn: (info: unknown, tab: unknown) => void) => onClickedListeners.push(fn),
      },
    },
    scripting: { executeScript: executeScriptMock },
    tabs: { query: tabsQueryMock, sendMessage: tabsSendMessageMock },
    storage: {
      local: {
        async get() {
          return {
            api_key: 'test-key',
            target_lang: 'fa',
            tts_voice: 'Kore',
            tts_style: 'formal',
            caption_overlay: true,
            monitor_volume: 0.4,
          };
        },
        async set() {},
      },
    },
  } as unknown as typeof chrome;
}

function invokeTranslateMenu(): void {
  onClickedListeners[0]({ menuItemId: 'polydub-translate-page' }, { id: 5 });
}

function sentCalls(): Array<[number, SentMessage]> {
  return tabsSendMessageMock.mock.calls as Array<[number, SentMessage]>;
}

describe('context menu translate page', () => {
  beforeEach(() => {
    vi.resetModules();
    installChromeMock();
  });

  it('sends polydub-translate-page to the active tab when the page is not translated', async () => {
    await import('../src/background/service-worker');
    invokeTranslateMenu();

    await vi.waitFor(() => {
      expect(sentCalls().some(([, msg]) => msg.type === 'polydub-translate-page')).toBe(true);
    });

    const calls = sentCalls();
    expect(calls[0][1].type).toBe('polydub-get-state');
    expect(calls[0][0]).toBe(5);
    expect(calls.some(([tabId, msg]) => tabId === 5 && msg.type === 'polydub-translate-page')).toBe(true);

    const done = calls.find(([, msg]) => msg.type === 'polydub-translate-done');
    expect(done?.[1].translated).toBe(true);
    expect(done?.[1].count).toBe(42);
    expect(executeScriptMock).not.toHaveBeenCalled();
  });

  it('sends polydub-revert-page to the active tab when the page is already translated', async () => {
    tabsSendMessageMock.mockImplementation(async (_tabId: number, msg: SentMessage) => {
      if (msg.type === 'polydub-get-state') {
        return { ok: true, data: { translated: true, busy: false } };
      }
      return { ok: true, data: { count: 42 } };
    });
    await import('../src/background/service-worker');
    invokeTranslateMenu();

    await vi.waitFor(() => {
      expect(sentCalls().some(([, msg]) => msg.type === 'polydub-revert-page')).toBe(true);
    });

    const calls = sentCalls();
    expect(calls[0][1].type).toBe('polydub-get-state');
    expect(calls.some(([tabId, msg]) => tabId === 5 && msg.type === 'polydub-revert-page')).toBe(true);
    expect(calls.some(([, msg]) => msg.type === 'polydub-translate-page')).toBe(false);
    expect(executeScriptMock).not.toHaveBeenCalled();
  });
});
