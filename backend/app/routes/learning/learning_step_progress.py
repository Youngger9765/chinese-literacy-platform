"""Step Progress routes (Issue #660).

Provides two endpoints to persist and retrieve per-step learning progress
from the `step_progress` JSONB column on LearningSession.

    PUT  /api/learning/sessions/{session_id}/progress  — save
    GET  /api/learning/sessions/{session_id}/progress  — load
"""
import logging
from datetime import datetime, timezone
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from ...auth.dependencies import get_current_user
from ...database import get_db
from ...models.session import LearningSession
from ...models.user import User
from ...schemas.session import StepProgressResponse, StepProgressSaveRequest, parse_step_progress
# DEPRECATED (#1182): _STEP_KEY_TO_NUM / _MAX_STEP_NUM / _normalize_step_key were used
# to sync the integer current_step column. Sync removed; imports no longer needed here.

router = APIRouter()
logger = logging.getLogger(__name__)


def _get_owned_session(session_id: int, current_user: User, db: Session) -> LearningSession:
    """Fetch a LearningSession that belongs to the authenticated user."""
    session = db.query(LearningSession).filter(LearningSession.id == session_id).first()
    if session is None:
        raise HTTPException(status_code=404, detail="Session not found")
    if session.student_id != current_user.id:
        raise HTTPException(status_code=403, detail="Not your session")
    return session


@router.put(
    "/learning/sessions/{session_id}/progress",
    response_model=StepProgressResponse,
    summary="Save step progress for a learning session (Issue #660)",
)
def save_step_progress(
    session_id: int,
    payload: StepProgressSaveRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Persist the frontend step-progress object to the DB.

    The payload mirrors the localStorage schema:
    - current_step: active step path key
    - steps_completed: list of completed step path keys
    - step_data: dict keyed by step path containing serialised progress

    Overwrites any previously stored step_progress for this session.
    Non-completed sessions only — completed sessions are read-only.
    """
    session = _get_owned_session(session_id, current_user, db)

    # parse_step_progress logs a WARNING when the stored value is malformed
    # instead of silently discarding it (Issue #1180).
    existing_sp = parse_step_progress(
        session.step_progress,
        session_id=session_id,
        context="learning_step_progress.save_step_progress",
    )
    existing_meta: dict = dict(existing_sp.meta) if existing_sp is not None else {}
    stored_version: int | None = existing_sp.version if existing_sp is not None else None

    # Optimistic concurrency check (#1187): reject stale writes.
    # Prevents overwriting newer progress when a previous save failed and the
    # client retries with an older snapshot.
    if payload.version is not None and stored_version is not None:
        if payload.version < stored_version:
            raise HTTPException(
                status_code=409,
                detail={
                    "error": "stale_version",
                    "stored_version": stored_version,
                    "incoming_version": payload.version,
                    "message": "Incoming progress is older than stored version; refresh and retry.",
                },
            )

    # Bump version: max(stored, incoming) + 1, or start at 1 if none.
    next_version = max(
        stored_version or 0,
        payload.version or 0,
    ) + 1
    existing_meta["last_synced_at"] = datetime.now(tz=timezone.utc).isoformat()

    # Version is stored at the top level so the frontend can read it directly
    # from StepProgressData.version. __meta keeps other metadata (source, etc.).
    session.step_progress = {
        "current_step": payload.current_step,
        "steps_completed": payload.steps_completed,
        "step_data": payload.step_data,
        "version": next_version,
        "__meta": existing_meta,
    }

    # DEPRECATED (#1182): integer current_step sync removed.
    # step_progress.steps_completed is now the single source of truth;
    # session.current_step_derived computes the step number on the fly.
    # Do NOT add writes to session.current_step here.

    db.commit()
    db.refresh(session)
    logger.info(
        "Saved step_progress for session %d (user %d): current=%s completed=%d",
        session_id, current_user.id, payload.current_step, len(payload.steps_completed),
    )
    return StepProgressResponse(session_id=session.id, step_progress=session.step_progress)


@router.get(
    "/learning/sessions/{session_id}/progress",
    response_model=StepProgressResponse,
    summary="Load step progress for a learning session (Issue #660)",
)
def get_step_progress(
    session_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Return the stored step_progress for a session.

    Returns step_progress: null when no progress has been saved yet
    (frontend should fall back to localStorage in that case).
    """
    session = _get_owned_session(session_id, current_user, db)
    return StepProgressResponse(session_id=session.id, step_progress=session.step_progress)
