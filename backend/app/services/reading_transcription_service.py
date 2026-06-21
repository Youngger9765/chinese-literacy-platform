"""Gemini audio transcription service for FullReading STT upgrade (Issue #2131).

Thin proxy: accepts audio bytes + target text, returns a high-quality
transcription with punctuation using Gemini audio understanding.

Design principles:
- Backend is transcription-only; scoring stays in frontend analyzeFluency().
- Fail-closed: any exception → return {transcript: null, method: "fallback", reason: <str>}
  so the caller can show a fallback alert and use the Web Speech transcript.
- No new DB schema: result is returned synchronously, not persisted here.
  The caller (route) may log AI usage; this service is stateless.

Audio format handling (Issue #2156 — Phase 0 root cause fix):
  Chrome MediaRecorder defaults to audio/webm;codecs=opus.
  Vertex AI Gemini audio only supports: wav / mp3 / aiff / aac / ogg / flac.
  webm is NOT supported → sends error → silent fallback.
  Fix: transcode webm (and any other unsupported format) → ogg via ffmpeg
  before calling Gemini. ffmpeg is already in backend/Dockerfile.

Supported input MIME types (browser MediaRecorder output — route allowlist):
    audio/webm, audio/webm;codecs=opus, audio/ogg, audio/ogg;codecs=opus,
    audio/mp4, audio/mpeg, audio/wav

Limits enforced by route (not repeated here):
    - Audio bytes: ≤ 10 MB
    - Duration hint: ≤ 120 s
    - target_text: ≤ 3000 chars (≈ longest G9 lesson)
"""

from __future__ import annotations

import asyncio
import io
import logging
import subprocess
import tempfile
import os

logger = logging.getLogger(__name__)

# Module-level re-exports from gemini_client so test patches can target this module.
# Lazy-imported at runtime to avoid circular imports and missing-package errors in
# environments where google-cloud-aiplatform is not installed (e.g. unit test CI).
def _check_safety_filter(response):  # noqa: ANN001
    """Thin wrapper — defers to gemini_client._check_safety_filter at runtime."""
    from .ai.gemini_client import _check_safety_filter as _real  # noqa: PLC0415
    return _real(response)

# Maximum audio duration we'll send to Gemini (cost + latency guard).
MAX_AUDIO_DURATION_SEC = 120

# Allowed audio MIME types (browser MediaRecorder output — used by route for 415 gate).
ALLOWED_AUDIO_MIMES: frozenset[str] = frozenset(
    {
        "audio/webm",
        "audio/webm;codecs=opus",
        "audio/webm; codecs=opus",
        "audio/ogg",
        "audio/ogg;codecs=opus",
        "audio/ogg; codecs=opus",
        "audio/mp4",
        "audio/mpeg",
        "audio/wav",
    }
)

# MIME types that Vertex AI Gemini natively accepts (no transcoding needed).
# Ref: https://cloud.google.com/vertex-ai/generative-ai/docs/multimodal/audio-understanding
_GEMINI_NATIVE_AUDIO_MIMES: frozenset[str] = frozenset(
    {
        "audio/wav",
        "audio/mp3",
        "audio/mpeg",
        "audio/aiff",
        "audio/aac",
        "audio/ogg",
        "audio/flac",
    }
)

# Fallback reason literals (used for WARN log + frontend alert).
_REASON_TRANSCODE = "decode"        # ffmpeg transcode failed
_REASON_TIMEOUT   = "timeout"
_REASON_SAFETY    = "safety"
_REASON_EMPTY     = "empty"
_REASON_ERROR     = "error"
_REASON_HALLUCINATION = "hallucination"  # Issue #2321 — Gemini hallucinated hint text
_REASON_SILENT = "silent"                # Issue #2368 — deterministic no-speech energy gate

