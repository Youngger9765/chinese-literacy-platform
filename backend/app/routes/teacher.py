"""
Teacher Dashboard API — classroom overview and student learning progress.
"""
import csv
import io
import logging
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from sqlalchemy import func
from sqlalchemy.orm import Session

from ..auth.dependencies import get_current_user
from ..database import get_db
from ..models.school import Classroom, ClassroomStudent, ClassroomText
from ..models.session import LearningSession
from ..models.user import User
from ..services.lesson_loader import get_lesson_by_id
from .classrooms import _get_classroom_or_404, _require_owner_or_admin

router = APIRouter(tags=["teacher"])
logger = logging.getLogger(__name__)


# ── Schemas ──────────────────────────────────────────────────────────────────


class TeacherClassroomResponse(BaseModel):
    id: int
    name: str
    school_id: int
    grade: int | None
    is_active: bool
    created_at: datetime
    student_count: int
    assigned_text_count: int

    model_config = {"from_attributes": True}


class StudentProgressResponse(BaseModel):
    student_id: int
    student_name: str
    last_session_date: datetime | None
    last_text_title: str | None
    total_sessions: int

    model_config = {"from_attributes": True}


class ClassroomStatsResponse(BaseModel):
    total_students: int
    total_sessions: int
    active_students: int
    inactive_students: int

    model_config = {"from_attributes": True}


class StudentSessionResponse(BaseModel):
    id: int
    story_title: str | None
    started_at: datetime
    completed_at: datetime | None
    overall_score: float | None
    status: str

    model_config = {"from_attributes": True}


# ── Endpoints ────────────────────────────────────────────────────────────────


