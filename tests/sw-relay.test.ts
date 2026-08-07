import { describe, expect, it, vi } from 'vitest';

const swListeners: Array<(msg: unknown, sender: unknown, sendResponse: (r?: unknown) => void) => boolean> = [];
const sendMessageMock = vi.fn();
let loopDetected = false;
let dispatchDepth = 0;

function installChromeMock(): void {
  loopDetected = false;
  dispatchDepth = 0;
  sendMessageMock.mockReset();
  (globalThis as Record<string, unknown>).chrome = {
    runtime: {
      onInstalled: { addListener: vi.fn() },
      onMessage: {
        addListener: (fn: (msg: unknown, sender: unknown, sendResponse: (r?: unknown) => void) => boolean) =>
          swListeners.push(fn),
      },
      sendMessage: (msg: unknown): Promise<unknown> => {
        sendMessageMock(msg);
        dispatchDepth += 1;
        if (dispatchDepth > 100) {
          loopDetected = true;
          return Promise.resolve(undefined);
        }
        return new Promise((resolve) => {
          for (const l of [...swListeners]) {
            l(msg, {}, resolve as (r?: unknown) => void);
          }
        });
      },
    },
    contextMenus: { create: vi.fn(), onClicked: { addListener: vi.fn() } },
    offscreen: { hasDocument: vi.fn(async () => false), createDocument: vi.fn(async () => {}) },
    scripting: { executeScript: vi.fn() },
    tabs: { sendMessage: vi.fn() },
    storage: {
      local: {
        async get() {
          return { settings: { apiKey: 'test-key' } };
        },
        async set() {},
      },
    },
  } as unknown as typeof chrome;
}

function offscreenListener(msg: unknown, _sender: unknown, sendResponse: (r?: unknown) => void): boolean {
  const m = msg as { type?: string };
  if (m.type === 'polydub-audio-command' || m.type === 'polydub-audio-state-get') {
    sendResponse({ ok: true, data: { state: 'idle' } });
    return true;
  }
  return false;
}

function popupSend(msg: unknown): Promise<unknown> {
  let response: unknown;
  for (const l of [...swListeners]) {
    l(msg, { id: 'popup' }, (r?: unknown) => {
      response = r;
    });
  }
  return Promise.resolve(response);
}

describe('service worker message relay', () => {
  it('must not re-broadcast audio messages it receives (no self-loop)', async () => {
    installChromeMock();
    await import('../src/background/service-worker');
    swListeners.push(offscreenListener);

    const res = await popupSend({ type: 'polydub-audio-command', command: 'play' });
    expect(loopDetected).toBe(false);
    expect(sendMessageMock).not.toHaveBeenCalled();
    expect(res).toEqual({ ok: true, data: { state: 'idle' } });
  });

  it('must not re-broadcast state-get messages it receives', async () => {
    installChromeMock();
    await import('../src/background/service-worker');
    swListeners.push(offscreenListener);

    const res = await popupSend({ type: 'polydub-audio-state-get' });
    expect(loopDetected).toBe(false);
    expect(sendMessageMock).not.toHaveBeenCalled();
    expect(res).toEqual({ ok: true, data: { state: 'idle' } });
  });
});
