"""
TTS route — Issue #663.

POST /api/tts/synthesize
  Body: { "text": "..." }
  Response: audio/mpeg bytes (MP3)

Falls back gracefully: if Cloud TTS fails (quota, auth, etc.) the frontend
is expected to fall back to Web Speech API on its own.
"""

from __future__ import annotations

import logging

from fastapi import APIRouter
from fastapi.responses import Response
from pydantic import BaseModel, Field

from ..services.tts_service import TTSError, synthesize_speech

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/tts", tags=["tts"])


class TTSRequest(BaseModel):
    text: str = Field(..., min_length=1, max_length=5000, description="Plain text to synthesise (zh-TW)")


@router.post("/synthesize")
def synthesize(req: TTSRequest) -> Response:
    """Synthesise *text* to MP3 audio using Cloud TTS Neural2.

    Returns:
        200  audio/mpeg — MP3 bytes ready for the browser <audio> element.
        503  application/json — Cloud TTS unavailable; client should fall back
             to Web Speech API.
    """
    try:
        audio_bytes = synthesize_speech(req.text)
    except TTSError as exc:
        logger.warning("TTS synthesis failed: %s", exc)
        return Response(
            content='{"detail": "TTS service unavailable"}',
            status_code=503,
            media_type="application/json",
        )

    return Response(
        content=audio_bytes,
        media_type="audio/mpeg",
        headers={
            # Let the browser cache the audio for 1 hour
            "Cache-Control": "public, max-age=3600",
        },
    )
