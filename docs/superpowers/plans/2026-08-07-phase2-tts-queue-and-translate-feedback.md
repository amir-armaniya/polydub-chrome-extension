# Phase 2 Completion — TTS Playback Queue & Translation Feedback — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete Phase 2 per the approved spec: sentence-by-sentence TTS playback with a play queue (Stop keeps queue, Clear empties it), ~2–3s first-audio start, and translation progress feedback (on-page toast + live popup state).

**Architecture:** A pure `PlayQueue` state machine (DOM-free, unit-testable) drives the offscreen audio element. The service worker splits text into sentences and pipelined-synthesizes them, pushing each clip to the offscreen queue as it becomes ready. `translateItems` gains an `onProgress` callback; the content script applies batches progressively and shows a minimal «در حال ترجمه…» toast while setting a `busy` flag the popup mirrors.

**Tech Stack:** TypeScript, Chrome Extension MV3 (service worker + offscreen + content script + popup), Vitest. No new dependencies.

## Global Constraints

- Project rule: every phase needs unit tests (`npm test`), typecheck (`npm run typecheck`), build (`npm run build`), AND a real test (real Chrome, CDP port 9257, profile `/tmp/opencode/ui-test`, proxy `127.0.0.1:10808`, check `chrome://extensions/?errors=…`). After each build the extension must be manually refreshed in `chrome://extensions`.
- Performance budget (PRD §2.4): first audio ≤ 3s; no gaps between sentences; queue ≤ 50 clips in memory; SW wake < 500ms.
- TTS model `gemini-3.1-flash-tts-preview`, voice `Kore` (existing). No audio is ever persisted to storage.
- UI copy stays English in the popup, except the page toast text which is Persian: «در حال ترجمه…».
- Do NOT commit the user's API key (it lives only in `chrome.storage.local` of the test profile).

---

### Task 1: `splitIntoSentences` — sentence splitting

**Files:**
- Modify: `lib/tts.ts` (append function)
- Test: `tests/tts.test.ts` (append describe block)

**Interfaces:**
- Consumes: nothing new.
- Produces: `export function splitIntoSentences(text: string): string[]` — used by Task 4 (SW pipeline).

- [ ] **Step 1: Write the failing tests**

Append to `tests/tts.test.ts`:

```ts
import { pcmBase64ToWavDataUrl, splitIntoSentences, synthesizeSpeech } from '../lib/tts';
```

(update the existing import line) and:

```ts
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/tts.test.ts`
Expected: FAIL — `splitIntoSentences is not a function`

- [ ] **Step 3: Write the implementation**

Append to `lib/tts.ts`:

```ts
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/tts.test.ts`
Expected: PASS (all tts tests including the 7 new ones)

- [ ] **Step 5: Commit**

```bash
git add lib/tts.ts tests/tts.test.ts
git commit -m "feat: add splitIntoSentences for incremental TTS playback"
```

---

### Task 2: `PlayQueue` — pure queue state machine

**Files:**
- Create: `lib/play-queue.ts`
- Test: `tests/play-queue.test.ts` (new)

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `export type QueueState = 'idle' | 'playing' | 'paused';`
  - `export interface QueueSnapshot { state: QueueState; index: number; total: number }` (index = 0-based current clip, `-1` when idle)
  - `export class PlayQueue { constructor(maxClips?: number); get snapshot(): QueueSnapshot; enqueue(dataUrl: string): void; play(): void; pause(): void; stop(): void; clear(): void; get currentClip(): string | null; onEnded(): void }`
  - Semantics: `enqueue` auto-starts playback when idle; `stop` keeps the queue (state → `paused`, position preserved); `clear` empties everything (state → `idle`); `onEnded` advances to the next clip and drops finished clips (memory budget: queue never exceeds `maxClips`, default 50, oldest dropped); when the last clip ends, state → `idle` and clips are cleared.

- [ ] **Step 1: Write the failing tests**

