import { describe, expect, it, vi, afterEach } from 'vitest';
import { GeminiError, validateApiKey } from '../lib/gemini';

function mockFetchOnce(status: number, body: unknown) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch,
  );
}

describe('validateApiKey', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns true for a valid key', async () => {
    mockFetchOnce(200, { models: [] });
    await expect(validateApiKey('AIza-valid')).resolves.toBe(true);
  });

  it('throws GeminiError for invalid key', async () => {
    mockFetchOnce(400, { error: { message: 'API key not valid.' } });
    await expect(validateApiKey('AIza-bad')).rejects.toThrow(GeminiError);
    await expect(validateApiKey('AIza-bad')).rejects.toThrow('API key not valid');
  });

  it('throws for empty key without calling the network', async () => {
    const spy = vi.fn(async () => new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', spy as unknown as typeof fetch);
    await expect(validateApiKey('')).rejects.toThrow('Missing Gemini API key');
    expect(spy).not.toHaveBeenCalled();
  });
});
