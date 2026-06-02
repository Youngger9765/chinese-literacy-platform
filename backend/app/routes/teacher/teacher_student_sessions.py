"""Teacher student sessions, dialogue, and learning curve endpoints."""
import logging
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from sqlalchemy.orm import Session

from ...auth.dependencies import get_current_user
from ...auth.policies import require_student_visible_to_teacher
from ...database import get_db
from ...models.session import DialogueTurn, LearningSession
from ...models.user import User
from ...services.audit_logger import AuditAction, audit_log_endpoint
from .teacher_schemas import (
    LearningCurvePoint,
    LearningCurveResponse,
    StudentSessionResponse,
    TeacherDialogueHistoryResponse,
    TeacherDialogueTurnResponse,
)
from .teacher_student_helpers import resolve_story_title

router = APIRouter(tags=["teacher"])
logger = logging.getLogger(__name__)


@router.get(
    "/teacher/students/{student_id}/sessions",
    response_model=list[StudentSessionResponse],
)
def get_student_sessions(
    student_id: int,
    request: Request,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Get learning sessions for a specific student.

    Teacher must own a classroom that contains this student.
    """
    require_student_visible_to_teacher(student_id, current_user, db)

    audit_log_endpoint(
        request=request,
        action=AuditAction.VIEW_STUDENT,
        user_id=current_user.id,
        target_student_id=student_id,
    )

    sessions = (
        db.query(LearningSession)
        .filter(LearningSession.student_id == student_id)
        .order_by(LearningSession.started_at.desc())
        .all()
    )

    results = []
    for s in sessions:
        story_title = resolve_story_title(s.story_slug)
        results.append(
            StudentSessionResponse(
                id=s.id,
                story_title=story_title,
                started_at=s.started_at,
                completed_at=s.completed_at,
                overall_score=round(s.overall_score, 1) if s.overall_score is not None else None,
                status=s.status,
                teacher_reviewed_at=s.teacher_reviewed_at,
            )
        )

    return results


@router.get(
    "/teacher/students/{student_id}/sessions/{session_id}/dialogue",
    response_model=TeacherDialogueHistoryResponse,
)
def get_teacher_student_dialogue(
    student_id: int,
    session_id: int,
    request: Request,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Return the Socratic dialogue history for a student's learning session.

    The requesting teacher must own a classroom that contains the student.
    Returns an empty turns list if the session exists but has no recorded dialogue.
    """
    require_student_visible_to_teacher(student_id, current_user, db)

    audit_log_endpoint(
        request=request,
        action=AuditAction.VIEW_SESSION,
        user_id=current_user.id,
        target_student_id=student_id,
    )

    # Verify the session belongs to the student
    session = (
        db.query(LearningSession)
        .filter(
            LearningSession.id == session_id,
            LearningSession.student_id == student_id,
        )
        .first()
    )
    if session is None:
        raise HTTPException(status_code=404, detail="Session not found")

    turns = (
        db.query(DialogueTurn)
        .filter(DialogueTurn.learning_session_id == session_id)
        .order_by(DialogueTurn.turn_order)
        .all()
    )

    return TeacherDialogueHistoryResponse(
        session_id=session_id,
        student_id=student_id,
        story_slug=session.story_slug,
        turns=[TeacherDialogueTurnResponse.model_validate(t) for t in turns],
        total=len(turns),
    )


@router.get(
    "/teacher/students/{student_id}/learning-curve",
    response_model=LearningCurveResponse,
)
def get_student_learning_curve(
    student_id: int,
    request: Request,
    story_slug: Optional[str] = Query(None, description="Filter by a specific story_slug"),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Return time-series learning data for a student.

    Includes actual scores, CPM, accuracy, and rolling average over last 5 sessions.
    Optionally filter by story_slug to see reading progress for a specific text.
    Teacher must own a classroom containing this student.
    """
    require_student_visible_to_teacher(student_id, current_user, db)

    audit_log_endpoint(
        request=request,
        action=AuditAction.VIEW_STUDENT,
        user_id=current_user.id,
        target_student_id=student_id,
    )

    # Sessions with scores, ordered oldest first
    query = db.query(LearningSession).filter(
        LearningSession.student_id == student_id,
        LearningSession.overall_score.isnot(None),
        LearningSession.status == "completed",
    )
    if story_slug:
        query = query.filter(LearningSession.story_slug == story_slug)

    sessions = query.order_by(LearningSession.started_at.asc()).all()

    if not sessions:
        return LearningCurveResponse(data=[])

    points: list[LearningCurvePoint] = []
    for session in sessions:
        story_title = resolve_story_title(session.story_slug)

        # Extract CPM and accuracy from JSONB reading results
        cpm = None
        accuracy = None
        fr = session.full_reading_result or {}
        rr = session.reading_result or {}
        # Prefer full_reading_result, fall back to reading_result
        if fr.get("cpm") is not None:
            cpm = float(fr["cpm"])
        elif rr.get("cpm") is not None:
            cpm = float(rr["cpm"])
        if fr.get("match_rate") is not None:
            accuracy = round(float(fr["match_rate"]) * 100, 1)
        elif fr.get("accuracy") is not None:
            accuracy = round(float(fr["accuracy"]), 1)
        elif rr.get("accuracy") is not None:
            accuracy = round(float(rr["accuracy"]), 1)

        points.append(
            LearningCurvePoint(
                date=session.started_at.isoformat(),
                score=round(session.overall_score, 1),
                story_title=story_title,
                session_id=session.id,
                story_slug=session.story_slug,
                cpm=cpm,
                accuracy=accuracy,
            )
        )

    return LearningCurveResponse(data=points)