Create `tests/play-queue.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { PlayQueue } from '../lib/play-queue';

describe('PlayQueue', () => {
  it('auto-starts playback when the first clip is enqueued', () => {
    const q = new PlayQueue();
    q.enqueue('a');
    expect(q.snapshot).toEqual({ state: 'playing', index: 0, total: 1 });
    expect(q.currentClip).toBe('a');
  });

  it('advances to the next clip on ended and clears when finished', () => {
    const q = new PlayQueue();
    q.enqueue('a');
    q.enqueue('b');
    expect(q.snapshot.total).toBe(2);
    q.onEnded();
    expect(q.snapshot).toEqual({ state: 'playing', index: 1, total: 2 });
    expect(q.currentClip).toBe('b');
    q.onEnded();
    expect(q.snapshot).toEqual({ state: 'idle', index: -1, total: 0 });
    expect(q.currentClip).toBeNull();
  });

  it('stop keeps the queue and preserves position; play resumes', () => {
    const q = new PlayQueue();
    q.enqueue('a');
    q.enqueue('b');
    q.onEnded();
    q.stop();
    expect(q.snapshot).toEqual({ state: 'paused', index: 1, total: 2 });
    expect(q.currentClip).toBe('b');
    q.play();
    expect(q.snapshot.state).toBe('playing');
    expect(q.currentClip).toBe('b');
  });

  it('pause stops playback but keeps the current clip', () => {
    const q = new PlayQueue();
    q.enqueue('a');
    q.pause();
    expect(q.snapshot).toEqual({ state: 'paused', index: 0, total: 1 });
  });

  it('clear empties the queue and resets to idle', () => {
    const q = new PlayQueue();
    q.enqueue('a');
    q.enqueue('b');
    q.clear();
    expect(q.snapshot).toEqual({ state: 'idle', index: -1, total: 0 });
    expect(q.currentClip).toBeNull();
  });

  it('enqueue while paused keeps the paused state', () => {
    const q = new PlayQueue();
    q.enqueue('a');
    q.pause();
    q.enqueue('b');
    expect(q.snapshot).toEqual({ state: 'paused', index: 0, total: 2 });
  });

  it('never exceeds maxClips; drops the oldest finished clip', () => {
    const q = new PlayQueue(2);
    q.enqueue('a');
    q.enqueue('b');
    q.enqueue('c');
    expect(q.snapshot.total).toBe(2);
    expect(q.currentClip).toBe('b');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/play-queue.test.ts`
Expected: FAIL — cannot find module `../lib/play-queue`

- [ ] **Step 3: Write the implementation**

Create `lib/play-queue.ts`:

```ts
export type QueueState = 'idle' | 'playing' | 'paused';

export interface QueueSnapshot {
  state: QueueState;
  index: number;
  total: number;
}

export class PlayQueue {
  private clips: string[] = [];
  private pos = 0;
  private state: QueueState = 'idle';
  private readonly maxClips: number;

  constructor(maxClips = 50) {
    this.maxClips = maxClips;
  }

  get snapshot(): QueueSnapshot {
    return { state: this.state, index: this.state === 'idle' ? -1 : this.pos, total: this.clips.length };
  }

  get currentClip(): string | null {
    if (this.state === 'idle' || this.pos >= this.clips.length) return null;
    return this.clips[this.pos];
  }

  enqueue(dataUrl: string): void {
    this.clips.push(dataUrl);
    while (this.clips.length > this.maxClips) {
      this.clips.shift();
      this.pos = Math.max(0, this.pos - 1);
    }
    if (this.state === 'idle' && this.clips.length > 0) {
      this.state = 'playing';
      this.pos = 0;
    }
  }

  play(): void {
    if (this.state === 'paused') {
      this.state = 'playing';
    } else if (this.state === 'idle' && this.clips.length > 0) {
      this.state = 'playing';
      this.pos = 0;
    }
  }

  pause(): void {
    if (this.state === 'playing') this.state = 'paused';
  }

  stop(): void {
    if (this.state === 'playing') this.state = 'paused';
  }

  clear(): void {
    this.clips = [];
    this.pos = 0;
    this.state = 'idle';
  }

  onEnded(): void {
    if (this.state === 'idle') return;
    if (this.pos + 1 < this.clips.length) {
      this.pos += 1;
      this.state = 'playing';
    } else {
      this.clips = [];
      this.pos = 0;
      this.state = 'idle';
    }
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/play-queue.test.ts`
Expected: PASS (7 tests)

- [ ] **Step 5: Commit**

