"""
TTS route — Issue #663 (synthesize) + Issue #667 (sentence mapping) + Issue #765 (regenerate).

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

POST /api/tts/regenerate
  Body: { "text": "..." }
  Deletes cached audio for the given text (L1 + GCS) then re-synthesises from scratch.
  Used to fix sentences with incorrect phoneme readings (Issue #765).
  Response: { "status": "ok", "key": "...", "gcs_deleted": [...], "bytes": N }

Falls back gracefully: if TTS fails (quota, auth, etc.) the frontend
is expected to fall back to Web Speech API on its own.
"""

from __future__ import annotations

import asyncio
import logging

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import Response
from pydantic import BaseModel, Field

from ..auth.dependencies import get_current_user, require_role
from ..auth.rate_limiter import make_ai_rate_limit_dependency, tts_rate_limit
from ..models.user import User
from ..services.tts_service import (
    TTSError,
    build_lesson_tts_mapping,
    delete_tts_cache,
    get_cached_tts,
    synthesize_sentence,
    synthesize_speech,
)
from ..services.lesson_loader import get_lesson_by_id

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/tts", tags=["tts"])


class TTSRequest(BaseModel):
    text: str = Field(..., min_length=1, max_length=5000, description="Plain text to synthesise (zh-TW)")


@router.post("/synthesize")
async def synthesize(
    req: TTSRequest,
    current_user: User = Depends(get_current_user),
) -> Response:
    """Synthesise *text* to MP3 audio using Azure TTS (primary) or Cloud TTS (fallback).

    Requires authentication (any active user).  Anonymous requests are rejected
    with 401 to prevent bill-washing attacks on the Azure/GCP TTS quota.

    Rate limiting (Issue #1808):
    - Cache check happens FIRST — a cache hit returns immediately without
      touching the rate limiter, so repeated classroom sentences are free.
    - Rate limit is keyed on user_id (not IP) — avoids entire classroom sharing
      one 30 RPM bucket when behind a school NAT.
    - Uses a dedicated ai:tts:user:{id} bucket, separate from the shared ai:
      bucket, so TTS bursts cannot starve socratic/comprehension quota.

    Runs in a thread pool via asyncio.to_thread() so the FastAPI event loop is
    not blocked during the 8–15 s remote TTS call (Azure / Google / Gemini).

    Returns:
        200  audio/mpeg — MP3 bytes ready for the browser <audio> element.
        401  application/json — not authenticated.
        429  application/json — rate limit exceeded; Retry-After header present.
        503  application/json — TTS unavailable; client should fall back
             to Web Speech API.
    """
    # Fix #3: Check L1 cache BEFORE rate limit — cached audio returns immediately
    # without burning the user's TTS quota (Issue #1808).
    cached = get_cached_tts(req.text)
    if cached is not None:
        logger.debug("TTS L1 cache hit — skipping rate limit check (user=%d)", current_user.id)
        return Response(
            content=cached,
            media_type="audio/mpeg",
            headers={"Cache-Control": "public, max-age=3600"},
        )

    # Fix #1 & #2: Rate limit keyed on user_id, dedicated ai:tts: bucket.
    rl_info = tts_rate_limit(current_user.id)
    if not rl_info.allowed:
        raise HTTPException(
            status_code=429,
            detail="TTS rate limit exceeded. Please wait before retrying.",
            headers={"Retry-After": str(rl_info.retry_after)},
        )

    try:
        audio_bytes = await asyncio.to_thread(synthesize_speech, req.text)
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
async def synthesize_sentence_endpoint(
    req: TTSRequest,
    current_user: User = Depends(get_current_user),
) -> Response:
    """Synthesise a single sentence to MP3 audio (Issue #667).

    Requires authentication (any active user).  Anonymous requests are rejected
    with 401 to prevent bill-washing attacks via the pre-generated sentence cache.

    Applies the same cache-before-rate-limit and user_id-keyed rate limiting
    as /synthesize (Issue #1808 fix).

    Stores audio under azure/sentences/ GCS path for sentence-level caching.
    Functionally identical to /synthesize but semantically scoped to sentences.
    Runs in a thread pool via asyncio.to_thread() to avoid blocking the event loop.

    Returns:
        200  audio/mpeg — MP3 bytes ready for the browser <audio> element.
        401  application/json — not authenticated.
        429  application/json — rate limit exceeded; Retry-After header present.
        503  application/json — TTS unavailable.
    """
    # Fix #3: Cache check BEFORE rate limit (Issue #1808).
    cached = get_cached_tts(req.text)
    if cached is not None:
        logger.debug("TTS L1 cache hit (sentence) — skipping rate limit (user=%d)", current_user.id)
        return Response(
            content=cached,
            media_type="audio/mpeg",
            headers={"Cache-Control": "public, max-age=3600"},
        )

    # Fix #1 & #2: Per-user TTS rate limit (Issue #1808).
    rl_info = tts_rate_limit(current_user.id)
    if not rl_info.allowed:
        raise HTTPException(
            status_code=429,
            detail="TTS rate limit exceeded. Please wait before retrying.",
            headers={"Retry-After": str(rl_info.retry_after)},
        )

    try:
        audio_bytes = await asyncio.to_thread(synthesize_sentence, req.text)
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


@router.post(
    "/regenerate",
    dependencies=[
        require_role("system_admin"),
        Depends(make_ai_rate_limit_dependency(max_requests=10, window_seconds=60)),
    ],
)
async def regenerate(req: TTSRequest) -> dict:
    """Delete cached audio for *text* and re-synthesise from scratch (Issue #765).

    Requires system_admin role.  This endpoint deletes GCS cache objects and
    triggers a fresh TTS synthesis — exposing it to non-admins would allow any
    authenticated user to wipe cached audio and exhaust the TTS quota.

    Use this endpoint when a specific sentence has a known mispronunciation
    in its cached audio (e.g. wrong tone for 喝采). The endpoint:
      1. Deletes the GCS cached file (both azure/sentences/ and tts-cache/ paths).
      2. Evicts the L1 in-memory cache entry.
      3. Calls Azure TTS (with phoneme corrections applied) to produce fresh audio.
      4. Stores the new audio in L1 + GCS.
    Runs cache deletion + synthesis in thread pool to avoid blocking the event loop.

    Returns:
        200  application/json — { "status": "ok", "key": "...", "gcs_deleted": [...], "bytes": N }
        401  application/json — not authenticated.
        403  application/json — insufficient permissions (not system_admin).
        503  application/json — TTS unavailable.
    """
    # Step 1: delete existing caches (GCS I/O — run in thread pool)
    delete_result = await asyncio.to_thread(delete_tts_cache, req.text)
    logger.info(
        "TTS regenerate: key=%s, l1=%s, gcs_deleted=%s",
        delete_result["key"][:8],
        delete_result["l1_deleted"],
        delete_result["gcs_deleted"],
    )

    # Step 2: re-synthesise (phoneme corrections in _synthesize_azure will apply)
    try:
        audio_bytes = await asyncio.to_thread(synthesize_speech, req.text)
    except TTSError as exc:
        logger.warning("TTS regenerate synthesis failed: %s", exc)
        raise HTTPException(status_code=503, detail="TTS service unavailable during regenerate")

    return {
        "status": "ok",
        "key": delete_result["key"],
        "gcs_deleted": delete_result["gcs_deleted"],
        "bytes": len(audio_bytes),
    }
