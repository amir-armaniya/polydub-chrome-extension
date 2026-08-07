import { describe, it, expect, vi, afterEach } from 'vitest';
import { translateItems, TRANSLATE_BATCH } from '../lib/translate';

type FetchImpl = (url: string, init: RequestInit) => Partial<Response> | Promise<Partial<Response>>;

function mockFetch(impl: FetchImpl): void {
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string, init: RequestInit) => Promise.resolve(impl(url, init) as Response)),
  );
}

function okResponse(text: string): Partial<Response> {
  return {
    ok: true,
    status: 200,
    json: async () => ({
      candidates: [{ content: { parts: [{ text }] } }],
    }),
  };
}

function readPromptTexts(init?: RequestInit): string[] {
  const body = JSON.parse(String(init?.body)) as { contents: Array<{ parts: Array<{ text: string }> }> };
  const prompt = body.contents[0].parts[0].text;
  const match = prompt.match(/Input \(JSON array\): (\[.*\])$/s);
  if (!match) throw new Error(`prompt missing input array: ${prompt.slice(0, 80)}`);
  return JSON.parse(match[1]) as string[];
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('translateItems', () => {
  it('translates a batch and returns outputs in order', async () => {
    mockFetch((_url, init) => {
      const texts = readPromptTexts(init);
      return okResponse(JSON.stringify(texts.map((t) => `T:${t}`)));
    });

    const out = await translateItems('key', [
      { id: 0, text: 'Hello' },
      { id: 1, text: 'World' },
    ], 'fa');

    expect(out).toEqual([
      { id: 0, text: 'T:Hello' },
      { id: 1, text: 'T:World' },
    ]);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('parses a fenced JSON response', async () => {
    mockFetch((_url, init) => {
      const texts = readPromptTexts(init);
      return okResponse('```json\n' + JSON.stringify(texts.map((t) => `F:${t}`)) + '\n```');
    });

    const out = await translateItems('key', [{ id: 0, text: 'Hi' }], 'fa');
    expect(out).toEqual([{ id: 0, text: 'F:Hi' }]);
  });

  it('falls back to per-item translation when batch JSON is invalid', async () => {
    let call = 0;
    mockFetch((_url, init) => {
      call++;
      const texts = readPromptTexts(init);
      if (call === 1) return okResponse('not json at all');
      return okResponse(JSON.stringify(texts.map((t) => `S:${t}`)));
    });

    const out = await translateItems('key', [{ id: 0, text: 'A' }, { id: 1, text: 'B' }], 'fa');
    expect(out).toEqual([
      { id: 0, text: 'S:A' },
      { id: 1, text: 'S:B' },
    ]);
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  it('chunks inputs into batches by item count', async () => {
    const calls: number[] = [];
    mockFetch((_url, init) => {
      const texts = readPromptTexts(init);
      calls.push(texts.length);
      return okResponse(JSON.stringify(texts.map((t) => `T:${t}`)));
    });

    const inputs = Array.from({ length: TRANSLATE_BATCH.maxItems * 2 + 5 }, (_, i) => ({ id: i, text: `item ${i}` }));
    const out = await translateItems('key', inputs, 'fa');

    expect(calls).toEqual([TRANSLATE_BATCH.maxItems, TRANSLATE_BATCH.maxItems, 5]);
    expect(out).toHaveLength(inputs.length);
    expect(out[0]).toEqual({ id: 0, text: 'T:item 0' });
    expect(out[out.length - 1]).toEqual({ id: inputs.length - 1, text: 'T:item 64' });
  });

  it('chunks by character count', async () => {
    const calls: number[] = [];
    mockFetch((_url, init) => {
      const texts = readPromptTexts(init);
      calls.push(texts.length);
      return okResponse(JSON.stringify(texts.map((t) => `T:${t}`)));
    });

    const long = 'x'.repeat(2000);
    const inputs = [
      { id: 0, text: long },
      { id: 1, text: long },
      { id: 2, text: 'short' },
    ];
    const out = await translateItems('key', inputs, 'fa');

    expect(calls).toEqual([1, 2]);
    expect(out).toHaveLength(3);
  });

  it('keeps the original text when translation is empty', async () => {
    mockFetch((_url, init) => {
      const texts = readPromptTexts(init);
      return okResponse(JSON.stringify(texts.map(() => '')));
    });

    const out = await translateItems('key', [{ id: 0, text: 'Keep me' }], 'fa');
    expect(out).toEqual([{ id: 0, text: 'Keep me' }]);
  });

  it('propagates API errors', async () => {
    mockFetch(() => ({
      ok: false,
      status: 429,
      json: async () => ({ error: { message: 'rate limited' } }),
    }));

    await expect(translateItems('key', [{ id: 0, text: 'Hi' }], 'fa')).rejects.toThrow(/rate limited/);
  });

  it('reports progress once per batch with cumulative counts and batch outputs', async () => {
    const calls: Array<{ done: number; total: number; batch: number[] }> = [];
    mockFetch((_url, init) => {
      const texts = readPromptTexts(init);
      return okResponse(JSON.stringify(texts.map((t) => `T:${t}`)));
    });

    const inputs = Array.from({ length: TRANSLATE_BATCH.maxItems * 2 + 5 }, (_, i) => ({ id: i, text: `item ${i}` }));
    const out = await translateItems('key', inputs, 'fa', (done, total, batch) => {
      calls.push({ done, total, batch: batch.map((b) => b.id) });
    });

    expect(calls.map((c) => [c.done, c.total])).toEqual([
      [TRANSLATE_BATCH.maxItems, inputs.length],
      [TRANSLATE_BATCH.maxItems * 2, inputs.length],
      [inputs.length, inputs.length],
    ]);
    expect(calls[0].batch).toEqual(Array.from({ length: TRANSLATE_BATCH.maxItems }, (_, i) => i));
    expect(calls[calls.length - 1].batch).toEqual([
      TRANSLATE_BATCH.maxItems * 2,
      TRANSLATE_BATCH.maxItems * 2 + 1,
      TRANSLATE_BATCH.maxItems * 2 + 2,
      TRANSLATE_BATCH.maxItems * 2 + 3,
      TRANSLATE_BATCH.maxItems * 2 + 4,
    ]);
    expect(out).toHaveLength(inputs.length);
  });
});
