---
spec_id: reading.transcription.gemini_primary_fallback_alert
module: reading-transcription
title: 全文朗讀 + 逐段朗讀 Gemini 音訊轉錄 — webm 轉碼 + fallback alert + 殺即時補強閃爍
stability: active
canonical_source: backend/app/services/reading_transcription_service.py
owns_code:
  - backend/app/services/reading_transcription_service.py
  - backend/app/services/audio_upload_service.py
  - backend/app/routes/learning/learning_reading.py
  - backend/app/routes/learning/learning_audio_replay.py
  - backend/app/routes/teacher/teacher_audio_replay.py
  - backend/app/services/assignment_lifecycle_service.py
  - scripts/reconcile_reading_audio_orphans.py
  - frontend/src/hooks/useAudioRecorder.ts
  - frontend/src/hooks/useKeyPassageReadingSession.ts
  - frontend/src/components/reading-steps/KeyPassageReading.tsx
  - frontend/src/components/reading-steps/paragraph-reading/ParagraphReading.tsx
  - frontend/src/services/learning/session.ts
owns_data: []
spec_tests:
  - backend/specs/test_reading_transcription_spec.py
  - backend/tests/test_reading_audio_upload.py
  - backend/tests/test_reading_audio_replay_student.py
  - backend/tests/test_teacher_audio_replay.py
related_issues:
  - 2131
  - 2156
  - 2266
  - 2266-audio-replay
  - 2266-pr2
source_meetings: []
last_reviewed: 2026-06-09
owner: young
---

# reading-transcription — INTENT

## Purpose

Provide high-quality audio-to-text transcription for both FullReading (全文朗讀) and LiveTutor
(逐段朗讀) by routing browser MediaRecorder audio through Gemini Audio Understanding instead of
relying solely on the browser's Web Speech API.

The browser Web Speech API has known accuracy issues with Taiwanese Mandarin, especially for
homophones and text-specific vocabulary. Gemini can be guided with the reference (target) text
to resolve ambiguities, producing transcripts that more faithfully represent what the student
actually read.

---

## Invariants (I1–I5)

### I1 — Gemini is the sole trusted transcription source

When Gemini successfully transcribes the audio, **only** the Gemini transcript is used for
scoring (analyzeFluency / evaluateAndRespond). The Web Speech transcript is **never** passed
to scoring logic when a valid Gemini transcript is available.

Corollary: `reinsertPunctuation(webSpeechTranscript, fullText)` MUST NOT be used as a
substitute for Gemini transcription. It produces a fake high-quality appearance without
actual accuracy.

### I2 — webm audio must be transcoded before sending to Gemini

Chrome MediaRecorder defaults to `audio/webm;codecs=opus`. Vertex AI Gemini Audio Understanding
does NOT natively accept webm. The backend service (`reading_transcription_service.py`) must
transcode webm (and other unsupported formats) to `audio/ogg` via ffmpeg before calling Gemini.

Supported input MIME types (browser → backend): `audio/webm`, `audio/webm;codecs=opus`,
`audio/ogg`, `audio/ogg;codecs=opus`, `audio/mp4`, `audio/mpeg`, `audio/wav`.

### I3 — No live punctuation re-insertion during recording (kill flicker)

The live preview shown during recording (while STT is producing partial results) MUST display
raw Web Speech text in a visually distinct (gray) style. It MUST NOT run punctuation
re-insertion or `enhanceLiveTranscript` on every partial result — doing so causes visible
flicker on every STT update.

The label "即時預覽（唸完精準校正）" communicates to the user that accurate punctuation is
added after submission.

### I4 — Fallback must alert, never be silent

When Gemini transcription fails (any reason: transcode failure, Gemini timeout, safety filter,
empty result, network error), the UI MUST display a visible warning banner:

> "⚠️ 高品質辨識暫時失敗，這是粗略結果，建議重試"

The banner must be dismissible and include the reason for teacher/debug awareness. Silently
falling back without user notification is forbidden — it would mislead the student about their
score quality.