```bash
git add lib/play-queue.ts tests/play-queue.test.ts
git commit -m "feat: add pure PlayQueue state machine for offscreen playback"
```

---

### Task 3: Offscreen document — queue-driven playback

**Files:**
- Modify: `src/offscreen/offscreen.ts` (rewrite)

**Interfaces:**
- Consumes: `PlayQueue` from `lib/play-queue.ts` (Task 2); message types `polydub-play-audio {dataUrl}`, `polydub-audio-command {command}`, `polydub-audio-state-get`, existing `polydub-offscreen-ping`.
- Produces: state updates `polydub-audio-state-update {data}` where `data = { state: 'idle'|'playing'|'paused', position?, duration?, index?, total?, error? }`. Commands: `play`, `pause`, `stop`, `clear-queue`.

- [ ] **Step 1: Write the failing test**

No unit test for this file (DOM/audio dependent) — verified in the real test (Task 7). Skip to implementation.

- [ ] **Step 2: Write the implementation (full rewrite)**

Replace the contents of `src/offscreen/offscreen.ts`:

```ts
export {};

import { PlayQueue } from '../../lib/play-queue';

export interface AudioState {
  state: 'idle' | 'playing' | 'paused';
  position?: number;
  duration?: number;
  index?: number;
  total?: number;
  error?: string;
}

const queue = new PlayQueue();
let audio: HTMLAudioElement | null = null;
let lastError: string | undefined;

function snapshotState(): AudioState {
  const s = queue.snapshot;
  return {
    state: s.state,
    index: s.index >= 0 ? s.index : undefined,
    total: s.total > 0 ? s.total : undefined,
    position: audio?.currentTime,
    duration: audio?.duration,
    error: lastError,
  };
}

function report(): void {
  void chrome.runtime.sendMessage({ type: 'polydub-audio-state-update', data: snapshotState() }).catch(() => {});
}

function ensureAudio(): HTMLAudioElement {
  if (audio) return audio;
  audio = new Audio();
  audio.addEventListener('ended', () => {
    queue.onEnded();
    const next = queue.currentClip;
    if (audio && next) {
      audio.src = next;
      void audio.play().catch(() => {});
    }
    report();
  });
  audio.addEventListener('pause', () => {
    if (queue.snapshot.state === 'playing') queue.pause();
    report();
  });
  audio.addEventListener('error', () => {
    lastError = 'Audio playback failed';
    report();
  });
  return audio;
}

function play(): void {
  const el = ensureAudio();
  queue.play();
  const clip = queue.currentClip;
  if (!clip) return;
  if (el.src !== clip) {
    el.src = clip;
    lastError = undefined;
  }
  void el.play().catch(() => {});
}

function pause(): void {
  queue.pause();
  audio?.pause();
}

function stop(): void {
  queue.stop();
  audio?.pause();
}

function clearQueue(): void {
  queue.clear();
  if (audio) {
    audio.pause();
    audio.removeAttribute('src');
    audio.load();
  }
  lastError = undefined;
}

function handleCommand(command: string): AudioState {
  switch (command) {
    case 'play':
      play();
      break;
    case 'pause':
      pause();
      break;
    case 'stop':
      stop();
      break;
    case 'clear-queue':
      clearQueue();
      break;
  }
  return snapshotState();
}

chrome.runtime.onMessage.addListener((message: unknown, _sender, sendResponse) => {
  if (!message || typeof message !== 'object') return false;
  const msg = message as { type?: string; [k: string]: unknown };

  if (msg.type === 'polydub-offscreen-ping') {
    sendResponse({ ok: true, data: { phase: 'offscreen-ready' } });
    return true;
  }

  if (msg.type === 'polydub-play-audio') {
    const dataUrl = typeof msg.dataUrl === 'string' ? msg.dataUrl : '';
    if (!dataUrl) {
      sendResponse({ ok: false, error: 'No audio data' });
      return true;
    }
    queue.enqueue(dataUrl);
    play();
    sendResponse({ ok: true, data: snapshotState() });
    return true;
  }

  if (msg.type === 'polydub-audio-command') {
    const command = typeof msg.command === 'string' ? msg.command : '';
    sendResponse({ ok: true, data: handleCommand(command) });
    return true;
  }

  if (msg.type === 'polydub-audio-state-get') {
    sendResponse({ ok: true, data: snapshotState() });
    return true;
  }

  return false;
});
```

