"""Teacher student management endpoints: sessions, dialogue, tags, learning curve, stuck overview."""
import logging

from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from sqlalchemy.orm import Session, joinedload

from ...auth.dependencies import get_current_user
from ...auth.rate_limiter import ai_limit_5_per_min
from ...database import get_db
from ...dependencies.tenant import _check_classroom_access
from ...models.school import Classroom, ClassroomStudent
from ...models.session import DialogueTurn, LearningSession
from ...models.student_tag import StudentTag
from ...models.user import User
from ...services.audit_logger import AuditAction, audit_log_endpoint
from ...services.input_sanitizer import sanitize_ai_input
from ...services.lesson_loader import get_lesson_by_id
from ...services.stuck_detection_service import build_recommendations, detect_stuck_points
from .teacher_schemas import (
    AddTagRequest,
    AICommentResponse,
    ClassroomStuckResponse,
    LearningCurvePoint,
    LearningCurveResponse,
    StudentSessionResponse,
    StudentStuckSummary,
    TagResponse,
    TeacherCommentRequest,
    TeacherCommentResponse,
    TeacherDialogueHistoryResponse,
    TeacherDialogueTurnResponse,
    TeacherSessionReportResponse,
)

router = APIRouter(tags=["teacher"])
logger = logging.getLogger(__name__)


