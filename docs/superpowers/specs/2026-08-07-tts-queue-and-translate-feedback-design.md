# Design: TTS Incremental Playback & Translation Feedback

Date: 2026-08-07
Status: Approved by user (product manager review)

## Goal

Two user-facing problems to fix:

1. **Read Aloud (TTS) starts too late.** Today the extension synthesizes the *entire* selection with one Gemini request and only starts playing when everything is done — 5–15s of silence.
2. **Page translation gives no feedback.** The popup shows nothing while a translation is running, and the page doesn't change until every element is done. Users don't know the extension is working.

## Scope

- In scope: sentence-by-sentence TTS playback with a play queue; minimal "working" indicator on the page; popup reflects live translation state; tests.
- **Explicitly out of scope: real streaming (SSE) TTS. That belongs to Phase 4 (live dubbing of audio/video) and is documented here only — it will NOT be built now.**

## Feature 1: TTS incremental playback

### Behavior

- The selected text is split into sentences (`.`, `!`, `?`, `؟`, `!`, newline, … — Persian and English aware).
- The service worker synthesizes sentences one at a time and sends each completed clip to the offscreen document.
- Synthesis of sentence *i+1* runs while sentence *i* is playing (pipeline), so there are no gaps between sentences.
- First audio starts ~2–3 seconds after the user triggers Read Aloud (time to synthesize the first sentence).
- If a middle sentence fails: the error is reported, but already-queued sentences continue playing.

### Audio controls (popup)

- **Play / Pause** — toggles the current audio.
- **Stop** — stops the *current* playback only. The queue is preserved; pressing Play resumes from the stopped position.
- **Clear** (separate button) — empties the whole queue and resets to idle. This is the only action that discards queued audio.

### Architecture

- `lib/tts.ts`: new pure function `splitIntoSentences(text: string): string[]` (unit-testable; keeps whitespace handling sane).
- `src/background/service-worker.ts`: `readAloud()` becomes a pipeline — sequential synthesis loop pushing each clip to the offscreen queue as soon as it is ready.
- `src/offscreen/offscreen.ts`: holds a **playback queue** of audio data URLs. Plays items back-to-back (`ended` → next). Commands: `play`, `pause`, `stop` (keep queue, stop current), `clear-queue` (drop everything). State updates (`idle|playing|paused`) are broadcast as today via `polydub-audio-state-update`.
- `src/popup/popup.html` + `popup.ts`: add a Clear button next to Stop; wire the new commands.

## Feature 2: Translation feedback

### Behavior

- While a translation runs, a **small, minimal toast** appears on the page (top corner, RTL-friendly): «در حال ترجمه…». No numbers, no progress bar. It disappears automatically when the translation finishes or fails.
- The **popup reflects live state**: when opened during a translation it shows «در حال ترجمه…» and disables the Translate button; when a translation is done it shows the normal state with the Revert Page button. This matches "as if the user had just clicked".
- Translations are **applied batch-by-batch as they arrive** (progressive application), so the page updates while working — this is an implementation detail, not a UI feature.

### Architecture

- `lib/translate.ts`: `translateItems` gains an `onProgress(done: number, total: number)` callback invoked after each batch.
- `src/content/content.ts`:
  - Tracks `{ originals, translating, progress }` state; `polydub-get-state` returns `{ translated, busy }` so the popup can mirror it.
  - Injects a minimal toast element on translate start; removes it on completion/error.
  - Applies each finished batch immediately to its elements; accumulates `originals` incrementally so revert stays correct.
- `src/popup/popup.ts`: on open, query `polydub-get-state`; if `busy`, show «در حال ترجمه…» and disable the Translate button.

## Testing

- Unit tests:
  - `splitIntoSentences` — English/Persian sentences, mixed punctuation, empty input, whitespace.
  - `translateItems` — `onProgress` fires once per batch with cumulative `(done, total)`; fires with full total on completion.
  - Offscreen queue logic — Stop keeps queue / Clear empties queue / play resumes after Stop (pure-logic parts).
  - Progressive apply + revert correctness (subset apply, full revert).
  - Regression: TTS large-payload conversion (existing), no service-worker self-relay (existing).
- Real test (per project rule): build, reload the extension in real Chrome (CDP port 9257, profile `/tmp/opencode/ui-test`), verify:
  - Read Aloud on example.com starts in ~2–3s and plays sentences continuously.
  - Stop pauses; Play resumes; Clear resets.
  - Translate shows the toast, applies progressively, popup shows busy state when opened mid-run, Revert works.

## Phase 4 note (documented only, NOT built)

Real streaming TTS (Gemini `streamGenerateContent` SSE → incremental PCM decode → playback) is reserved for Phase 4: live dubbing of audio and video. The offscreen play queue is designed so its playback side can later be swapped to a streaming decoder without changing the queue/command interface.