- [ ] **Step 3: Verify typecheck and build**

Run: `npm run typecheck && npm run build`
Expected: TYPECHECK OK; build succeeds (`dist/offscreen/offscreen.html` etc.)

- [ ] **Step 4: Commit**

```bash
git add src/offscreen/offscreen.ts
git commit -m "feat: offscreen queue-driven playback with stop/clear-queue commands"
```

---

### Task 4: Service worker — pipelined readAloud

**Files:**
- Modify: `src/background/service-worker.ts`

**Interfaces:**
- Consumes: `splitIntoSentences` (Task 1), existing `synthesizeSpeech`, `pcmBase64ToWavDataUrl`, `getApiKey`, `ensureOffscreen`.
- Produces: no new message types; `readAloud(text)` now synthesizes sentence-by-sentence and pushes each clip to the offscreen queue; after 5 consecutive synthesis errors it aborts with `{ ok: false, error: 'TTS failed — check your key and proxy.' }`.

- [ ] **Step 1: Write the failing test**

No unit test for the pipeline (network + Chrome APIs) — covered by existing sw-relay regression tests + the real test (Task 7).

- [ ] **Step 2: Write the implementation**

Update imports in `src/background/service-worker.ts` (line 3) to:

```ts
import { pcmBase64ToWavDataUrl, splitIntoSentences, synthesizeSpeech } from '../../lib/tts';
```

Replace the `readAloud` function (lines ~24–37) with:

```ts
const MAX_CONSECUTIVE_ERRORS = 5;

async function readAloud(text: string): Promise<{ ok: boolean; error?: string }> {
  const sentences = splitIntoSentences(text);
  if (sentences.length === 0) return { ok: false, error: 'Nothing selected to read' };
  const apiKey = await getApiKey();
  if (!apiKey) return { ok: false, error: 'Add your API key in Settings first.' };
  await ensureOffscreen();
  let consecutiveErrors = 0;
  for (const sentence of sentences) {
    try {
      const audio = await synthesizeSpeech(apiKey, sentence, TTS_VOICE);
      const dataUrl = pcmBase64ToWavDataUrl(audio.base64, audio.sampleRate);
      const res = (await chrome.runtime.sendMessage({ type: 'polydub-play-audio', dataUrl })) as {
        ok?: boolean;
        error?: string;
      };
      if (!res?.ok) throw new Error(res?.error ?? 'Playback queue failed');
      consecutiveErrors = 0;
    } catch (err) {
      consecutiveErrors += 1;
      if (consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) {
        return { ok: false, error: 'TTS failed — check your key and proxy.' };
      }
    }
  }
  return { ok: true };
}
```

- [ ] **Step 3: Verify typecheck, unit tests, build**

Run: `npm run typecheck && npm test && npm run build`
Expected: TYPECHECK OK; all unit tests pass (including `sw-relay.test.ts` regression); build succeeds.

- [ ] **Step 4: Commit**

```bash
git add src/background/service-worker.ts
git commit -m "feat: pipelined sentence-by-sentence TTS synthesis in service worker"
```

---

### Task 5: Popup — Clear button and richer audio state

**Files:**
- Modify: `src/popup/popup.html`
- Modify: `src/popup/popup.ts`

**Interfaces:**
- Consumes: offscreen state updates (Task 3) incl. `index`/`total`; commands `play`, `pause`, `stop`, `clear-queue`.
- Produces: `audio-clear` button wired to `clear-queue`.

- [ ] **Step 1: Update the popup HTML**

In `src/popup/popup.html`, the Read panel row (lines 34–37) becomes:

```html
        <div class="row">
          <button id="audio-play" disabled>Play / Pause</button>
          <button id="audio-stop" disabled>Stop</button>
          <button id="audio-clear" disabled>Clear</button>
        </div>
```

- [ ] **Step 2: Update the popup logic**

In `src/popup/popup.ts`:

1. After `const audioStopBtn = ...` (line 26) add:

```ts
const audioClearBtn = $<HTMLButtonElement>('audio-clear');
```

