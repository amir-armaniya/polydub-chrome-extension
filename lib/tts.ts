import { GEMINI_MODELS, GeminiError, generateContent, type GenerateContentResponse } from './gemini';

export interface TtsAudio {
  base64: string;
  mimeType: string;
  sampleRate: number;
}

export async function synthesizeSpeech(apiKey: string, text: string, voice: string): Promise<TtsAudio> {
  const trimmed = text.trim();
  if (!trimmed) throw new GeminiError('Nothing to read');
  const res: GenerateContentResponse = await generateContent(
    apiKey,
    GEMINI_MODELS.tts,
    [
      {
        text: [
          'Generate speech audio only. Read the transcript below aloud exactly as written.',
          '',
          'TRANSCRIPT:',
          trimmed,
        ].join('\n'),
      },
    ],
    {
      responseModalities: ['AUDIO'],
      speechConfig: {
        voiceConfig: {
          prebuiltVoiceConfig: { voiceName: voice },
        },
      },
    },
  );
  const part = res.candidates?.[0]?.content?.parts?.find((p) => p.inlineData !== undefined);
  if (!part?.inlineData?.data) throw new GeminiError('TTS returned no audio');
  const rate = parseInt(part.inlineData.mimeType.match(/rate=(\d+)/)?.[1] ?? '24000', 10);
  return {
    base64: part.inlineData.data,
    mimeType: part.inlineData.mimeType,
    sampleRate: rate,
  };
}

export function pcmBase64ToWavDataUrl(pcmBase64: string, sampleRate = 24000): string {
  const binary = atob(pcmBase64);
  const pcm = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) pcm[i] = binary.charCodeAt(i);

  const dataLen = pcm.length;
  const channels = 1;
  const bitsPerSample = 16;
  const blockAlign = (channels * bitsPerSample) / 8;
  const byteRate = sampleRate * blockAlign;
  const headerLen = 44;
  const wav = new Uint8Array(headerLen + dataLen);

  const dv = new DataView(wav.buffer);
  const writeStr = (offset: number, s: string): void => {
    for (let i = 0; i < s.length; i++) wav[offset + i] = s.charCodeAt(i);
  };

  writeStr(0, 'RIFF');
  dv.setUint32(4, 36 + dataLen, true);
  writeStr(8, 'WAVE');
  writeStr(12, 'fmt ');
  dv.setUint32(16, 16, true);
  dv.setUint16(20, 1, true);
  dv.setUint16(22, channels, true);
  dv.setUint32(24, sampleRate, true);
  dv.setUint32(28, byteRate, true);
  dv.setUint16(32, blockAlign, true);
  dv.setUint16(34, bitsPerSample, true);
  writeStr(36, 'data');
  dv.setUint32(40, dataLen, true);
  wav.set(pcm, headerLen);

  let ascii = '';
  const chunk = 0x8000;
  for (let i = 0; i < wav.length; i += chunk) {
    ascii += String.fromCharCode(...wav.subarray(i, i + chunk));
  }
  const base64 = btoa(ascii);
  return `data:audio/wav;base64,${base64}`;
}

const SENTENCE_END = /[.!?؛؟\n]/;

export function splitIntoSentences(text: string): string[] {
  const sentences: string[] = [];
  let current = '';
  let i = 0;
  while (i < text.length) {
    current += text[i];
    if (SENTENCE_END.test(text[i])) {
      while (i + 1 < text.length && SENTENCE_END.test(text[i + 1])) {
        current += text[i + 1];
        i += 1;
      }
      if (current.trim()) sentences.push(current.trim());
      current = '';
    }
    i += 1;
  }
  if (current.trim()) sentences.push(current.trim());
  return sentences;
}
