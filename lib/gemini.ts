const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta';

export const GEMINI_MODELS = {
  text: 'gemini-3.1-flash-lite',
  tts: 'gemini-3.1-flash-tts-preview',
  live: 'gemini-3.5-live-translate-preview',
} as const;

export class GeminiError extends Error {
  readonly status: number;
  constructor(message: string, status = 0) {
    super(message);
    this.name = 'GeminiError';
    this.status = status;
  }
}

function assertKey(apiKey: string): void {
  if (!apiKey.trim()) throw new GeminiError('Missing Gemini API key');
}

async function request(path: string, apiKey: string, init: RequestInit = {}): Promise<Response> {
  assertKey(apiKey);
  const res = await fetch(`${GEMINI_BASE}${path}?key=${encodeURIComponent(apiKey.trim())}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...init.headers,
    },
  });
  return res;
}

async function parseError(res: Response): Promise<string> {
  try {
    const body = (await res.json()) as { error?: { message?: string } };
    return body.error?.message ?? `HTTP ${res.status}`;
  } catch {
    return `HTTP ${res.status}`;
  }
}

export async function validateApiKey(apiKey: string): Promise<boolean> {
  const res = await request('/models', apiKey);
  if (!res.ok) {
    const msg = await parseError(res);
    throw new GeminiError(msg, res.status);
  }
  return true;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function fetchWithRetry(
  path: string,
  apiKey: string,
  init: RequestInit,
  maxRetries = 3,
): Promise<Response> {
  let delay = 1000;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const res = await request(path, apiKey, init);
    if (res.ok || res.status < 500) return res;
    if (attempt < maxRetries) {
      console.warn('[polydub] fetchWithRetry', path, 'attempt', attempt, 'status', res.status);
      await sleep(delay);
      delay *= 2;
    }
  }
  const res = await request(path, apiKey, init);
  console.warn('[polydub] fetchWithRetry', path, 'final failure, status', res.status);
  const msg = await parseError(res);
  throw new GeminiError(msg, res.status);
}

export interface GenerateContentPart {
  text?: string;
  inlineData?: { data: string; mimeType: string };
}

export interface GenerateContentResponse {
  candidates?: Array<{
    content?: { parts?: GenerateContentPart[] };
    finishReason?: string;
  }>;
  error?: { message?: string };
}

export async function generateContent(
  apiKey: string,
  model: string,
  parts: GenerateContentPart[],
  generationConfig?: Record<string, unknown>,
): Promise<GenerateContentResponse> {
  const start = Date.now();
  const res = await fetchWithRetry(`/models/${model}:generateContent`, apiKey, {
    method: 'POST',
    body: JSON.stringify({
      contents: [{ role: 'user', parts }],
      generationConfig,
    }),
  });
  console.info('[polydub] generateContent', model, 'status', res.status, 'in', Date.now() - start, 'ms');
  const body = (await res.json()) as GenerateContentResponse;
  if (body.error?.message) {
    console.warn('[polydub] generateContent', model, 'error body:', body.error.message);
    throw new GeminiError(body.error.message, res.status);
  }
  if (!res.ok) throw new GeminiError(await parseError(res), res.status);
  return body;
}

export function extractText(response: GenerateContentResponse): string {
  const parts = response.candidates?.[0]?.content?.parts ?? [];
  return parts
    .filter((p): p is GenerateContentPart & { text: string } => p.text !== undefined)
    .map((p) => p.text)
    .join('');
}