# Issue #2368 — server-side silence / energy gate.
# Gemini parrots the FULL reference text on silent / no-speech audio (it is given
# target_text as a homophone hint), and the length-based hallucination gate below
# only catches SHORT prefixes — a full-text parrot slips through as a false ~100%.
# Measured peak (ffmpeg volumedetect max_volume):
#   digital silence ≈ -inf   ·  440 Hz tone ≈ -18 dB
#   white noise     ≈ -3.5 dB·  child speech ≈ -10 … -30 dB
# -45 dB is well below the softest real reading but above true / near silence,
# so it rejects silence without blocking soft readers.
_SILENT_MAX_VOLUME_DB = -45.0


def _normalise_mime(raw: str) -> str:
    """Strip codec parameter: 'audio/webm;codecs=opus' → 'audio/webm'."""
    return raw.split(";")[0].strip()


# Issue #2321 — Hallucination detection at the transcription layer.
# Mirrors the constants in reading_evaluation_service._is_hallucination_prefix.
# Kept here so the transcription service can act as an early gate before the
# transcript even reaches the scoring service.
_HALLUCINATION_LENGTH_RATIO = 0.35   # transcript < 35 % of target → suspect
_HALLUCINATION_PREFIX_MATCH = 0.90   # ≥ 90 % of transcript chars match target prefix


def _strip_cjk_punctuation(text: str) -> str:
    """Strip CJK punctuation and whitespace for prefix comparison.

    Intentionally minimal — mirrors the normalisation step in
    reading_evaluation_service._normalize_text without importing that module
    (to avoid circular dependency).  Only used for hallucination detection, not
    for scoring, so exact parity with the scoring normaliser is not required.
    """
    import re
    return re.sub(r'[\s　、-〿＀-￯‘-‟。，！？；：、─—…「」『』（）]', '', text)


def _is_hallucination_transcript(transcript: str, target_text: str) -> bool:
    """Return True when transcript looks like Gemini hallucinated the lesson hint.

    Same logic as reading_evaluation_service._is_hallucination_prefix:
      1. Normalised transcript length < 35 % of normalised target length
      2. ≥ 90 % of transcript chars match the target's opening chars

    This is a *transcription-layer* gate: if it fires, we return fallback
    immediately so the empty-transcript path (→ no auto-pass) takes effect.
    """
    t_norm = _strip_cjk_punctuation(transcript)
    tgt_norm = _strip_cjk_punctuation(target_text)
    t_len = len(t_norm)
    tgt_len = len(tgt_norm)
    if tgt_len == 0 or t_len == 0:
        return False
    if t_len >= _HALLUCINATION_LENGTH_RATIO * tgt_len:
        return False
    prefix = tgt_norm[:t_len]
    matches = sum(a == b for a, b in zip(t_norm, prefix))
    return (matches / t_len) >= _HALLUCINATION_PREFIX_MATCH


def _needs_transcode(mime_type: str) -> bool:
    """Return True if the MIME type is NOT natively accepted by Gemini."""
    base = _normalise_mime(mime_type)
    return base not in _GEMINI_NATIVE_AUDIO_MIMES


def _max_volume_db(audio_bytes: bytes, source_mime: str) -> float | None:
    """Return peak (max) volume in dBFS via ffmpeg `volumedetect`.

    Issue #2368 — deterministic silence gate run BEFORE STT.  ffmpeg can decode
    every browser MediaRecorder container directly, so we measure the raw bytes
    without transcoding first.

    Returns:
        - a negative float (e.g. -3.5) for audio with sound
        - float('-inf') for true digital silence
        - None if ffmpeg fails or the level cannot be parsed (caller fails open —
          STT + the downstream hallucination gate still apply).
    """
    import re

    base = _normalise_mime(source_mime)
    ext = {
        "audio/webm": ".webm",
        "audio/ogg":  ".ogg",
        "audio/mp4":  ".mp4",
        "audio/mpeg": ".mp3",
        "audio/wav":  ".wav",
    }.get(base, ".audio")

    in_path: str | None = None
    try:
        with tempfile.NamedTemporaryFile(suffix=ext, delete=False) as in_f:
            in_f.write(audio_bytes)
            in_path = in_f.name

        result = subprocess.run(
            ["ffmpeg", "-i", in_path, "-af", "volumedetect", "-f", "null", "-"],
            capture_output=True,
            timeout=20,
        )
        stderr = result.stderr or b""
        m = re.search(rb"max_volume:\s*(-?\d+(?:\.\d+)?)\s*dB", stderr)
        if m:
            return float(m.group(1))
        # ffmpeg emits no max_volume line for empty/-inf audio streams.
        if b"-inf dB" in stderr or b"mean_volume" in stderr:
            return float("-inf")
        return None
    except Exception:  # noqa: BLE001 — fail open; downstream gates still apply
        return None
    finally:
        if in_path and os.path.exists(in_path):
            try:
                os.unlink(in_path)
            except OSError:
                pass