2. Extend the local `AudioState` interface (lines 150–155) with `index?: number; total?: number;`.

3. In `applyAudioState` (lines 160–180):
   - enable the Clear button alongside Play/Stop: add `audioClearBtn.disabled = !active && !playbackActive;` after the `audioStopBtn.disabled` line;
   - update the playing status line to show queue position:
     ```ts
     } else if (state.state === 'playing') {
       const pos = state.total && state.total > 1 ? ` ${(state.index ?? 0) + 1}/${state.total}` : '';
       setStatus(readStatus, `Playing…${pos}`, 'info');
     ```

4. After the `audioStopBtn` listener (line 227–229) add:

```ts
audioClearBtn.addEventListener('click', () => {
  void chrome.runtime.sendMessage({ type: 'polydub-audio-command', command: 'clear-queue' });
});
```

- [ ] **Step 3: Verify typecheck and build**

Run: `npm run typecheck && npm run build`
Expected: TYPECHECK OK; build succeeds.

- [ ] **Step 4: Commit**

```bash
git add src/popup/popup.html src/popup/popup.ts
git commit -m "feat: popup Clear button and queue position display"
```

---

### Task 6: Translation progress — onProgress + toast + busy state

**Files:**
- Modify: `lib/translate.ts`
- Modify: `src/content/content.ts`
- Modify: `src/popup/popup.ts`
- Test: `tests/translate.test.ts`

**Interfaces:**
- Produces: `translateItems(apiKey, inputs, targetLang, onProgress?)` where `onProgress: (done: number, total: number, batch: TranslationOutput[]) => void`, called once per batch with cumulative `done`. Backward compatible (3-arg callers unchanged).
- Consumes: `polydub-get-state` now returns `{ translated: boolean, busy: boolean }`.

- [ ] **Step 1: Write the failing test**

Append to `tests/translate.test.ts` (inside the existing `describe('translateItems')` block):

```ts
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
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/translate.test.ts`
Expected: FAIL — `Expected an unbound method ...` or `onProgress` not called (type error or calls empty).

- [ ] **Step 3: Write the implementation**

In `lib/translate.ts`:

1. Add the type after `TranslationOutput` (line 15):

```ts
export type TranslateProgress = (done: number, total: number, batch: TranslationOutput[]) => void;
```

2. Replace `translateItems` (lines 82–100) with:

```ts
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
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/translate.test.ts`
Expected: PASS (all translate tests)

- [ ] **Step 5: Content script — toast, busy flag, progressive apply**

Replace `src/content/content.ts` with:

