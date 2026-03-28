"""
TTS route — Issue #663 (synthesize) + Issue #667 (sentence mapping).

POST /api/tts/synthesize
  Body: { "text": "..." }
  Response: audio/mpeg bytes (MP3)

POST /api/tts/synthesize-sentence
  Body: { "text": "..." }
  Response: audio/mpeg bytes (MP3)
  Stores under azure/sentences/ GCS path (same as synthesize for Azure provider).

GET /api/tts/mapping/{lesson_id}
  Response: JSON sentence mapping for the lesson
  Structure:
    { "lesson_id": 1, "paragraphs": [{"index": 0, "sentences": [{"text": ..., "hash": ..., "chars": ...}]}] }

Falls back gracefully: if TTS fails (quota, auth, etc.) the frontend
is expected to fall back to Web Speech API on its own.
"""

from __future__ import annotations

import logging

from fastapi import APIRouter, HTTPException
from fastapi.responses import Response
from pydantic import BaseModel, Field

from ..services.tts_service import TTSError, build_lesson_tts_mapping, synthesize_sentence, synthesize_speech
from ..services.lesson_loader import get_lesson_by_id

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/tts", tags=["tts"])


class TTSRequest(BaseModel):
    text: str = Field(..., min_length=1, max_length=5000, description="Plain text to synthesise (zh-TW)")


@router.post("/synthesize")
def synthesize(req: TTSRequest) -> Response:
    """Synthesise *text* to MP3 audio using Azure TTS (primary) or Cloud TTS (fallback).

    Returns:
        200  audio/mpeg — MP3 bytes ready for the browser <audio> element.
        503  application/json — TTS unavailable; client should fall back
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


@router.post("/synthesize-sentence")
def synthesize_sentence_endpoint(req: TTSRequest) -> Response:
    """Synthesise a single sentence to MP3 audio (Issue #667).

    Stores audio under azure/sentences/ GCS path for sentence-level caching.
    Functionally identical to /synthesize but semantically scoped to sentences.

    Returns:
        200  audio/mpeg — MP3 bytes ready for the browser <audio> element.
        503  application/json — TTS unavailable.
    """
    try:
        audio_bytes = synthesize_sentence(req.text)
    except TTSError as exc:
        logger.warning("TTS sentence synthesis failed: %s", exc)
        return Response(
            content='{"detail": "TTS service unavailable"}',
            status_code=503,
            media_type="application/json",
        )

    return Response(
        content=audio_bytes,
        media_type="audio/mpeg",
        headers={
            "Cache-Control": "public, max-age=3600",
        },
    )


@router.get("/mapping/{lesson_id}")
def get_tts_mapping(lesson_id: int) -> dict:
    """Return sentence-level TTS mapping for a lesson (Issue #667).

    The mapping contains each paragraph split into sentences, with text,
    SHA-256 hash (for GCS path: azure/sentences/{hash}.mp3), and char count.

    Args:
        lesson_id: Integer lesson ID (e.g., 1 for L01.yml).

    Returns:
        200  application/json — mapping dict.
        404  application/json — lesson not found.

    Response shape:
        {
            "lesson_id": 1,
            "paragraphs": [
                {
                    "index": 0,
                    "sentences": [
                        {"text": "...", "hash": "sha256hex", "chars": 32}
                    ]
                }
            ]
        }
    """
    lesson = get_lesson_by_id(lesson_id)
    if lesson is None:
        raise HTTPException(status_code=404, detail=f"Lesson {lesson_id} not found")

    return build_lesson_tts_mapping(lesson)
