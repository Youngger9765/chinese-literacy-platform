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
_REASON_TRANSCODE = "decode"   # ffmpeg transcode failed
_REASON_TIMEOUT   = "timeout"
_REASON_SAFETY    = "safety"
_REASON_EMPTY     = "empty"
_REASON_ERROR     = "error"


def _normalise_mime(raw: str) -> str:
    """Strip codec parameter: 'audio/webm;codecs=opus' → 'audio/webm'."""
    return raw.split(";")[0].strip()


def _needs_transcode(mime_type: str) -> bool:
    """Return True if the MIME type is NOT natively accepted by Gemini."""
    base = _normalise_mime(mime_type)
    return base not in _GEMINI_NATIVE_AUDIO_MIMES


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
        for path in [in_path, out_path]:
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
        "1. 以提供的課文原文（reference text）為基準，校正同音字、近音字。\n"
        "2. 輸出必須忠實反映學生實際唸出的字（不要補字或修正未唸出的字）。\n"
        "3. 在 transcript 中加入中文標點（。，！？……），以課文原文為準。\n"
        "4. reasoning 欄位寫 1-2 句說明你如何處理難以辨認的部分（供教師稽核）。\n"
        "5. 若完全無法辨認（靜音或雜音），transcript 回傳空字串 ''。\n"
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
