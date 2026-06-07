from __future__ import annotations

import logging
import os
from typing import Optional

from .. import TTSError
from ..normalization import _split_sentences

logger = logging.getLogger(__name__)

TTS_VOICE = os.environ.get("TTS_VOICE", "cmn-CN-Chirp3-HD-Sulafat")
TTS_LANGUAGE_CODE = "cmn-CN"

_tts_client: Optional[object] = None


def _get_tts_client():
    global _tts_client
    if _tts_client is None:
        try:
            from google.cloud import texttospeech
            _tts_client = texttospeech.TextToSpeechClient()
            logger.info("Cloud TTS client initialised (voice=%s)", TTS_VOICE)
        except Exception as exc:
            raise TTSError(f"Failed to initialise Cloud TTS client: {exc}") from exc
    return _tts_client


def _synthesize_chunk(text: str) -> bytes:
    try:
        from google.cloud import texttospeech
        client = _get_tts_client()

        response = client.synthesize_speech(
            input=texttospeech.SynthesisInput(text=text),
            voice=texttospeech.VoiceSelectionParams(
                language_code=TTS_LANGUAGE_CODE,
                name=TTS_VOICE,
            ),
            audio_config=texttospeech.AudioConfig(
                audio_encoding=texttospeech.AudioEncoding.MP3,
                # #2082 A1: brisker pace ~260-270 字/分 (product-tunable; was 0.9)
                speaking_rate=1.05,
                pitch=0.0,
            ),
        )
    except TTSError:
        raise
    except Exception as exc:
        raise TTSError(f"Cloud TTS API error: {exc}") from exc

    audio_bytes = response.audio_content
    if not audio_bytes:
        raise TTSError("Cloud TTS returned empty audio content")
    return audio_bytes


def _synthesize_google(text: str) -> bytes:
    sentences = _split_sentences(text)
    logger.info(
        "Google TTS API call (len=%d chars, %d chunks, voice=%s)",
        len(text), len(sentences), TTS_VOICE,
    )
    chunks: list[bytes] = []
    for sentence in sentences:
        chunks.append(_synthesize_chunk(sentence))
    return b"".join(chunks)
