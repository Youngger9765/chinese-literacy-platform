"""Teacher session report, comment, and AI comment endpoints."""
import logging
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, Request
from sqlalchemy.orm import Session

from ...auth.dependencies import get_current_user
from ...auth.rate_limiter import ai_limit_5_per_min
from ...database import get_db
from ...models.user import User
from ...services.audit_logger import AuditAction, audit_log_endpoint
from ...services.input_sanitizer import sanitize_ai_input
from .teacher_schemas import (
    AICommentResponse,
    TeacherCommentRequest,
    TeacherCommentResponse,
    TeacherSessionReportResponse,
)
from .teacher_student_helpers import _get_session_for_teacher, resolve_story_title

router = APIRouter(tags=["teacher"])
logger = logging.getLogger(__name__)


@router.get(
    "/teacher/students/{student_id}/sessions/{session_id}/report",
    response_model=TeacherSessionReportResponse,
)
def get_teacher_session_report(
    student_id: int,
    session_id: int,
    request: Request,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Return full session report data for teacher review. Auto-marks as reviewed."""
    session = _get_session_for_teacher(current_user.id, student_id, session_id, db)

    # Auto-mark as reviewed on first view
    if session.teacher_reviewed_at is None:
        session.teacher_reviewed_at = datetime.now(timezone.utc)
        db.commit()
        db.refresh(session)

    audit_log_endpoint(
        request=request,
        action=AuditAction.VIEW_STUDENT,
        user_id=current_user.id,
        target_student_id=student_id,
    )

    # Resolve story title
    story_title = resolve_story_title(session.story_slug)

    # Resolve student name
    from ...models.user import User as UserModel
    student = db.query(UserModel).filter(UserModel.id == student_id).first()
    student_name = student.name if student else "未知"

    return TeacherSessionReportResponse(
        id=session.id,
        student_id=session.student_id,
        student_name=student_name,
        story_slug=session.story_slug,
        story_title=story_title,
        status=session.status,
        is_complete=session.status == "completed",  # #1911: same criterion as progress table
        accuracy=session.accuracy,
        overall_score=session.overall_score,
        reading_result=session.reading_result,
        comprehension_result=session.comprehension_result,
        vocab_result=session.vocab_result,
        full_reading_result=session.full_reading_result,
        comprehension_score=session.comprehension_score,
        literal_score=session.literal_score,
        inferential_score=session.inferential_score,
        evaluative_score=session.evaluative_score,
        comprehension_feedback=session.comprehension_feedback,
        ai_comment=session.ai_comment,
        teacher_comment=session.teacher_comment,
        teacher_reviewed_at=session.teacher_reviewed_at,
        started_at=session.started_at,
        completed_at=session.completed_at,
        step_progress=session.step_progress,
    )


@router.post(
    "/teacher/students/{student_id}/sessions/{session_id}/comment",
    response_model=TeacherCommentResponse,
)
def save_teacher_comment(
    student_id: int,
    session_id: int,
    body: TeacherCommentRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Save or update teacher comment on a learning session."""
    session = _get_session_for_teacher(current_user.id, student_id, session_id, db)
    safe_comment, _ = sanitize_ai_input(body.comment, user_id=str(current_user.id))
    session.teacher_comment = safe_comment
    if session.teacher_reviewed_at is None:
        session.teacher_reviewed_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(session)
    return TeacherCommentResponse(
        teacher_comment=session.teacher_comment,
        teacher_reviewed_at=session.teacher_reviewed_at,
    )


@router.post(
    "/teacher/students/{student_id}/sessions/{session_id}/generate-ai-comment",
    response_model=AICommentResponse,
    dependencies=[Depends(ai_limit_5_per_min)],
)
async def generate_session_ai_comment(
    student_id: int,
    session_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Generate AI comment for a session. Returns cached version if already generated.

    Rate limited: 5 requests per minute per user/IP (Issue #1254).
    """
    from ...services.ai_generation import generate_teacher_comment

    session = _get_session_for_teacher(current_user.id, student_id, session_id, db)

    # Return cached if exists
    if session.ai_comment:
        return AICommentResponse(ai_comment=session.ai_comment)

    # Gather data for AI
    story_title = resolve_story_title(session.story_slug) or ""

    error_chars = []
    for ce in session.character_errors:
        error_chars.append(ce.character)

    comment = await generate_teacher_comment(
        story_title=story_title,
        accuracy=session.accuracy,
        cpm=session.reading_result.get("cpm") if session.reading_result else None,
        error_chars=error_chars or None,
        comprehension_score=session.comprehension_score,
    )

    if comment:
        session.ai_comment = comment
        db.commit()
        db.refresh(session)

    return AICommentResponse(ai_comment=session.ai_comment or "")
