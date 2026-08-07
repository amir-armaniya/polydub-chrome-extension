import { GEMINI_MODELS, extractText, generateContent } from './gemini';

export const TRANSLATE_BATCH = {
  maxItems: 30,
  maxChars: 3000,
} as const;

export interface TranslationInput {
  id: number;
  text: string;
}

export interface TranslationOutput {
  id: number;
  text: string;
}

export type TranslateProgress = (done: number, total: number, batch: TranslationOutput[]) => void;

function chunkInputs(inputs: TranslationInput[]): TranslationInput[][] {
  const batches: TranslationInput[][] = [];
  let current: TranslationInput[] = [];
  let chars = 0;
  for (const item of inputs) {
    const len = item.text.length;
    if (current.length > 0 && (current.length >= TRANSLATE_BATCH.maxItems || chars + len > TRANSLATE_BATCH.maxChars)) {
      batches.push(current);
      current = [];
      chars = 0;
    }
    current.push(item);
    chars += len;
  }
  if (current.length > 0) batches.push(current);
  return batches;
}

function buildPrompt(texts: string[], targetLang: string): string {
  return [
    `Translate the text fragments below into ${targetLang}.`,
    'Rules:',
    '- Keep numbers, URLs, names, code identifiers and HTML entities unchanged.',
    '- Return ONLY a JSON array of translated strings, with the same length and in the same order as the input.',
    `Input (JSON array): ${JSON.stringify(texts)}`,
  ].join('\n');
}

function tryParseTranslations(raw: string, expected: number): string[] | null {
  let text = raw.trim();
  const fence = text.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/);
  if (fence) text = fence[1].trim();
  try {
    const arr: unknown = JSON.parse(text);
    if (Array.isArray(arr) && arr.length === expected && arr.every((v) => typeof v === 'string')) {
      return arr as string[];
    }
  } catch {
    // fall through
  }
  return null;
}

async function translateBatch(apiKey: string, texts: string[], targetLang: string): Promise<string[]> {
  const res = await generateContent(
    apiKey,
    GEMINI_MODELS.text,
    [{ text: buildPrompt(texts, targetLang) }],
    { temperature: 0.2 },
  );
  const raw = extractText(res).trim();
  const parsed = tryParseTranslations(raw, texts.length);
  if (parsed) return parsed;
  return Promise.all(texts.map((t) => translateSingle(apiKey, t, targetLang)));
}

async function translateSingle(apiKey: string, text: string, targetLang: string): Promise<string> {
  const res = await generateContent(apiKey, GEMINI_MODELS.text, [{ text: buildPrompt([text], targetLang) }]);
  const raw = extractText(res).trim();
  const parsed = tryParseTranslations(raw, 1);
  if (parsed) return parsed[0];
  return raw || text;
}

export async function translateItems(
  apiKey: string,
  inputs: TranslationInput[],
  targetLang: string,
  onProgress?: TranslateProgress,
): Promise<TranslationOutput[]> {
  const out = new Map<number, string>();
  let done = 0;
  for (const batch of chunkInputs(inputs)) {
    const translated = await translateBatch(
      apiKey,
      batch.map((b) => b.text),
      targetLang,
    );
    const batchOutputs: TranslationOutput[] = [];
    batch.forEach((item, i) => {
      const t = translated[i];
      const text = t !== undefined && t.trim().length > 0 ? t : item.text;
      out.set(item.id, text);
      batchOutputs.push({ id: item.id, text });
    });
    done += batch.length;
    onProgress?.(done, inputs.length, batchOutputs);
  }
  return inputs.map((i) => ({ id: i.id, text: out.get(i.id) ?? i.text }));
}