```ts
import { cacheTranslations, getApiKey, getTranslationCache } from '../../lib/storage';
import { translateItems } from '../../lib/translate';
import {
  applyTranslations,
  collectTextNodes,
  restoreText,
  type TextNodeRef,
} from '../../lib/extract';

export {};

const MAX_ELEMENTS = 100;

interface TranslatedState {
  originals: TextNodeRef[];
}

let state: TranslatedState | null = null;
let busy = false;
let toast: HTMLDivElement | null = null;

function showToast(): void {
  if (toast) return;
  toast = document.createElement('div');
  toast.id = 'polydub-toast';
  toast.textContent = 'در حال ترجمه…';
  toast.setAttribute('dir', 'rtl');
  Object.assign(toast.style, {
    position: 'fixed',
    top: '16px',
    right: '16px',
    zIndex: '2147483647',
    background: 'rgba(30, 30, 30, 0.92)',
    color: '#fff',
    padding: '8px 14px',
    borderRadius: '999px',
    fontSize: '13px',
    fontFamily: 'system-ui, sans-serif',
    pointerEvents: 'none',
    boxShadow: '0 2px 8px rgba(0, 0, 0, 0.25)',
  });
  document.documentElement.appendChild(toast);
}

function hideToast(): void {
  toast?.remove();
  toast = null;
}

async function translatePage(): Promise<{ count: number }> {
  const apiKey = await getApiKey();
  if (!apiKey) throw new Error('Add your API key in Settings first.');

  const refs = collectTextNodes(document.body, MAX_ELEMENTS);
  if (refs.length === 0) return { count: 0 };

  const cache = await getTranslationCache();
  const translations: string[] = new Array(refs.length).fill('');
  const uncached: { ref: TextNodeRef; index: number }[] = [];

  refs.forEach((ref, i) => {
    const key = ref.text.trim();
    const hit = cache[key];
    if (hit) translations[i] = hit;
    else uncached.push({ ref, index: i });
  });

  const newOriginals: TextNodeRef[] = [];
  let appliedCount = 0;

  const applyBatch = (batchRefs: TextNodeRef[], batchTexts: string[], entries: Record<string, string>): void => {
    if (batchRefs.length === 0) return;
    appliedCount += applyTranslations(batchRefs, batchTexts);
    newOriginals.push(...batchRefs);
    void cacheTranslations(entries).catch(() => {});
  };

  const cachedRefs: TextNodeRef[] = [];
  const cachedTexts: string[] = [];
  refs.forEach((ref, i) => {
    if (translations[i]) {
      cachedRefs.push(ref);
      cachedTexts.push(translations[i]);
    }
  });
  applyBatch(cachedRefs, cachedTexts, {});

  if (uncached.length > 0) {
    busy = true;
    showToast();
    try {
      const inputs = uncached.map((u, idx) => ({ id: idx, text: u.ref.text.trim() }));
      await translateItems(apiKey, inputs, 'fa', (_done, _total, batch) => {
        const batchRefs: TextNodeRef[] = [];
        const batchTexts: string[] = [];
        const entries: Record<string, string> = {};
        for (const out of batch) {
          const slot = uncached[out.id];
          if (!slot) continue;
          const original = slot.ref.text.trim();
          batchRefs.push(slot.ref);
          batchTexts.push(out.text);
          if (original && out.text !== original) entries[original] = out.text;
        }
        applyBatch(batchRefs, batchTexts, entries);
      });
    } finally {
      busy = false;
      hideToast();
    }
  }

  state = { originals: [...(state?.originals ?? []), ...newOriginals] };
  return { count: appliedCount };
}

async function revertPage(): Promise<{ count: number }> {
  if (!state) return { count: 0 };
  const count = restoreText(state.originals);
  state = null;
  return { count };
}

chrome.runtime.onMessage.addListener((message: unknown, _sender, sendResponse) => {
  if (!message || typeof message !== 'object') return false;
  const msg = message as { type?: string; [k: string]: unknown };

  if (msg.type === 'polydub-translate-page') {
    void translatePage().then(
      (data) => sendResponse({ ok: true, data }),
      (err) => sendResponse({ ok: false, error: err instanceof Error ? err.message : 'Translation failed' }),
    );
    return true;
  }

  if (msg.type === 'polydub-revert-page') {
    void revertPage().then(
      (data) => sendResponse({ ok: true, data }),
      (err) => sendResponse({ ok: false, error: err instanceof Error ? err.message : 'Revert failed' }),
    );
    return true;
  }

  if (msg.type === 'polydub-get-state') {
    sendResponse({ ok: true, data: { translated: state !== null, busy } });
    return true;
  }

  if (msg.type === 'polydub-get-selection') {
    sendResponse({ ok: true, data: { text: window.getSelection()?.toString() ?? '' } });
    return true;
  }

  if (msg.type === 'polydub-read-error') {
    sendResponse({ ok: true, data: { error: typeof msg.error === 'string' ? msg.error : 'Read aloud failed' } });
    return true;
  }

  return false;
});
```

- [ ] **Step 6: Popup — busy state**

In `src/popup/popup.ts`:

1. In the translate button handler, show busy state while running — wrap the `chrome.tabs.sendMessage` call (lines 133–135) region: before the send, add:

```ts
    translatePageBtn.disabled = true;
    setStatus(translateStatus, isTranslated ? 'Reverting…' : 'Translating…', 'info');
```

and in the `finally`-like flow, after `setTranslateButton(!isTranslated)` (line 139), add:

```ts
    translatePageBtn.disabled = false;
```

(In the existing code the response line is inside `try`; the catch path already shows the error — add `translatePageBtn.disabled = false;` at the start of the `catch` block too, and `setStatus(translateStatus, 'Translating…')` must be inside the `try` before the await.)

2. On popup open, mirror busy state — in the init IIFE (line 244–255), after the existing `polydub-get-state` call, update the handler to:

