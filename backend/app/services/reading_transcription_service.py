"""Gemini audio transcription service for FullReading STT upgrade (Issue #2131).

Thin proxy: accepts audio bytes + target text, returns a high-quality
transcription with punctuation using Gemini audio understanding.

Design principles:
- Backend is transcription-only; scoring stays in frontend analyzeFluency().
- Fail-closed: any exception → return {transcript: null, method: "fallback"}
  so the caller can fall back to the Web Speech transcript.
- No new DB schema: result is returned synchronously, not persisted here.
  The caller (route) may log AI usage; this service is stateless.

Supported audio MIME types (Web browser MediaRecorder output):
    audio/webm, audio/webm;codecs=opus, audio/ogg, audio/ogg;codecs=opus,
    audio/mp4, audio/mpeg, audio/wav

Limits enforced by route (not repeated here):
    - Audio bytes: ≤ 10 MB
    - Duration hint: ≤ 120 s
    - target_text: ≤ 3000 chars (≈ longest G9 lesson)
"""

from __future__ import annotations

import asyncio
import logging

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

# Allowed audio MIME types (browser MediaRecorder output).
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

# Normalise MIME type for Gemini (strip codec suffix — Gemini accepts base MIME).
def _normalise_mime(raw: str) -> str:
    """Strip codec parameter: 'audio/webm;codecs=opus' → 'audio/webm'."""
    return raw.split(";")[0].strip()


async def transcribe_reading_audio(
    audio_bytes: bytes,
    mime_type: str,
    target_text: str,
    duration_ms: int | None = None,
) -> dict:
    """Call Gemini audio API to transcribe a student reading.

    Args:
        audio_bytes: Raw audio bytes from browser MediaRecorder.
        mime_type:   MIME type of the audio (e.g. "audio/webm").
        target_text: The original lesson text used as a transcription hint
                     (Gemini uses it to resolve homophones and specialised names).
        duration_ms: Recorded duration in milliseconds (informational only).

    Returns:
        On success:
            {"transcript": "<text with punctuation>", "method": "gemini", "reasoning": "..."}
        On any failure (Gemini error, timeout, content filter):
            {"transcript": None, "method": "fallback"}
            Caller must use Web Speech transcript as fallback — never auto-pass.
    """
    from google import genai  # noqa: PLC0415 — lazy import; not available in test envs
    from google.genai import types as genai_types  # noqa: PLC0415

    from .ai.gemini_client import GEMINI_TIMEOUT
    from .llm_models import get_model_for_task

    normalised_mime = _normalise_mime(mime_type)
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
        data=audio_bytes,
        mime_type=normalised_mime,
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

        logger.info(
            "Reading transcription success: duration_ms=%s transcript_len=%d",
            duration_ms,
            len(transcript),
            extra={"event": "reading_transcribe_success", "duration_ms": duration_ms},
        )

        return {"transcript": transcript, "method": "gemini", "reasoning": reasoning}

    except TimeoutError:
        logger.warning(
            "Reading transcription timeout: duration_ms=%s", duration_ms,
            extra={"event": "reading_transcribe_timeout"},
        )
        return {"transcript": None, "method": "fallback"}

    except Exception as exc:
        logger.error(
            "Reading transcription failed: %s", exc,
            extra={"event": "reading_transcribe_error", "error": str(exc)},
        )
        return {"transcript": None, "method": "fallback"}
