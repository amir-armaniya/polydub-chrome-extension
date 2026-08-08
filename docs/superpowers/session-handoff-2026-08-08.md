# Session Handoff — 2026-08-08 (قبل از کامپکت)

این فایل برای ادامه کار بعد از کامپکت است. همهچیز مهم در اینجا است.

## 1. وضعیت git (واقعی، همین الان)

- HEAD: `96c66c0` (fix: surface TTS read errors + Translate Page context-menu)
- قبلی: `a80c7d6` (لاگ تایمینگ Gemini) ← `87a92c8` (PRD فاز ۲ = کامل) ← `c58c1d8` (فیکس revert میانی)
- تگها: `phase0-checkpoint`, `phase1-checkpoint`, `phase2-checkpoint`
- **تغییرات uncommitted در working tree** (هر چیزی که کاربر/کسی بعد از 96c66c0 برعکس کرده — همه با git قابل بازیابی):
  - `lib/gemini.ts`: لاگهای تایمینگ حذف شده
  - `src/background/service-worker.ts`: منوی context ترجمه حذف شده، `readAloud` دیگر export نیست، لاگها حذف شده
  - `src/content/content.ts`: toastهای خطا/پایان (`polydub-read-error`/`polydub-translate-error`/`polydub-translate-done`) حذف شده
  - `tests/context-menu-translate.test.ts` و `tests/read-aloud.test.ts`: حذف شدهاند (در 96c66c0 موجودند — `git checkout 96c66c0 -- tests/...` بازیابی میشود)
  - فایلهای اضافی بیربط: `.playwright-mcp/`, `server.heapsnapshot`, `tui.heapsnapshot`
- تستها الان: 46 پاس / 7 فایل (فایلهای تست جدید در حال اجرا نیستند چون حذف شدهاند)

## 2. بازخورد کاربر (دقیق)

> سرعت در زبان انگلیسی عالیه، موقع ترجمه یک اعلان نمایش داده میشه، اما سرعت در زبان فارسی خیلی خیلی کند بود
> اما یک باگ پنهان هم هست: برنامه برای هر زبان فقط یکبار ترجمه صوتی انام میده!!! بصورتی که در تست دومم اصلا صدایی پخش نشد بعد از چندین دقیقه و همینطور هیچ اعلانی نمایش داده نمیشه
> یعنی اگر کسی با کلید سمت راست موس کلیک بکنه تا ویس رو بشنوه فکر میکنه برنامه خرابه
> یک مورد دیگه: دکمه ترجمه هم باید به کلید های سمت راست اضافه بکنیم
> تو هم تست ها رو بگیر ولی ما برای زبان فارسی مشکل داریم
> اولویت: باگها را یکییکی حل کن (با هم نه)، باگ > فیچر

## 3. الویتهای کار (به این ترتیب، یکییکی)

1. **P0 باگ A — صدا فقط یکبار پخش میشود** (دومین بار: سکوت کامل، بدون اعلان)
2. **P0 باگ B — TTS فارسی خیلی خیلی کند** (انگلیسی عالی است)
3. **P1 فیچر — «ترجمه صفحه» به منوی راستکلیک اضافه شود** (کاربر صریح خواسته)
4. **P2 — تستها** (همهجا اجرا شود: `npm test`, `npm run typecheck`, `npm run build`)

## 4. فرضیههای فنی باگها (برای ایجنت دیباگ — باید خودش کد را بخواند)

### باگ A (صدا فقط یکبار؛ دومین بار سکوت)
کد فعلی `src/offscreen/offscreen.ts` (140 خط):
- خط 62-65: `if (el.src !== clip) { el.src = clip; lastError = undefined; }` — اگر همان متن دوباره خوانده شود، dataUrl یکسان است → `src` ست نمیشود → `el.play()` روی المنت ended → احتمالاً سکوت
- خط 46-49: هندلر `pause` — با حالت `playing` صف تداخل دارد (پایان طبیعی: pause بعد ended)
- خط 37-45: هندلر `ended` → `queue.onEnded()` → اگر آخرین کلیپ بود صف خالی میشود (idle)
- `lib/play-queue.ts`: `onEnded()` آخرین کلیپ → clear → idle؛ `enqueue` در حالت idle → خودکار start با pos=0
- سمت SW: `readAloud` فقط بعد از ۵ خطای متوالی error برمیگرداند — ۱-۴ خطا ساکت بلعیده میشود → «هیچ اعلانی نمایش داده نمیشود» (و در working tree فعلی toast خطا هم حذف شده)
- باید در کروم واقعی تست شود: همان متن دوبار، و متن متفاوت دوبار