```ts
    const res = (await chrome.tabs.sendMessage(tab.id, {
      type: 'polydub-get-state',
    })) as { ok?: boolean; data?: { translated?: boolean; busy?: boolean } };
    if (res?.ok && res.data) {
      setTranslateButton(res.data.translated === true);
      if (res.data.busy) {
        translatePageBtn.disabled = true;
        setStatus(translateStatus, 'Translating…', 'info');
      }
    }
```

- [ ] **Step 7: Verify typecheck, unit tests, build**

Run: `npm run typecheck && npm test && npm run build`
Expected: TYPECHECK OK; all tests pass (31 existing + new translate progress test); build succeeds.

- [ ] **Step 8: Commit**

```bash
git add lib/translate.ts src/content/content.ts src/popup/popup.ts tests/translate.test.ts
git commit -m "feat: translation progress feedback with on-page toast and popup busy state"
```

---

### Task 7: Real test, PRD update, phase2-checkpoint

**Files:**
- Modify: `docs/superpowers/specs/PRD-v0.001.md`
- (No code changes unless the real test finds a bug — then fix + test + commit separately before this task's commit.)

- [ ] **Step 1: Run full verification locally**

Run: `npm test && npm run typecheck && npm run build`
Expected: all unit tests pass, TYPECHECK OK, build succeeds.

- [ ] **Step 2: Real test in Chrome**

Prerequisites: proxy `127.0.0.1:10808` running; Chrome launched with the test profile (`/tmp/opencode/ui-test`) and CDP port 9257.
1. User opens Chrome and refreshes the extension in `chrome://extensions`.
2. Navigate to `https://example.com`, select some text, click the PolyDub icon → Read tab → Read Selection.
   - Verify: first audio starts ≤ 3s; sentences play continuously without gaps; status shows `Playing… 1/3` etc.
3. Click Stop → audio stops; status `Paused.`; click Play/Pause → resumes from the stopped position.
4. Click Clear → status `Done.`; Play/Pause disabled.
5. Right-click a selection → "Read aloud with PolyDub" also works.
6. Translate Page → toast «در حال ترجمه…» appears; text applies progressively; toast disappears; open the popup mid-translation (translate a long page) → shows "Translating…" with button disabled.
7. Revert Page → page restored; translated flag resets.
8. Check `chrome://extensions/?errors=…` — zero errors.

- [ ] **Step 3: Update the PRD**

In `docs/superpowers/specs/PRD-v0.001.md`, section 1 table, change the Phase 2 row from:

```
| ۲ | خواندن متن انتخابشده با TTS | 🟡 در حال انجام (صف پخش + بازخورد ترجمه مطابق اسپک) |
```

to:

```
| ۲ | خواندن متن انتخابشده با TTS | ✅ کامل (tags: `phase2-checkpoint`؛ صف پخش + بازخورد ترجمه) |
```

- [ ] **Step 4: Checkpoint commit + tag**

```bash
git add docs/superpowers/specs/PRD-v0.001.md
git commit -m "Phase 2: TTS playback queue with pipelined synthesis and translation progress feedback"
git tag phase2-checkpoint
```

- [ ] **Step 5: Push (optional, only if the user asks)**

```bash
git push && git push origin phase2-checkpoint
```

---

## Self-Review Notes

- **Spec coverage:** splitIntoSentences (spec §TTS), PlayQueue stop/clear semantics (approved design §1), offscreen queue + commands (spec §Architecture), SW pipeline (design §Architecture), popup Clear button (design §1), toast + busy popup state (design §2), onProgress batching (design §2), per-batch progressive apply + revert correctness (design §2 + tests), regression: sw-relay (Task 4 verify), large TTS payload (Task 1 verify).
- **Phase 4 note:** real SSE streaming remains documented-only (PRD §4.2 Option A), not implemented here. The PlayQueue interface (`enqueue`/`onEnded`) is the swap point for a future streaming decoder.
- **Type consistency:** `PlayQueue.snapshot.index` is `-1` when idle; offscreen maps it to `undefined` in `AudioState.index`; popup displays `(index ?? 0) + 1`. `onProgress` batch outputs carry the same `{id, text}` shape as `translateItems` outputs, with ids matching `inputs` ids.