### I5 — Fallback must not auto-pass

When Gemini fails and the system falls back to Web Speech scoring, the result MUST use the
raw Web Speech transcript for scoring. The student must not be auto-passed or given an
artificially high score due to the fallback. If no Web Speech transcript exists either, the
evaluation must show 0% or prompt a retry.

---

## Architecture

```
Browser (MediaRecorder)
  ├─ audio/webm blob ──────────────────────────────────►  POST /api/reading/transcribe
  │                                                        │
  │   [Backend: reading_transcription_service.py]         │
  │   1. Check MIME → needs transcode?                    │
  │   2. If yes: ffmpeg webm→ogg (temp files)             │
  │   3. Call Gemini Audio with reference text hint       │
  │   4. Return {transcript, method, reasoning}           │
  │      OR {transcript: null, method: "fallback", reason}│
  │                                                        │
  └─ Web Speech (partial + final results) ────────────►  Live preview only (gray text, I3)

Frontend scoring:
  - method=gemini → use Gemini transcript (I1)
  - method=fallback → show alert (I4), use Web Speech, never auto-pass (I5)
```

### Per-feature integration

**FullReading (全文朗讀)**:
- `useAudioRecorder` records the full reading (max 120s)
- On submit: stop recorder → POST to `/api/reading/transcribe`
- `useFullReadingSession.submitReading()` resolves which transcript to use
- `FullReading.tsx` shows fallback banner when `fallbackReason` is set

**LiveTutor (逐段朗讀)**:
- `useAudioRecorder` records each paragraph (max 120s, reset per paragraph)
- On paragraph submit (`submitSentence`): stop recorder → POST to `/api/reading/transcribe`
- Gemini transcript replaces Web Speech for `evaluateAndRespond` call (I1)
- `LiveTutor.tsx` shows per-paragraph fallback banner when `paragraphFallbackReason` is set

---

## Contracts (machine-verifiable, see test_reading_transcription_spec.py)

| ID | Contract |
|----|----------|
| C1 | webm MIME triggers transcode; is NOT passed directly to Gemini |
| C2 | Any Gemini/transcode failure → `{method: "fallback", reason: str, transcript: null}` + WARN log `event=reading_transcribe_fallback` |
| C3 | Gemini success → `{method: "gemini", transcript: str (non-empty), reasoning: str}` |
| C4 | Unsupported MIME → HTTP 415 (route gate); empty audio → HTTP 400; never HTTP 500 on AI error |
| C5 | Route has auth (`get_current_user`), rate-limit (`ai_limit`), and size caps (`_MAX_AUDIO_BYTES`, `_MAX_TARGET_CHARS`) |
| C6 | After transcription completes (success or graceful fallback — not on unhandled exception), audio bytes are uploaded to GCS via BackgroundTasks (fire-and-forget). Upload never blocks the response, never sets public ACL, and silently skips if READING_AUDIO_GCS_BUCKET env is unset. |

---

---

## Audio Replay (Issue #2266 PR1)

After transcription, the audio file is uploaded to GCS and the blob path is stored in
`ReadingAttemptHistory.audio_gcs_path`.  Students can request a signed URL via:

```
GET /api/learning/sessions/{session_id}/reading-audio/{attempt_id}
```

The endpoint (`learning_audio_replay.py`) validates session ownership, fetches the attempt,
generates a 10-minute V4 signed URL via `generate_audio_signed_url()`, and returns
`{signed_url, expires_in: 600}`.

Security invariants:
- Only the session owner (student) may call the endpoint.
- The bucket stays private; no public ACL is ever set.
- Signed URLs expire after 10 minutes and are never cached server-side.

---

## Non-goals

- Real-time streaming transcription (Gemini audio is one-shot after recording ends)
- Persisting transcripts to DB (handled by existing LearningSession flow)
- E2E automated microphone testing (requires real audio hardware; manual test on staging)
