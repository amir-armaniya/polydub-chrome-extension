import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../lib/tts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/tts')>();
  return {
    ...actual,
    synthesizeSpeech: vi.fn(async () => {
      throw new Error('mock synthesis failure');
    }),
  };
});

const sendMessageMock = vi.fn();
const tabsSendMessageMock = vi.fn();
const onClickedListeners: Array<(info: unknown, tab: unknown) => void> = [];

function installChromeMock(): void {
  sendMessageMock.mockReset();
  sendMessageMock.mockImplementation(async () => ({ ok: true }));
  tabsSendMessageMock.mockReset();
  tabsSendMessageMock.mockImplementation(async () => ({ ok: true }));
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
    offscreen: { hasDocument: vi.fn(async () => true), createDocument: vi.fn(async () => {}) },
    tabs: { sendMessage: tabsSendMessageMock },
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

const FAILING_TEXT = 'یک. دو. سه. چهار. پنج. شش.';

describe('readAloud error feedback', () => {
  beforeEach(() => {
    vi.resetModules();
    installChromeMock();
  });

  it('returns ok:false with the friendly message after 5 consecutive synthesis errors', async () => {
    const { readAloud } = await import('../src/background/service-worker');
    const res = await readAloud(FAILING_TEXT);
    expect(res.ok).toBe(false);
    expect(res.error).toBe('TTS failed — check your key and proxy.');
  });

  it('surfaces the read failure to the page when triggered from the context menu', async () => {
    await import('../src/background/service-worker');
    onClickedListeners[0](
      { menuItemId: 'polydub-read-selection', selectionText: FAILING_TEXT },
      { id: 7 },
    );
    await vi.waitFor(() => {
      expect(tabsSendMessageMock).toHaveBeenCalled();
    });
    const [, payload] = tabsSendMessageMock.mock.calls[0] as [
      number,
      { type: string; error: string },
    ];
    expect(payload.type).toBe('polydub-read-error');
    expect(payload.error).toBe('TTS failed — check your key and proxy.');
  });
});
