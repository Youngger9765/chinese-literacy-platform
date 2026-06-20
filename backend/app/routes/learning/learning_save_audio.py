"""POST /reading/save-audio — deferred GCS upload for accepted reading takes (Issue #2297).

Design rationale (Issue #2297):
  Previously, audio was uploaded to GCS inside /reading/transcribe at STT time.
  This caused orphaned blobs whenever a student re-recorded, abandoned, or hit an
  STT error — the audio was already in GCS with no corresponding accepted score.

  New flow:
    1. Student records → POST /reading/transcribe  (STT only, NO GCS upload)
    2. Frontend receives score and shows result to student
    3. Student accepts (does NOT re-record) → frontend calls POST /reading/save-audio
       with the same audio blob + session_id
    4. This endpoint performs the GCS upload and writes audio_gcs_path to the DB

  Result:  only accepted takes ever reach GCS.

Security:
  - session_id ownership is checked (IDOR prevention).
  - Bucket is private; no public ACL is set here.
  - Upload failure returns {"ok": false} — NEVER raises (non-fatal).
"""
from __future__ import annotations

import logging

from fastapi import APIRouter, Depends, File, Form, UploadFile
from pydantic import BaseModel
from sqlalchemy.orm import Session

from ...auth.dependencies import get_current_user
from ...auth.rate_limiter import ai_limit_10_per_min
from ...database import get_db
from ...models.session import LearningSession, ReadingAttemptHistory
from ...models.user import User
from ...services.audio_upload_service import upload_reading_audio_to_gcs_sync

router = APIRouter()
logger = logging.getLogger(__name__)

# Re-use the same MIME → extension map as the service layer.
_MIME_TO_EXT: dict[str, str] = {
    "audio/webm": ".webm",
    "audio/mp4": ".mp4",
    "audio/mpeg": ".mp3",
    "audio/ogg": ".ogg",
    "audio/wav": ".wav",
    "audio/x-wav": ".wav",
}

_MAX_AUDIO_BYTES = 10 * 1024 * 1024  # 10 MB


def _normalise_mime(mime_type: str) -> str:
    """Strip codec suffix: 'audio/webm;codecs=opus' → 'audio/webm'."""
    return mime_type.split(";")[0].strip()


class SaveAudioResponse(BaseModel):
    ok: bool
    audio_gcs_path: str | None = None
    reason: str | None = None


@router.post(
    "/reading/save-audio",
    response_model=SaveAudioResponse,
    dependencies=[Depends(ai_limit_10_per_min)],
    summary="Upload accepted reading take audio to GCS (Issue #2297)",
    description=(
        "Called by the frontend AFTER the student accepts a reading score.\n"
        "Uploads the audio blob to GCS and writes the path to the latest\n"
        "ReadingAttemptHistory row for this session.\n\n"
        "Upload failure returns {ok: false} — never raises (non-fatal).\n"
        "IDOR: session must belong to current_user.\n"
        "Audio: ≤10 MB; MIME: audio/webm, audio/mp4, audio/ogg, audio/wav, audio/mpeg."
    ),
)
async def save_reading_audio(
    audio: UploadFile = File(
        ...,
        description="Audio blob from browser MediaRecorder (the same blob as used for transcription)",
    ),
    session_id: int = Form(
        ...,
        description="DB LearningSession id — used to locate the ReadingAttemptHistory row",
    ),
    attempt_id: int | None = Form(
        default=None,
        description=(
            "Optional ReadingAttemptHistory id.  When provided, that specific row is "
            "updated.  When omitted, the latest row for this session is used."
        ),
    ),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> SaveAudioResponse:
    """Upload an accepted student reading take to GCS and bind it to the DB attempt row.

    Fail-safe: any upload or DB error is logged as WARNING and returns {ok: false}.
    This endpoint never raises HTTPException for upload/DB failures so a network
    hiccup cannot prevent the student from seeing their score.

    IDOR protection: the session_id must belong to current_user.  A mismatch is
    logged as WARNING and returns {ok: false} without revealing session existence.
    """
    # ── 1. Read and size-cap audio ────────────────────────────────────────────
    audio_bytes = await audio.read()
    if len(audio_bytes) == 0 or len(audio_bytes) > _MAX_AUDIO_BYTES:
        logger.warning(
            "save-audio: invalid audio size %d bytes for user=%d session=%d",
            len(audio_bytes),
            current_user.id,
            session_id,
        )
        return SaveAudioResponse(ok=False, reason="invalid_audio_size")

    # MIME: deny empty/unsupported (codex review — was fail-open to webm/.audio)
    raw_mime = audio.content_type or ""
    if _normalise_mime(raw_mime) not in _MIME_TO_EXT:
        logger.warning(
            "save-audio: unsupported MIME %r for user=%d session=%s",
            raw_mime, current_user.id, session_id,
        )
        return SaveAudioResponse(ok=False, reason="unsupported_audio_type")

    # ── 2. IDOR: verify session ownership ────────────────────────────────────
    owned_session = (
        db.query(LearningSession)
        .filter(
            LearningSession.id == session_id,
            LearningSession.student_id == current_user.id,
        )
        .first()
    )
    if owned_session is None:
        logger.warning(
            "save-audio: session_id=%d does not belong to user=%d; skipping upload",
            session_id,
            current_user.id,
        )
        return SaveAudioResponse(ok=False, reason="session_not_found")

    # ── 3. Locate the ReadingAttemptHistory row ───────────────────────────────
    if attempt_id is not None:
        attempt = (
            db.query(ReadingAttemptHistory)
            .filter(
                ReadingAttemptHistory.id == attempt_id,
                ReadingAttemptHistory.session_id == session_id,
            )
            .first()
        )
    else:
        attempt = (
            db.query(ReadingAttemptHistory)
            .filter(ReadingAttemptHistory.session_id == session_id)
            .order_by(ReadingAttemptHistory.attempt_no.desc())
            .first()
        )

    if attempt is None:
        logger.warning(
            "save-audio: no ReadingAttemptHistory for session_id=%d attempt_id=%s user=%d",
            session_id,
            attempt_id,
            current_user.id,
        )
        return SaveAudioResponse(ok=False, reason="attempt_not_found")

    # ── 4. Upload to GCS ─────────────────────────────────────────────────────
    base_mime = _normalise_mime(raw_mime)
    ext = _MIME_TO_EXT.get(base_mime, ".audio")
    blob_path = f"reading-audio/attempts/{attempt.id}{ext}"

    stored_path = upload_reading_audio_to_gcs_sync(
        audio_bytes=audio_bytes,
        mime_type=raw_mime,
        blob_path=blob_path,
    )

    if stored_path is None:
        # GCS unavailable or upload failed — fail-safe: log, return ok=False.
        logger.warning(
            "save-audio: GCS upload failed for attempt=%d session=%d user=%d",
            attempt.id,
            session_id,
            current_user.id,
        )
        return SaveAudioResponse(ok=False, reason="gcs_upload_failed")

    # ── 5. Persist path to DB ────────────────────────────────────────────────
    try:
        attempt.audio_gcs_path = stored_path
        db.commit()
        logger.info(
            "save-audio: OK attempt=%d session=%d user=%d path=%s",
            attempt.id,
            session_id,
            current_user.id,
            stored_path,
        )
        return SaveAudioResponse(ok=True, audio_gcs_path=stored_path)
    except Exception as exc:
        db.rollback()
        logger.warning(
            "save-audio: DB commit failed for attempt=%d session=%d: %s",
            attempt.id,
            session_id,
            exc,
        )
        return SaveAudioResponse(ok=False, reason="db_commit_failed")