@router.get(
    "/teacher/classrooms",
    response_model=list[TeacherClassroomResponse],
)
def list_teacher_classrooms(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """List classrooms owned by the current teacher, with student and text counts."""
    classrooms = (
        db.query(Classroom)
        .filter(Classroom.teacher_id == current_user.id)
        .order_by(Classroom.created_at.desc())
        .all()
    )

    if not classrooms:
        return []

    classroom_ids = [c.id for c in classrooms]

    # Batch count queries to avoid N+1
    student_counts = dict(
        db.query(ClassroomStudent.classroom_id, func.count(ClassroomStudent.id))
        .filter(ClassroomStudent.classroom_id.in_(classroom_ids))
        .group_by(ClassroomStudent.classroom_id)
        .all()
    )
    text_counts = dict(
        db.query(ClassroomText.classroom_id, func.count(ClassroomText.id))
        .filter(ClassroomText.classroom_id.in_(classroom_ids))
        .group_by(ClassroomText.classroom_id)
        .all()
    )

    return [
        TeacherClassroomResponse(
            id=c.id,
            name=c.name,
            school_id=c.school_id,
            grade=c.grade,
            is_active=c.is_active,
            created_at=c.created_at,
            student_count=student_counts.get(c.id, 0),
            assigned_text_count=text_counts.get(c.id, 0),
        )
        for c in classrooms
    ]


@router.get(
    "/teacher/classrooms/{classroom_id}/progress",
    response_model=list[StudentProgressResponse],
)
def get_classroom_progress(
    classroom_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Get learning progress for all students in a classroom."""
    classroom = _get_classroom_or_404(classroom_id, db)
    _require_owner_or_admin(classroom, current_user, db)

    # Get all students in the classroom
    enrollments = (
        db.query(ClassroomStudent)
        .filter(ClassroomStudent.classroom_id == classroom_id)
        .all()
    )

    results = []
    for enrollment in enrollments:
        student = enrollment.student

        # Get total session count for this student
        total_sessions = (
            db.query(func.count(LearningSession.id))
            .filter(LearningSession.student_id == student.id)
            .scalar()
        )

        # Get the most recent session for this student
        latest_session = (
            db.query(LearningSession)
            .filter(LearningSession.student_id == student.id)
            .order_by(LearningSession.started_at.desc())
            .first()
        )

        last_session_date = None
        last_text_title = None
        if latest_session:
            last_session_date = latest_session.started_at
            # Try to resolve title from story_slug (lesson_number)
            if latest_session.story_slug:
                try:
                    story = get_lesson_by_id(int(latest_session.story_slug))
                    if story:
                        last_text_title = story["title"]
                except (ValueError, TypeError):
                    last_text_title = latest_session.story_slug

        results.append(
            StudentProgressResponse(
                student_id=student.id,
                student_name=student.name,
                last_session_date=last_session_date,
                last_text_title=last_text_title,
                total_sessions=total_sessions,
            )
        )

    return results


@router.get(
    "/teacher/classrooms/{classroom_id}/stats",
    response_model=ClassroomStatsResponse,
)
def get_classroom_stats(
    classroom_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Get aggregate statistics for a classroom."""
    classroom = _get_classroom_or_404(classroom_id, db)
    _require_owner_or_admin(classroom, current_user, db)

    # Get all student IDs in this classroom
    student_ids = [
        row[0]
        for row in db.query(ClassroomStudent.student_id)
        .filter(ClassroomStudent.classroom_id == classroom_id)
        .all()
    ]
    total_students = len(student_ids)

    if not student_ids:
        return ClassroomStatsResponse(
            total_students=0,
            total_sessions=0,
            active_students=0,
            inactive_students=0,
        )

    # Count total sessions for these students
    total_sessions = (
        db.query(func.count(LearningSession.id))
        .filter(LearningSession.student_id.in_(student_ids))
        .scalar()
    )

    # Active students = those with a session in the last 30 days
    thirty_days_ago = datetime.now(timezone.utc) - timedelta(days=30)
    active_student_ids = (
        db.query(LearningSession.student_id)
        .filter(
            LearningSession.student_id.in_(student_ids),
            LearningSession.started_at >= thirty_days_ago,
        )
        .distinct()
        .all()
    )
    active_students = len(active_student_ids)

    return ClassroomStatsResponse(
        total_students=total_students,
        total_sessions=total_sessions,
        active_students=active_students,
        inactive_students=total_students - active_students,
    )


@router.get(
    "/teacher/students/{student_id}/sessions",
    response_model=list[StudentSessionResponse],
)
def get_student_sessions(
    student_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Get session history for a specific student. Teacher must own a classroom containing this student."""
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

    sessions = (
        db.query(LearningSession)
        .filter(LearningSession.student_id == student_id)
        .order_by(LearningSession.started_at.desc())
        .all()
    )

    results = []
    for session in sessions:
        story_title = None
        if session.story_slug:
            try:
                story = get_lesson_by_id(int(session.story_slug))
                if story:
                    story_title = story["title"]
            except (ValueError, TypeError):
                story_title = session.story_slug

        results.append(
            StudentSessionResponse(
                id=session.id,
                story_title=story_title,
                started_at=session.started_at,
                completed_at=session.completed_at,
                overall_score=session.overall_score,
                status=session.status,
            )
        )

    return results


def _sanitize_csv_cell(value: str) -> str:
    """Prevent CSV formula injection by prefixing dangerous leading characters."""
    if isinstance(value, str) and value and value[0] in ("=", "+", "-", "@", "\t", "\r"):
        return "'" + value
    return value


@router.get("/teacher/classrooms/{classroom_id}/export")
def export_classroom_report(
    classroom_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Export classroom student progress as a UTF-8 BOM CSV file."""
    classroom = _get_classroom_or_404(classroom_id, db)
    _require_owner_or_admin(classroom, current_user, db)

    enrollments = (
        db.query(ClassroomStudent)
        .filter(ClassroomStudent.classroom_id == classroom_id)
        .all()
    )

    # Batch-load all sessions for students in this classroom to avoid N+1 queries
    student_ids = [e.student_id for e in enrollments]
    all_sessions = (
        db.query(LearningSession)
        .filter(LearningSession.student_id.in_(student_ids))
        .all()
        if student_ids
        else []
    )
    # Group sessions by student_id in Python
    sessions_by_student: dict[int, list] = {}
    for s in all_sessions:
        sessions_by_student.setdefault(s.student_id, []).append(s)

    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow(["學生姓名", "已完成課文數", "平均正確率", "總學習次數", "最近學習日期"])

    for enrollment in enrollments:
        student = enrollment.student
        sessions = sessions_by_student.get(student.id, [])

        total_sessions = len(sessions)
        completed_sessions = [s for s in sessions if s.status == "completed"]
        completed_texts = len({s.story_slug for s in completed_sessions if s.story_slug})

        scores = [s.accuracy for s in sessions if s.accuracy is not None]
        avg_accuracy = f"{sum(scores) / len(scores):.1f}%" if scores else ""

        latest = max(sessions, key=lambda s: s.started_at, default=None)
        last_date = latest.started_at.strftime("%Y-%m-%d") if latest else ""

        writer.writerow([
            _sanitize_csv_cell(student.name),
            completed_texts,
            avg_accuracy,
            total_sessions,
            last_date,
        ])

    csv_content = output.getvalue()
    output.close()

    filename = f"classroom-{classroom_id}-report-{datetime.now().strftime('%Y%m%d')}.csv"
    # utf-8-sig encoding adds the UTF-8 BOM (EF BB BF) — do NOT write \ufeff manually
    return StreamingResponse(
        iter([csv_content.encode("utf-8-sig")]),
        media_type="text/csv; charset=UTF-8",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )
