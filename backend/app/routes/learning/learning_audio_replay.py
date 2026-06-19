"""Student reading audio replay endpoint (Issue #2266).

GET /api/learning/sessions/{session_id}/reading-audio/{attempt_id}
  - Authorised student only (session_id owner check).
  - Looks up ReadingAttemptHistory.audio_gcs_path.
  - Returns a short-lived signed URL (10 min) for GCS playback.
  - 404 if audio_gcs_path is None (not yet uploaded).
  - 403 if session does not belong to current user.

Security:
  - Signed URL generated server-side; never stored or cached.
  - Bucket stays private — no make_public call here.
  - Only the session owner (student) can request a signed URL via this endpoint.
    Teacher access is in PR2 (teacher route with role check).
"""
from __future__ import annotations

import logging
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from ...auth.dependencies import get_current_user
from ...database import get_db
from ...models.session import LearningSession, ReadingAttemptHistory
from ...models.user import User
from ...services.audio_upload_service import generate_audio_signed_url

router = APIRouter()
logger = logging.getLogger(__name__)

_SIGNED_URL_EXPIRY = 600  # 10 minutes


class AudioReplayResponse(BaseModel):
    signed_url: str
    expires_in: int  # seconds


@router.get(
    "/learning/sessions/{session_id}/reading-audio/{attempt_id}",
    response_model=AudioReplayResponse,
    summary="Student reading audio replay signed URL (Issue #2266)",
    description=(
        "Generate a 10-minute signed URL for a student to replay their recorded "
        "reading audio.  Only the session owner (student) may call this endpoint.\n\n"
        "Returns 404 if no audio was recorded for the specified attempt.\n"
        "Returns 403 if the session does not belong to the authenticated student.\n"
        "Returns 503 if GCS signed URL generation fails.\n"
    ),
)
def get_reading_audio_signed_url(
    session_id: int,
    attempt_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> AudioReplayResponse:
    """Return a short-lived signed URL so the student can replay their audio."""
    # 1. Validate session ownership
    session = db.query(LearningSession).filter(LearningSession.id == session_id).first()
    if session is None:
        raise HTTPException(status_code=404, detail="Session not found")
    if session.student_id != current_user.id:
        raise HTTPException(status_code=403, detail="Not your session")

    # 2. Fetch the attempt
    attempt = (
        db.query(ReadingAttemptHistory)
        .filter(
            ReadingAttemptHistory.id == attempt_id,
            ReadingAttemptHistory.session_id == session_id,
        )
        .first()
    )
    if attempt is None:
        raise HTTPException(status_code=404, detail="Attempt not found")
    if not attempt.audio_gcs_path:
        raise HTTPException(status_code=404, detail="No audio recorded for this attempt")

    # 3. Generate signed URL
    signed_url = generate_audio_signed_url(
        blob_path=attempt.audio_gcs_path,
        expiration_seconds=_SIGNED_URL_EXPIRY,
    )
    if signed_url is None:
        logger.error(
            "Signed URL generation failed for attempt %d (path=%s)",
            attempt_id,
            attempt.audio_gcs_path,
        )
        raise HTTPException(status_code=503, detail="Audio replay temporarily unavailable")

    logger.info(
        "Audio signed URL issued: session=%d attempt=%d user=%d",
        session_id,
        attempt_id,
        current_user.id,
    )
    return AudioReplayResponse(signed_url=signed_url, expires_in=_SIGNED_URL_EXPIRY)