def _transcode_to_ogg(audio_bytes: bytes, source_mime: str) -> bytes | None:
    """Transcode audio_bytes to ogg/opus using ffmpeg.

    Returns the transcoded bytes on success, or None on ffmpeg failure.
    Uses a temp file to avoid piping large blobs (ffmpeg stdin/stdout can be
    unreliable for webm demuxers that need seekable input).
    """
    # Determine input file extension from mime
    base = _normalise_mime(source_mime)
    ext_map = {
        "audio/webm": ".webm",
        "audio/mp4":  ".mp4",
        "audio/mpeg": ".mp3",
    }
    in_ext = ext_map.get(base, ".audio")

    # Pre-initialise to None so `finally` can safely reference them even if
    # temp-file creation fails before in_path / out_path are assigned (P1#4).
    in_path: str | None = None
    out_path: str | None = None

    try:
        with tempfile.NamedTemporaryFile(suffix=in_ext, delete=False) as in_f:
            in_f.write(audio_bytes)
            in_path = in_f.name

        out_path = in_path + ".ogg"

        cmd = [
            "ffmpeg",
            "-y",                  # overwrite output
            "-i", in_path,         # input
            "-vn",                 # no video
            "-acodec", "libopus",  # opus codec inside ogg
            "-b:a", "48k",         # 48 kbps — sufficient for speech
            "-ar", "16000",        # 16 kHz — matches STT optimal rate
            "-ac", "1",            # mono
            out_path,
        ]

        result = subprocess.run(
            cmd,
            capture_output=True,
            timeout=30,            # hard timeout for transcode
        )

        if result.returncode != 0:
            logger.warning(
                "ffmpeg transcode failed (rc=%d): %s",
                result.returncode,
                result.stderr[-500:].decode("utf-8", errors="replace"),
            )
            return None

        with open(out_path, "rb") as out_f:
            return out_f.read()

    except subprocess.TimeoutExpired:
        logger.warning("ffmpeg transcode timed out for mime=%s", source_mime)
        return None
    except Exception as exc:
        logger.warning("ffmpeg transcode error: %s", exc)
        return None
    finally:
        # in_path / out_path may still be None if temp creation raised before assignment.
        for path in [in_path, out_path]:
            if path is None:
                continue
            try:
                if os.path.exists(path):
                    os.unlink(path)
            except OSError:
                pass