### باگ B (فارسی کند)
- `readAloud` (service-worker.ts) برای هر جمله یک فراخوانی متوالی Gemini (`for...of` + await)
- فارسی: جملات کوتاه زیاد (جداسازها: `. ! ؟ \n` + تکرار زبانی) → تعداد فراخوانی زیاد → هر فراخوانی چند ثانیه → مجموع خیلی کند
- احتمالاً تعداد جملات فارسی ≫ انگلیسی برای متن همطول
- راهحلهای کاندید (اندازهگیری لازم است): ادغام جملات کوتاه مجاور در یک فراخوانی (تا حدی کاراکتر)، افزودن timing log دوباره (`a80c7d6` را ببین) برای اندازهگیری، موازیسازی محدود
- تست واحد برای `splitIntoSentences` با متن فارسی موجود است (tts.test.ts) — ایجنت باید رفتار فارسی را چک کند

## 5. معماری فعلی (خلاصه برای ایجنتها)

- MV3: SW (`src/background/service-worker.ts`) ← offscreen (`src/offscreen/offscreen.ts`) → Audio؛ content script (`src/content/content.ts`) برای ترجمه صفحه
- قراردادهای پیام (نباید شکسته شوند):
  - SW→offscreen: `polydub-play-audio {dataUrl}` → `{ok}`؛ offscreen→broadcast: `polydub-audio-state-update {state,position?,duration?,index?,total?,error?}`
  - popup→offscreen: `polydub-audio-command {command: play|pause|stop|clear-queue}`؛ `polydub-audio-state-get`
  - popup→SW: `polydub-validate-key`, `polydub-inject-content`, `polydub-read-aloud {text}`
  - popup→content: `polydub-translate-page`, `polydub-revert-page`, `polydub-get-state` (data: `{translated,busy}`), `polydub-get-selection`
  - SW→content: `polydub-read-error {error}`؛ content: toastها (در working tree فعلی حذف شدهاند — تصمیم: برگردانیم یا نه؟ کاربر گفت «هیچ اعلانی نمایش داده نمیشه» → باید برگردانده شوند)
  - SW context menu: `polydub-read-selection` (موجود)؛ `polydub-translate-page` (در 96c66c0 بود، الان حذف — کاربر خواسته اضافه شود)
- فایلها: `lib/tts.ts` (synthesizeSpeech, splitIntoSentences, pcmBase64ToWavDataUrl)، `lib/gemini.ts` (generateContent, fetchWithRetry)، `lib/play-queue.ts` (PlayQueue)، `lib/storage.ts`، `lib/extract.ts`، `lib/translate.ts`
- صدا: `TTS_VOICE = 'Kore'`؛ مدل TTS در `lib/gemini.ts` (GEMINI_MODELS.tts)

## 6. مستندات پروژه

- PRD: `docs/superpowers/specs/PRD-v0.001.md` (فاز ۲ = کامل؛ فاز ۳ = خواندن صفحه ترجمهشده)
- طراحی فاز ۲: `docs/superpowers/specs/2026-08-07-tts-queue-and-translate-feedback-design.md`
- پلن فاز ۲: `docs/superpowers/plans/2026-08-07-phase2-tts-queue-and-translate-feedback.md`
- README نقشه راه فازها

## 7. پلن بعد از کامپکت (ایجنتها)

1. من (کنترلر) اول PRD + اسپک + پلن را میخوانم (فقط سر تیترها)
2. **ایجنت خواننده/توزیعکننده**: همه داکیومنتها را میخواند و کارها را به ایجنتهای مجزا تقسیم میکند (هر ایجنت یک باگ/فیچر، context کم)
3. **ایجنت باگ A** (دیباگ + فیکس + تست) — بعد از تأیید
4. **ایجنت باگ B** (اندازهگیری + فیکس) — بعد از تأیید
5. **ایجنت فیچر context-menu ترجمه** — بعد از تأیید
6. هر باگ یکییکی: دیباگ سیستماتیک → فیکس → تست → کامیت → بازبینی (رویه superpowers)
