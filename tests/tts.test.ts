import { describe, expect, it, vi, afterEach } from 'vitest';
import { GeminiError } from '../lib/gemini';
import { pcmBase64ToWavDataUrl, splitIntoSentences, synthesizeSpeech } from '../lib/tts';

function mockFetchOnce(status: number, body: unknown) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch,
  );
}

function lastRequestBody(): { generationConfig?: Record<string, unknown> } {
  const fn = vi.mocked(globalThis.fetch);
  const init = fn.mock.calls[fn.mock.calls.length - 1]?.[1] as { body?: string };
  return JSON.parse(init?.body ?? '{}') as { generationConfig?: Record<string, unknown> };
}

const AUDIO_RESPONSE = {
  candidates: [
    {
      content: {
        parts: [{ inlineData: { data: 'QUJDRA==', mimeType: 'audio/l16; rate=24000; channels=1' } }],
      },
    },
  ],
};

describe('synthesizeSpeech', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('requests AUDIO modality with the configured voice', async () => {
    mockFetchOnce(200, AUDIO_RESPONSE);
    const audio = await synthesizeSpeech('AIza-key', 'سلام دنیا', 'Kore');
    expect(audio.base64).toBe('QUJDRA==');
    expect(audio.sampleRate).toBe(24000);
    expect(audio.mimeType).toContain('audio/l16');

    const fn = vi.mocked(globalThis.fetch);
    const url = fn.mock.calls[0]?.[0] as string;
    expect(url).toContain('/v1beta/models/gemini-3.1-flash-tts-preview:generateContent');
    const cfg = lastRequestBody().generationConfig;
    expect(cfg?.responseModalities).toEqual(['AUDIO']);
    const voice = cfg?.speechConfig as {
      voiceConfig?: { prebuiltVoiceConfig?: { voiceName?: string } };
    };
    expect(voice.voiceConfig?.prebuiltVoiceConfig?.voiceName).toBe('Kore');
  });

  it('throws for empty text without calling the network', async () => {
    const spy = vi.fn(async () => new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', spy as unknown as typeof fetch);
    await expect(synthesizeSpeech('AIza-key', '   ', 'Kore')).rejects.toThrow('Nothing to read');
    expect(spy).not.toHaveBeenCalled();
  });

  it('throws when the response contains no audio part', async () => {
    mockFetchOnce(200, { candidates: [{ content: { parts: [{ text: 'hi' }] } }] });
    await expect(synthesizeSpeech('AIza-key', 'hello', 'Kore')).rejects.toThrow('TTS returned no audio');
  });

  it('propagates API errors', async () => {
    mockFetchOnce(429, { error: { message: 'Quota exceeded' } });
    await expect(synthesizeSpeech('AIza-key', 'hello', 'Kore')).rejects.toThrow(GeminiError);
    await expect(synthesizeSpeech('AIza-key', 'hello', 'Kore')).rejects.toThrow('Quota exceeded');
  });
});

describe('pcmBase64ToWavDataUrl', () => {
  function decode(dataUrl: string): Uint8Array {
    const b64 = dataUrl.slice('data:audio/wav;base64,'.length);
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return bytes;
  }

  it('wraps PCM bytes in a valid 24kHz mono 16-bit WAV', () => {
    const pcm = 'QUJDRA=='; // 4 bytes
    const dataUrl = pcmBase64ToWavDataUrl(pcm, 24000);
    expect(dataUrl.startsWith('data:audio/wav;base64,')).toBe(true);

    const bytes = decode(dataUrl);
    expect(bytes.length).toBe(44 + 4);
    const ascii = (offset: number, len: number) =>
      String.fromCharCode(...Array.from(bytes.slice(offset, offset + len)));
    expect(ascii(0, 4)).toBe('RIFF');
    expect(ascii(8, 4)).toBe('WAVE');
    expect(ascii(12, 4)).toBe('fmt ');
    expect(ascii(36, 4)).toBe('data');

    const dv = new DataView(bytes.buffer);
    expect(dv.getUint32(4, true)).toBe(36 + 4);
    expect(dv.getUint16(20, true)).toBe(1); // PCM
    expect(dv.getUint16(22, true)).toBe(1); // mono
    expect(dv.getUint32(24, true)).toBe(24000);
    expect(dv.getUint32(28, true)).toBe(24000 * 2);
    expect(dv.getUint16(32, true)).toBe(2);
    expect(dv.getUint16(34, true)).toBe(16);
    expect(dv.getUint32(40, true)).toBe(4);
    expect(Array.from(bytes.slice(44))).toEqual([0x41, 0x42, 0x43, 0x44]);
  });

  it('honors a custom sample rate', () => {
    const bytes = decode(pcmBase64ToWavDataUrl('AAAA', 44100));
    const dv = new DataView(bytes.buffer);
    expect(dv.getUint32(24, true)).toBe(44100);
  });

  it('converts a large PCM payload (10+ seconds) without stack overflow', () => {
    const pcm = new Uint8Array(480000);
    for (let i = 0; i < pcm.length; i++) pcm[i] = i & 0xff;
    let b64 = '';
    const chunk = 0x3000;
    for (let i = 0; i < pcm.length; i += chunk) {
      b64 += btoa(String.fromCharCode(...pcm.subarray(i, i + chunk)));
    }
    const dataUrl = pcmBase64ToWavDataUrl(b64, 24000);
    expect(dataUrl.startsWith('data:audio/wav;base64,')).toBe(true);
    const bytes = decode(dataUrl);
    expect(bytes.length).toBe(44 + pcm.length);
    for (let i = 0; i < pcm.length; i += 997) {
      expect(bytes[44 + i]).toBe(pcm[i]);
    }
  });
});

describe('splitIntoSentences', () => {
  it('splits English text on sentence-ending punctuation', () => {
    expect(splitIntoSentences('Hello world. This is a test! Really?')).toEqual([
      'Hello world.',
      'This is a test!',
      'Really?',
    ]);
  });

  it('splits Persian text on Persian punctuation', () => {
    expect(splitIntoSentences('سلام دنیا. این یک تست است! واقعا؟')).toEqual([
      'سلام دنیا.',
      'این یک تست است!',
      'واقعا؟',
    ]);
  });

  it('keeps consecutive delimiters with their sentence', () => {
    expect(splitIntoSentences('Wow!! Really??')).toEqual(['Wow!!', 'Really??']);
  });

  it('splits on newlines', () => {
    expect(splitIntoSentences('خط اول.\nخط دوم.')).toEqual(['خط اول.', 'خط دوم.']);
  });

  it('returns an empty array for empty or whitespace-only text', () => {
    expect(splitIntoSentences('')).toEqual([]);
    expect(splitIntoSentences('   \n  ')).toEqual([]);
  });

  it('keeps trailing text without punctuation as a final sentence', () => {
    expect(splitIntoSentences('یک جمله. جمله ناتمام')).toEqual(['یک جمله.', 'جمله ناتمام']);
  });
});