async def transcribe_reading_audio(
    audio_bytes: bytes,
    mime_type: str,
    target_text: str,
    duration_ms: int | None = None,
) -> dict:
    """Call Gemini audio API to transcribe a student reading.

    Args:
        audio_bytes: Raw audio bytes from browser MediaRecorder.
        mime_type:   MIME type of the audio (e.g. "audio/webm;codecs=opus").
        target_text: The original lesson text used as a transcription hint
                     (Gemini uses it to resolve homophones and specialised names).
        duration_ms: Recorded duration in milliseconds (informational only).

    Returns:
        On success:
            {"transcript": "<text with punctuation>", "method": "gemini", "reasoning": "..."}
        On any failure (transcode failure, Gemini error, timeout, content filter):
            {"transcript": None, "method": "fallback", "reason": "<timeout|safety|decode|empty|error>"}
            Caller must show fallback alert and use Web Speech transcript — never auto-pass.
    """
    from google import genai  # noqa: PLC0415 — lazy import; not available in test envs
    from google.genai import types as genai_types  # noqa: PLC0415

    from .ai.gemini_client import GEMINI_TIMEOUT
    from .llm_models import get_model_for_task

    # ── 0. Deterministic silence gate (Issue #2368) ───────────────────────────
    # Gemini parrots the FULL reference text on silent audio (it gets target_text
    # as a hint); the length-based hallucination gate below only catches SHORT
    # prefixes, so a full parrot would pass as a false ~100%.  Reject effectively
    # silent audio here — before transcode + STT — independent of Gemini.
    max_db = await asyncio.to_thread(_max_volume_db, audio_bytes, mime_type)
    if max_db is not None and max_db < _SILENT_MAX_VOLUME_DB:
        logger.warning(
            "Reading transcription fallback — silent audio: max_volume=%.1f dB "
            "(< %.1f) duration_ms=%s",
            max_db,
            _SILENT_MAX_VOLUME_DB,
            duration_ms,
            extra={
                "event": "reading_transcribe_fallback",
                "reason": _REASON_SILENT,
                "max_volume_db": max_db,
                "duration_ms": duration_ms,
            },
        )
        return {"transcript": None, "method": "fallback", "reason": _REASON_SILENT}

    # ── 1. Transcode if Gemini doesn't natively support the input MIME ─────────
    gemini_audio_bytes = audio_bytes
    gemini_mime = "audio/ogg"  # default after transcode

    if _needs_transcode(mime_type):
        transcoded = await asyncio.to_thread(_transcode_to_ogg, audio_bytes, mime_type)
        if transcoded is None:
            logger.warning(
                "Reading transcription fallback — transcode failed: mime=%s duration_ms=%s",
                mime_type,
                duration_ms,
                extra={
                    "event": "reading_transcribe_fallback",
                    "reason": _REASON_TRANSCODE,
                    "mime_type": mime_type,
                    "duration_ms": duration_ms,
                },
            )
            return {"transcript": None, "method": "fallback", "reason": _REASON_TRANSCODE}
        gemini_audio_bytes = transcoded
        gemini_mime = "audio/ogg"
    else:
        gemini_mime = _normalise_mime(mime_type)

    # ── 2. Call Gemini ──────────────────────────────────────────────────────────
    model, location = get_model_for_task("reading_transcribe")
    client = genai.Client(vertexai=True, project="lingoleap-dev", location=location)

    system_prompt = (
        "你是一個繁體中文語音轉錄系統，專門轉錄台灣國小至國中學生的朗讀音檔。\n"
        "任務：將學生朗讀的音檔逐字轉錄成繁體中文文字，並加入正確標點符號。\n"
        "規則：\n"
        "1. 課文原文（reference text）只用於校正同音字、近音字——"
        "嚴禁直接把課文原文當成轉錄結果輸出。\n"
        "2. 輸出必須忠實反映學生實際唸出的字（不要補字、不要修正未唸出的字、"
        "不要把沒聽到的句子補進來）。\n"
        "3. 在 transcript 中加入中文標點（。，！？……）。\n"
        "4. reasoning 欄位寫 1-2 句說明你如何處理難以辨認的部分（供教師稽核）。\n"
        "5. 若音檔中沒有清晰可辨的人聲朗讀（靜音、環境雜音、白噪音、音樂、"
        "只有單一音調或喇叭聲），transcript 必須回傳空字串 ''，"
        "且 reasoning 註明「未偵測到人聲朗讀」——此時絕對不可輸出任何課文原文內容。\n"
        "6. 只在你真的聽到學生唸出對應字句時，才把那些字寫進 transcript。\n"
        "回傳格式：JSON {\"transcript\": \"...\", \"reasoning\": \"...\"}"
    )

    user_prompt = f"課文原文（供校正參考）：\n{target_text}"

    audio_part = genai_types.Part.from_bytes(
        data=gemini_audio_bytes,
        mime_type=gemini_mime,
    )
    text_part = genai_types.Part(text=user_prompt)

    contents = [
        genai_types.Content(
            role="user",
            parts=[audio_part, text_part],
        )
    ]

    response_schema = {
        "type": "object",
        "properties": {
            "transcript": {"type": "string"},
            "reasoning":  {"type": "string"},
        },
        "required": ["transcript", "reasoning"],
    }

    try:
        response = await asyncio.wait_for(
            asyncio.to_thread(
                client.models.generate_content,
                model=model,
                contents=contents,
                config=genai_types.GenerateContentConfig(
                    system_instruction=system_prompt,
                    response_mime_type="application/json",
                    response_schema=response_schema,
                    max_output_tokens=1024,
                    temperature=0.1,  # low temp for transcription accuracy
                    thinking_config=genai_types.ThinkingConfig(thinking_budget=0),
                    automatic_function_calling=genai_types.AutomaticFunctionCallingConfig(
                        disable=True
                    ),
                ),
            ),
            timeout=GEMINI_TIMEOUT,
        )

        _check_safety_filter(response)

        import json as _json
        raw = response.text
        parsed = _json.loads(raw)

        transcript = parsed.get("transcript", "")
        reasoning = parsed.get("reasoning", "")

        # Empty transcript from Gemini → treat as fallback (I5: never auto-pass)
        if not transcript:
            logger.warning(
                "Reading transcription fallback — Gemini returned empty transcript: "
                "duration_ms=%s",
                duration_ms,
                extra={
                    "event": "reading_transcribe_fallback",
                    "reason": _REASON_EMPTY,
                    "duration_ms": duration_ms,
                },
            )
            return {"transcript": None, "method": "fallback", "reason": _REASON_EMPTY}

        # Issue #2321 — Hallucination post-check.
        # Gemini was given the full lesson text as a homophone-correction hint.
        # On silent/noisy audio it sometimes "hallucinates" the opening 2–3
        # sentences of that hint text back as the transcript.  The result is a
        # non-empty, near-perfect prefix of the target — bypassing the empty
        # guard above and causing a false-positive pass when scored.
        #
        # Detection: transcript is suspiciously short AND is a near-exact
        # prefix of the target.  Real partial reads rarely satisfy both
        # (students make errors; hallucinations come out clean).
        if _is_hallucination_transcript(transcript, target_text):
            logger.warning(
                "Reading transcription hallucination detected — treating as fallback: "
                "duration_ms=%s transcript_len=%d target_len=%d (Issue #2321)",
                duration_ms,
                len(transcript),
                len(target_text),
                extra={
                    "event": "reading_transcribe_fallback",
                    "reason": _REASON_HALLUCINATION,
                    "duration_ms": duration_ms,
                    "transcript_len": len(transcript),
                    "target_len": len(target_text),
                },
            )
            return {"transcript": None, "method": "fallback", "reason": _REASON_HALLUCINATION}

        logger.info(
            "Reading transcription success: duration_ms=%s transcript_len=%d",
            duration_ms,
            len(transcript),
            extra={"event": "reading_transcribe_success", "duration_ms": duration_ms},
        )

        return {"transcript": transcript, "method": "gemini", "reasoning": reasoning}

    except TimeoutError:
        logger.warning(
            "Reading transcription fallback — timeout: duration_ms=%s",
            duration_ms,
            extra={
                "event": "reading_transcribe_fallback",
                "reason": _REASON_TIMEOUT,
                "duration_ms": duration_ms,
            },
        )
        return {"transcript": None, "method": "fallback", "reason": _REASON_TIMEOUT}

    except Exception as exc:
        # Classify the reason for monitoring / alerting
        exc_str = str(exc).lower()
        if "safety" in exc_str or "filter" in exc_str or "block" in exc_str:
            reason = _REASON_SAFETY
        else:
            reason = _REASON_ERROR

        logger.warning(
            "Reading transcription fallback — %s: %s (duration_ms=%s)",
            reason,
            exc,
            duration_ms,
            extra={
                "event": "reading_transcribe_fallback",
                "reason": reason,
                "error": str(exc),
                "duration_ms": duration_ms,
            },
        )
        return {"transcript": None, "method": "fallback", "reason": reason}
