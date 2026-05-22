from __future__ import annotations

import logging
import os
import subprocess

from .. import TTSError

logger = logging.getLogger(__name__)

GEMINI_TTS_MODEL = "gemini-3.1-flash-tts-preview"
GEMINI_TTS_VOICE = "Aoede"
GEMINI_TTS_PROMPT_PREFIX = "請使用台灣用語的繁體中文，以親切且自然的語氣朗讀以下內容："
GCP_PROJECT = os.environ.get("GCP_PROJECT", "lingoleap-dev")


def _pcm_to_mp3(pcm_data: bytes, sample_rate: int = 24000) -> bytes:
    try:
        result = subprocess.run(
            [
                "ffmpeg",
                "-f", "s16le",
                "-ar", str(sample_rate),
                "-ac", "1",
                "-i", "pipe:0",
                "-f", "mp3",
                "-q:a", "2",
                "pipe:1",
            ],
            input=pcm_data,
            capture_output=True,
            timeout=30,
        )
        if result.returncode != 0:
            raise RuntimeError(result.stderr.decode("utf-8", errors="replace"))
        mp3_bytes = result.stdout
        if not mp3_bytes:
            raise RuntimeError("ffmpeg produced empty output")
        return mp3_bytes
    except FileNotFoundError:
        logger.warning("ffmpeg not found — falling back to WAV for Gemini TTS output")
    except Exception as exc:
        logger.warning("ffmpeg PCM→MP3 failed (%s) — falling back to WAV", exc)

    import struct
    num_channels = 1
    bits_per_sample = 16
    byte_rate = sample_rate * num_channels * bits_per_sample // 8
    block_align = num_channels * bits_per_sample // 8
    data_size = len(pcm_data)
    chunk_size = 36 + data_size
    wav_header = struct.pack(
        "<4sI4s4sIHHIIHH4sI",
        b"RIFF", chunk_size, b"WAVE",
        b"fmt ", 16, 1, num_channels, sample_rate,
        byte_rate, block_align, bits_per_sample,
        b"data", data_size,
    )
    return wav_header + pcm_data


def _synthesize_gemini(text: str) -> bytes:
    try:
        import google.genai as genai
        from google.genai import types as genai_types
    except ImportError as exc:
        raise TTSError(f"google-genai SDK not installed: {exc}") from exc

    try:
        client = genai.Client(
            vertexai=True,
            project=GCP_PROJECT,
            location="us-central1",
        )
        tts_contents = GEMINI_TTS_PROMPT_PREFIX + text
        logger.info(
            "Gemini TTS API call (model=%s, voice=%s, len=%d chars incl. prompt)",
            GEMINI_TTS_MODEL, GEMINI_TTS_VOICE, len(tts_contents),
        )
        response = client.models.generate_content(
            model=GEMINI_TTS_MODEL,
            contents=tts_contents,
            config=genai_types.GenerateContentConfig(
                response_modalities=["AUDIO"],
                thinking_config=genai_types.ThinkingConfig(thinking_budget=0),
                speech_config=genai_types.SpeechConfig(
                    voice_config=genai_types.VoiceConfig(
                        prebuilt_voice_config=genai_types.PrebuiltVoiceConfig(
                            voice_name=GEMINI_TTS_VOICE,
                        ),
                    ),
                ),
            ),
        )
    except Exception as exc:
        raise TTSError(f"Gemini TTS API error: {exc}") from exc

    if not response.candidates:
        raise TTSError("Gemini TTS returned empty candidates (safety block?)")
    cand = response.candidates[0]
    if not cand.content or not cand.content.parts:
        finish_reason = getattr(cand, "finish_reason", "unknown")
        raise TTSError(
            f"Gemini TTS returned empty content (finish_reason={finish_reason})"
        )

    try:
        pcm_data = cand.content.parts[0].inline_data.data
    except (AttributeError, IndexError, TypeError) as exc:
        raise TTSError(f"Gemini TTS unexpected response structure: {exc}") from exc

    if not pcm_data:
        raise TTSError("Gemini TTS returned empty audio content")

    return _pcm_to_mp3(pcm_data)
