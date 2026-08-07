# PolyDub

Translate and dub web pages, videos, and podcasts live using Google AI (Gemini).

## Development notes

- **Google API access:** Requires a proxy at `127.0.0.1:10808` (HTTP) to reach
  `generativelanguage.googleapis.com` / Google AI Studio from this machine.
  Chrome must be launched with the system/browser proxy configured so extension
  `fetch` calls to the Gemini API also go through it.
- Load the unpacked extension from `dist/` in `chrome://extensions` (Developer mode).
- Build: `npm run build` (esbuild for background/content + Vite for popup/offscreen).
- Test: `npm test`, typecheck: `npm run typecheck`.

## Phases

1. Page text translation (Phase 1)
2. TTS read-aloud of Persian text (Phase 2)
3. Read translated text (Phase 3)
4. Live dubbing of video/podcast audio (Phase 4)
5. Audio-only translated playback, podcast mode (Phase 5)
6. Automatic voice switching per speaker (Phase 6)
