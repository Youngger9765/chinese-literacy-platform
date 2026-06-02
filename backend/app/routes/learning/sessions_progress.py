"""Session progress routes — PATCH progress update, GET detail, GET status.

Extracted from learning_sessions.py (Issue #1955).
"""
import logging
from datetime import datetime, timezone
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from ...auth.dependencies import get_current_user
from ...database import get_db
from ...models.session import CharacterError, LearningSession
from ...models.user import User
from ...services.reading_attempt_service import snapshot_reading_result
from ...schemas.session import (
    SessionDetailResponse,
    SessionStatusResponse,
    SessionUpdateRequest,
)

router = APIRouter()
logger = logging.getLogger(__name__)


@router.get("/learning/sessions/{session_id}", response_model=SessionDetailResponse)
def get_session_detail(
    session_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Get full detail of a single learning session (must be own session)."""
    session = db.query(LearningSession).filter(LearningSession.id == session_id).first()
    if session is None:
        raise HTTPException(status_code=404, detail="Session not found")
    if session.student_id != current_user.id:
        raise HTTPException(status_code=403, detail="Not your session")
    return session


@router.get("/learning/sessions/{session_id}/status", response_model=SessionStatusResponse)
def get_session_status(
    session_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Get the resumable status of a learning session.

    Returns whether the session can be resumed, the current step, and
    whether it has been completed.  Used by the frontend to show the
    "繼續上次的學習？" prompt.
    """
    session = db.query(LearningSession).filter(LearningSession.id == session_id).first()
    if session is None:
        raise HTTPException(status_code=404, detail="Session not found")
    if session.student_id != current_user.id:
        raise HTTPException(status_code=403, detail="Not your session")

    is_completed = session.status == "completed" or session.completed_at is not None
    is_resumable = not is_completed and session.status == "in_progress"

    return SessionStatusResponse(
        id=session.id,
        story_slug=session.story_slug,
        current_step=session.current_step_derived,
        status=session.status,
        is_resumable=is_resumable,
        is_completed=is_completed,
        started_at=session.started_at,
        completed_at=session.completed_at,
    )


@router.patch("/learning/sessions/{session_id}", response_model=SessionDetailResponse)
def update_session(
    session_id: int,
    payload: SessionUpdateRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Update learning session progress (must be own session).

    When reading_result contains error_chars, automatically creates CharacterError
    rows so that the error-patterns and recommended-vocab endpoints return real data
    (Issue #248: repeated error detection).
    """
    session = db.query(LearningSession).filter(LearningSession.id == session_id).first()
    if session is None:
        raise HTTPException(status_code=404, detail="Session not found")
    if session.student_id != current_user.id:
        raise HTTPException(status_code=403, detail="Not your session")

    update_data = payload.model_dump(exclude_unset=True)
    for field, value in update_data.items():
        # DEPRECATED (#1182): silently discard writes to current_step integer column.
        if field == "current_step":
            continue
        setattr(session, field, value)

    # Auto-set completed_at when status changes to completed (Issue #1070)
    if update_data.get("status") == "completed" and session.completed_at is None:
        session.completed_at = datetime.now(timezone.utc)

    # Snapshot previous reading_result before overwrite (Issue #1183)
    if "reading_result" in update_data and update_data["reading_result"] is not None:
        snapshot_reading_result(db, session)

    # Auto-persist CharacterError records from reading_result.error_chars (Issue #248)
    if "reading_result" in update_data:
        reading_result = update_data["reading_result"] or {}
        error_chars = reading_result.get("error_chars", [])
        if isinstance(error_chars, list) and error_chars:
            db.query(CharacterError).filter(CharacterError.session_id == session_id).delete()
            for char in error_chars:
                if isinstance(char, str) and char.strip():
                    db.add(CharacterError(
                        session_id=session_id,
                        character=char.strip(),
                        error_type="reading",
                    ))
            logger.info(
                "Persisted %d CharacterError rows for session %d",
                len(error_chars), session_id,
            )

    db.commit()
    db.refresh(session)
    logger.info("Updated learning session %d: %s", session_id, list(update_data.keys()))
    return session
