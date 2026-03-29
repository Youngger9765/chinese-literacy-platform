"""Learning Session CRUD routes.

Handles creating, listing, getting, and updating learning sessions.
"""
import logging
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from ...auth.dependencies import get_current_user
from ...database import get_db
from ...models.school import ClassroomStudent
from ...models.session import CharacterError, LearningSession
from ...models.text import Text
from ...models.user import User
from ...services.lesson_loader import get_lesson_by_id
from ...schemas.session import (
    SessionCreateRequest,
    SessionDetailResponse,
    SessionListResponse,
    SessionStatusResponse,
    SessionSummaryResponse,
    SessionUpdateRequest,
)

router = APIRouter()
logger = logging.getLogger(__name__)


@router.post("/learning/sessions", status_code=201, response_model=SessionDetailResponse)
def create_learning_session(
    payload: SessionCreateRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Create a new learning session for the authenticated student."""
    # Auto-fill classroom_id from the student's first active enrollment (if any)
    enrollment = (
        db.query(ClassroomStudent)
        .filter(ClassroomStudent.student_id == current_user.id)
        .first()
    )
    classroom_id = enrollment.classroom_id if enrollment else None

    # Resolve text_id from story_slug (supports numeric "13" or L-prefixed "L06")
    text_id = None
    if payload.story_slug:
        try:
            ln = int(payload.story_slug.lstrip("Ll"))
            text_record = db.query(Text).filter(Text.lesson_number == ln).first()
            if text_record:
                text_id = text_record.id
        except (ValueError, TypeError):
            pass

    session = LearningSession(
        student_id=current_user.id,
        story_slug=payload.story_slug,
        text_id=text_id,
        status="in_progress",
        current_step=1,
        classroom_id=classroom_id,
    )
    db.add(session)
    db.commit()
    db.refresh(session)
    logger.info(
        "Created learning session %d for user %d, story=%s",
        session.id, current_user.id, payload.story_slug,
    )
    return session


@router.get("/learning/sessions", response_model=SessionListResponse)
def list_my_sessions(
    limit: int = Query(20, ge=1, le=100),
    offset: int = Query(0, ge=0),
    status: Optional[str] = Query(
        None,
        description="Comma-separated statuses to filter by, e.g. 'in_progress' or 'completed,abandoned'",
    ),
    story_slug: Optional[str] = Query(
        None,
        description="Filter by a specific story_slug",
    ),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """List learning sessions for the authenticated student, newest first."""
    query = db.query(LearningSession).filter(
        LearningSession.student_id == current_user.id,
    )
    if status:
        statuses = [s.strip() for s in status.split(",") if s.strip()]
        if statuses:
            query = query.filter(LearningSession.status.in_(statuses))
    if story_slug:
        query = query.filter(LearningSession.story_slug == story_slug)
    total = query.count()
    items = (
        query
        .order_by(LearningSession.started_at.desc())
        .offset(offset)
        .limit(limit)
        .all()
    )
    summaries = []
    for s in items:
        summary = SessionSummaryResponse.model_validate(s)
        # Resolve human-readable title: prefer linked Text record, else look up YAML lesson
        if s.text is not None:
            summary.story_title = s.text.title
        elif s.story_slug:
            normalized = s.story_slug.lstrip("Ll")
            try:
                lesson = get_lesson_by_id(int(normalized))
                if lesson:
                    summary.story_title = lesson["title"]
            except (ValueError, TypeError):
                pass
        summaries.append(summary)
    return SessionListResponse(items=summaries, total=total)


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


@router.get("/learning/sessions/{session_id}/report", response_model=SessionDetailResponse)
def get_session_report(
    session_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Get session report (semantic alias for session detail)."""
    return get_session_detail(session_id, current_user, db)


@router.get("/learning/sessions/{session_id}/status", response_model=SessionStatusResponse)
def get_session_status(
    session_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """
    Get the resumable status of a learning session.

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
        current_step=session.current_step,
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
        setattr(session, field, value)

    # Auto-persist CharacterError records from reading_result.error_chars (Issue #248)
    if "reading_result" in update_data:
        reading_result = update_data["reading_result"] or {}
        error_chars = reading_result.get("error_chars", [])
        if isinstance(error_chars, list) and error_chars:
            # Delete any existing CharacterError rows for this session to avoid duplicates
            # when the client patches reading_result more than once.
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