def _require_teacher_owns_student(
    teacher_id: int, student_id: int, db: Session
) -> None:
    """Raise 403 if the teacher does not own any classroom that contains this student."""
    enrollment = (
        db.query(ClassroomStudent)
        .join(Classroom, ClassroomStudent.classroom_id == Classroom.id)
        .filter(
            ClassroomStudent.student_id == student_id,
            Classroom.teacher_id == teacher_id,
        )
        .first()
    )
    if not enrollment:
        raise HTTPException(
            status_code=403,
            detail="Not authorized to manage tags for this student",
        )


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
    # Verify teacher owns a classroom containing this student
    enrollment = (
        db.query(ClassroomStudent)
        .join(Classroom, ClassroomStudent.classroom_id == Classroom.id)
        .filter(
            ClassroomStudent.student_id == student_id,
            Classroom.teacher_id == current_user.id,
        )
        .first()
    )
    if not enrollment:
        raise HTTPException(status_code=403, detail="Not authorized to view this student's sessions")

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
        story_title = None
        if s.story_slug:
            try:
                story = get_lesson_by_id(int(s.story_slug))
                if story:
                    story_title = story["title"]
            except (ValueError, TypeError):
                story_title = s.story_slug

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
    # Verify teacher owns a classroom containing this student
    enrollment = (
        db.query(ClassroomStudent)
        .join(Classroom, ClassroomStudent.classroom_id == Classroom.id)
        .filter(
            ClassroomStudent.student_id == student_id,
            Classroom.teacher_id == current_user.id,
        )
        .first()
    )
    if not enrollment:
        raise HTTPException(status_code=403, detail="Not authorized to view this student's sessions")

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
    "/teacher/students/{student_id}/tags",
    response_model=list[TagResponse],
)
def list_student_tags(
    student_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """List all tags for a student. Teacher must own a classroom containing this student."""
    _require_teacher_owns_student(current_user.id, student_id, db)
    tags = (
        db.query(StudentTag)
        .filter(StudentTag.student_id == student_id)
        .order_by(StudentTag.created_at)
        .all()
    )
    return tags


@router.post(
    "/teacher/students/{student_id}/tags",
    response_model=TagResponse,
    status_code=201,
)
def add_student_tag(
    student_id: int,
    payload: AddTagRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Add a tag to a student. Tag names are unique per student (UniqueConstraint)."""
    _require_teacher_owns_student(current_user.id, student_id, db)

    tag_name = payload.tag_name.strip()
    if not tag_name:
        raise HTTPException(status_code=422, detail="tag_name must not be blank")
    # Sanitize tag name to prevent injection
    tag_name, _ = sanitize_ai_input(tag_name, user_id=str(current_user.id))
    if len(tag_name) > 50:
        raise HTTPException(status_code=422, detail="tag_name must be 50 characters or fewer")

    # Check for duplicate
    existing = (
        db.query(StudentTag)
        .filter(
            StudentTag.student_id == student_id,
            StudentTag.tag_name == tag_name,
        )
        .first()
    )
    if existing:
        raise HTTPException(status_code=409, detail="Tag already exists for this student")

    tag = StudentTag(
        student_id=student_id,
        teacher_id=current_user.id,
        tag_name=tag_name,
        color=payload.color,
    )
    db.add(tag)
    db.commit()
    db.refresh(tag)
    return tag


@router.delete(
    "/teacher/students/{student_id}/tags/{tag_name}",
    status_code=204,
)
def remove_student_tag(
    student_id: int,
    tag_name: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Remove a tag from a student. Returns 204 on success or 404 if not found."""
    _require_teacher_owns_student(current_user.id, student_id, db)

    tag = (
        db.query(StudentTag)
        .filter(
            StudentTag.student_id == student_id,
            StudentTag.tag_name == tag_name,
        )
        .first()
    )
    if not tag:
        raise HTTPException(status_code=404, detail="Tag not found")

    db.delete(tag)
    db.commit()


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
    # Verify teacher access
    enrollment = (
        db.query(ClassroomStudent)
        .join(Classroom, ClassroomStudent.classroom_id == Classroom.id)
        .filter(
            ClassroomStudent.student_id == student_id,
            Classroom.teacher_id == current_user.id,
        )
        .first()
    )
    if not enrollment:
        raise HTTPException(status_code=403, detail="Not authorized to view this student's data")

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
        story_title = None
        if session.story_slug:
            try:
                story = get_lesson_by_id(int(session.story_slug))
                if story:
                    story_title = story["title"]
            except (ValueError, TypeError):
                story_title = session.story_slug

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


@router.get(
    "/teacher/classrooms/{classroom_id}/stuck-overview",
    response_model=ClassroomStuckResponse,
)
def get_classroom_stuck_overview(
    classroom_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Return a stuck-point overview for all students in a classroom.

    Only teachers with access to the classroom can call this.
    Returns students who have at least one stuck-point indicator.
    """
    _check_classroom_access(current_user, classroom_id, db)

    enrollments = (
        db.query(ClassroomStudent)
        .options(joinedload(ClassroomStudent.student))
        .filter(ClassroomStudent.classroom_id == classroom_id)
        .all()
    )

    summaries: list[StudentStuckSummary] = []
    for enrollment in enrollments:
        student = enrollment.student
        stuck_data = detect_stuck_points(student.id, db)

        has_stuck = (
            bool(stuck_data["story_stuck"])
            or bool(stuck_data["character_stuck"])
            or stuck_data["is_declining"]
        )
        if not has_stuck:
            continue

        recs = build_recommendations(stuck_data)
        top_rec_titles = [r["title"] for r in recs if r["type"] != "encouragement"][:2]
        top_chars = [c["character"] for c in stuck_data["character_stuck"][:3]]

        summaries.append(
            StudentStuckSummary(
                student_id=student.id,
                student_name=student.name,
                story_stuck_count=len(stuck_data["story_stuck"]),
                character_stuck_count=len(stuck_data["character_stuck"]),
                is_declining=stuck_data["is_declining"],
                top_stuck_characters=top_chars,
                top_recommendations=top_rec_titles,
            )
        )

    logger.info(
        "Stuck overview for classroom %d: %d students with stuck points",
        classroom_id,
        len(summaries),
    )
    return ClassroomStuckResponse(
        students=summaries,
        total_stuck=len(summaries),
    )


# ── Teacher Session Report + Comment (Issue #993) ────────────────────────────


def _get_session_for_teacher(
    teacher_id: int, student_id: int, session_id: int, db: Session
) -> LearningSession:
    """Fetch a session after verifying teacher authorization."""
    _require_teacher_owns_student(teacher_id, student_id, db)
    session = (
        db.query(LearningSession)
        .filter(
            LearningSession.id == session_id,
            LearningSession.student_id == student_id,
        )
        .first()
    )
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    return session


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
    from datetime import datetime, timezone

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
    story_title = None
    if session.story_slug:
        try:
            story = get_lesson_by_id(int(session.story_slug))
            if story:
                story_title = story["title"]
        except (ValueError, TypeError):
            story_title = session.story_slug

    # Resolve student name
    student = db.query(User).filter(User.id == student_id).first()
    student_name = student.name if student else "未知"

    return TeacherSessionReportResponse(
        id=session.id,
        student_id=session.student_id,
        student_name=student_name,
        story_slug=session.story_slug,
        story_title=story_title,
        status=session.status,
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
    from datetime import datetime, timezone

    session = _get_session_for_teacher(current_user.id, student_id, session_id, db)
    session.teacher_comment = body.comment
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
    story_title = ""
    if session.story_slug:
        try:
            story = get_lesson_by_id(int(session.story_slug))
            if story:
                story_title = story["title"]
        except (ValueError, TypeError):
            story_title = session.story_slug or ""

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
