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
from ..dependencies.tenant import _check_classroom_access
from ..models.school import Classroom, ClassroomStudent, ClassroomText
from ..models.session import CharacterError, LearningSession
from ..models.student_tag import StudentTag
from ..models.user import User
from ..services.lesson_loader import get_lesson_by_id
from .classrooms import _get_classroom_or_404, _require_owner_or_admin

router = APIRouter(tags=["teacher"])
logger = logging.getLogger(__name__)


# ── Schemas ──────────────────────────────────────────────────────────────────


class TagResponse(BaseModel):
    id: int
    student_id: int
    teacher_id: int
    tag_name: str
    color: str
    created_at: datetime

    model_config = {"from_attributes": True}


class AddTagRequest(BaseModel):
    tag_name: str
    color: str = "gray"


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
    tags: list[TagResponse] = []

    model_config = {"from_attributes": True}


class ClassroomStatsResponse(BaseModel):
    total_students: int
    total_sessions: int
    active_students: int
    inactive_students: int
    avg_accuracy: float | None
    completion_rate: float
    avg_session_duration_minutes: float | None

    model_config = {"from_attributes": True}


class StudentSessionResponse(BaseModel):
    id: int
    story_title: str | None
    started_at: datetime
    completed_at: datetime | None
    overall_score: float | None
    status: str

    model_config = {"from_attributes": True}


class ErrorVocabItem(BaseModel):
    character: str
    error_type: str
    count: int
    student_count: int

    model_config = {"from_attributes": True}


class TimeStatsResponse(BaseModel):
    total_hours: float
    avg_minutes_per_session: float | None
    study_days: int
    sessions_this_week: int
    sessions_last_week: int

    model_config = {"from_attributes": True}


class HeatmapStudentEntry(BaseModel):
    id: int
    name: str

    model_config = {"from_attributes": True}


class HeatmapStoryEntry(BaseModel):
    id: str
    title: str

    model_config = {"from_attributes": True}


class HeatmapScoreEntry(BaseModel):
    student_id: int
    story_id: str
    score: float
    status: str

    model_config = {"from_attributes": True}


class HeatmapResponse(BaseModel):
    students: list[HeatmapStudentEntry]
    stories: list[HeatmapStoryEntry]
    scores: list[HeatmapScoreEntry]

    model_config = {"from_attributes": True}


class StudentAlertResponse(BaseModel):
    student_id: int
    student_name: str
    alert_type: str  # "inactive" | "low_performance" | "declining"
    detail: str
    last_session_date: datetime | None

    model_config = {"from_attributes": True}


class LearningCurvePoint(BaseModel):
    date: str  # ISO date string
    score: float
    story_title: str | None
    session_id: int

    model_config = {"from_attributes": True}


class LearningCurveResponse(BaseModel):
    data: list[LearningCurvePoint]

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
    classroom = _check_classroom_access(current_user, classroom_id, db)

    # Get all students in the classroom
    enrollments = (
        db.query(ClassroomStudent)
        .filter(ClassroomStudent.classroom_id == classroom_id)
        .all()
    )

    # Batch-load tags for all students to avoid N+1 queries
    student_ids_in_classroom = [e.student_id for e in enrollments]
    tags_by_student: dict[int, list[StudentTag]] = {}
    if student_ids_in_classroom:
        all_tags = (
            db.query(StudentTag)
            .filter(StudentTag.student_id.in_(student_ids_in_classroom))
            .all()
        )
        for tag in all_tags:
            tags_by_student.setdefault(tag.student_id, []).append(tag)

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

        student_tags = tags_by_student.get(student.id, [])
        results.append(
            StudentProgressResponse(
                student_id=student.id,
                student_name=student.name,
                last_session_date=last_session_date,
                last_text_title=last_text_title,
                total_sessions=total_sessions,
                tags=[
                    TagResponse(
                        id=t.id,
                        student_id=t.student_id,
                        teacher_id=t.teacher_id,
                        tag_name=t.tag_name,
                        color=t.color,
                        created_at=t.created_at,
                    )
                    for t in student_tags
                ],
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
    classroom = _check_classroom_access(current_user, classroom_id, db)

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
            avg_accuracy=None,
            completion_rate=0.0,
            avg_session_duration_minutes=None,
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

    # Average accuracy from completed sessions' overall_score
    avg_accuracy = (
        db.query(func.avg(LearningSession.overall_score))
        .filter(
            LearningSession.student_id.in_(student_ids),
            LearningSession.status == "completed",
            LearningSession.overall_score.isnot(None),
        )
        .scalar()
    )

    # Completion rate = completed / total
    completed_count = (
        db.query(func.count(LearningSession.id))
        .filter(
            LearningSession.student_id.in_(student_ids),
            LearningSession.status == "completed",
        )
        .scalar()
    )
    completion_rate = (completed_count / total_sessions) if total_sessions else 0.0

    # Average session duration (completed sessions with both timestamps)
    completed_sessions = (
        db.query(LearningSession)
        .filter(
            LearningSession.student_id.in_(student_ids),
            LearningSession.status == "completed",
            LearningSession.started_at.isnot(None),
            LearningSession.completed_at.isnot(None),
        )
        .all()
    )
    avg_duration = None
    if completed_sessions:
        durations = []
        for s in completed_sessions:
            delta = (s.completed_at - s.started_at).total_seconds() / 60.0
            if delta > 0:
                durations.append(delta)
        if durations:
            avg_duration = round(sum(durations) / len(durations), 1)

    return ClassroomStatsResponse(
        total_students=total_students,
        total_sessions=total_sessions,
        active_students=active_students,
        inactive_students=total_students - active_students,
        avg_accuracy=round(avg_accuracy, 1) if avg_accuracy is not None else None,
        completion_rate=round(completion_rate, 2),
        avg_session_duration_minutes=avg_duration,
    )


@router.get(
    "/teacher/classrooms/{classroom_id}/error-vocab",
    response_model=list[ErrorVocabItem],
)
def get_classroom_error_vocab(
    classroom_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Get top 20 most frequent character errors for a classroom."""
    classroom = _check_classroom_access(current_user, classroom_id, db)

    student_ids = [
        row[0]
        for row in db.query(ClassroomStudent.student_id)
        .filter(ClassroomStudent.classroom_id == classroom_id)
        .all()
    ]

    if not student_ids:
        return []

    # Query CharacterError joined through LearningSession, filtered by classroom students
    rows = (
        db.query(
            CharacterError.character,
            CharacterError.error_type,
            func.count(CharacterError.id).label("count"),
            func.count(func.distinct(LearningSession.student_id)).label("student_count"),
        )
        .join(LearningSession, CharacterError.session_id == LearningSession.id)
        .filter(LearningSession.student_id.in_(student_ids))
        .group_by(CharacterError.character, CharacterError.error_type)
        .order_by(func.count(CharacterError.id).desc())
        .limit(20)
        .all()
    )

    return [
        ErrorVocabItem(
            character=row.character,
            error_type=row.error_type,
            count=row.count,
            student_count=row.student_count,
        )
        for row in rows
    ]


@router.get(
    "/teacher/classrooms/{classroom_id}/time-stats",
    response_model=TimeStatsResponse,
)
def get_classroom_time_stats(
    classroom_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Get learning time statistics for a classroom."""
    classroom = _check_classroom_access(current_user, classroom_id, db)

    student_ids = [
        row[0]
        for row in db.query(ClassroomStudent.student_id)
        .filter(ClassroomStudent.classroom_id == classroom_id)
        .all()
    ]

    if not student_ids:
        return TimeStatsResponse(
            total_hours=0.0,
            avg_minutes_per_session=None,
            study_days=0,
            sessions_this_week=0,
            sessions_last_week=0,
        )

    # All sessions for classroom students
    sessions = (
        db.query(LearningSession)
        .filter(LearningSession.student_id.in_(student_ids))
        .all()
    )

    # Total hours and average duration from sessions with both timestamps
    total_minutes = 0.0
    duration_count = 0
    for s in sessions:
        if s.started_at and s.completed_at:
            delta = (s.completed_at - s.started_at).total_seconds() / 60.0
            if delta > 0:
                total_minutes += delta
                duration_count += 1

    total_hours = round(total_minutes / 60.0, 1)
    avg_minutes = round(total_minutes / duration_count, 1) if duration_count else None

    # Distinct study days
    study_days = len({s.started_at.date() for s in sessions if s.started_at})

    # Sessions this week and last week
    now = datetime.now(timezone.utc)
    # Monday of this week
    this_monday = (now - timedelta(days=now.weekday())).replace(
        hour=0, minute=0, second=0, microsecond=0
    )
    last_monday = this_monday - timedelta(days=7)

    def _make_aware(dt: datetime) -> datetime:
        """Ensure datetime is timezone-aware (handles SQLite naive datetimes)."""
        if dt.tzinfo is None:
            return dt.replace(tzinfo=timezone.utc)
        return dt

    sessions_this_week = sum(
        1 for s in sessions if s.started_at and _make_aware(s.started_at) >= this_monday
    )
    sessions_last_week = sum(
        1
        for s in sessions
        if s.started_at and last_monday <= _make_aware(s.started_at) < this_monday
    )

    return TimeStatsResponse(
        total_hours=total_hours,
        avg_minutes_per_session=avg_minutes,
        study_days=study_days,
        sessions_this_week=sessions_this_week,
        sessions_last_week=sessions_last_week,
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


@router.get(
    "/teacher/classrooms/{classroom_id}/alerts",
    response_model=list[StudentAlertResponse],
)
def get_classroom_alerts(
    classroom_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Detect at-risk students in a classroom.

    Alert types:
    - inactive: no sessions in last 14 days
    - low_performance: average score below 50
    - declining: score declining trend (last 3 sessions decreasing)
    """
    _check_classroom_access(current_user, classroom_id, db)

    enrollments = (
        db.query(ClassroomStudent)
        .filter(ClassroomStudent.classroom_id == classroom_id)
        .all()
    )

    if not enrollments:
        return []

    now = datetime.now(timezone.utc)
    fourteen_days_ago = now - timedelta(days=14)
    alerts: list[StudentAlertResponse] = []

    for enrollment in enrollments:
        student = enrollment.student

        # Fetch all completed sessions for this student (with a score), ordered asc
        student_sessions = (
            db.query(LearningSession)
            .filter(
                LearningSession.student_id == student.id,
                LearningSession.overall_score.isnot(None),
            )
            .order_by(LearningSession.started_at.asc())
            .all()
        )

        # Most recent session across all statuses (to determine last_session_date)
        latest_session = (
            db.query(LearningSession)
            .filter(LearningSession.student_id == student.id)
            .order_by(LearningSession.started_at.desc())
            .first()
        )
        last_session_date = latest_session.started_at if latest_session else None

        # ── Alert: inactive ──────────────────────────────────────────────────
        def _make_aware(dt: datetime) -> datetime:
            if dt.tzinfo is None:
                return dt.replace(tzinfo=timezone.utc)
            return dt

        is_inactive = last_session_date is None or _make_aware(last_session_date) < fourteen_days_ago
        if is_inactive:
            days_since = (
                int((now - _make_aware(last_session_date)).days)
                if last_session_date
                else None
            )
            detail = (
                f"已 {days_since} 天未練習" if days_since is not None else "尚未開始練習"
            )
            alerts.append(
                StudentAlertResponse(
                    student_id=student.id,
                    student_name=student.name,
                    alert_type="inactive",
                    detail=detail,
                    last_session_date=last_session_date,
                )
            )
            continue  # Skip further checks — inactive is highest priority

        scores = [s.overall_score for s in student_sessions if s.overall_score is not None]

        # ── Alert: low_performance ───────────────────────────────────────────
        if scores:
            avg_score = sum(scores) / len(scores)
            if avg_score < 50:
                alerts.append(
                    StudentAlertResponse(
                        student_id=student.id,
                        student_name=student.name,
                        alert_type="low_performance",
                        detail=f"平均分數 {avg_score:.0f} 分（低於 50 分）",
                        last_session_date=last_session_date,
                    )
                )
                continue

        # ── Alert: declining ─────────────────────────────────────────────────
        if len(scores) >= 3:
            last3 = scores[-3:]
            if last3[0] > last3[1] > last3[2]:
                alerts.append(
                    StudentAlertResponse(
                        student_id=student.id,
                        student_name=student.name,
                        alert_type="declining",
                        detail=f"最近 3 次分數持續下降：{last3[0]:.0f} → {last3[1]:.0f} → {last3[2]:.0f}",
                        last_session_date=last_session_date,
                    )
                )

    return alerts


@router.get(
    "/teacher/students/{student_id}/learning-curve",
    response_model=LearningCurveResponse,
)
def get_student_learning_curve(
    student_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Return time-series learning data for a student.

    Includes actual scores and rolling average over last 5 sessions.
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

    # Sessions with scores, ordered oldest first
    sessions = (
        db.query(LearningSession)
        .filter(
            LearningSession.student_id == student_id,
            LearningSession.overall_score.isnot(None),
            LearningSession.status == "completed",
        )
        .order_by(LearningSession.started_at.asc())
        .all()
    )

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

        points.append(
            LearningCurvePoint(
                date=session.started_at.isoformat(),
                score=round(session.overall_score, 1),
                story_title=story_title,
                session_id=session.id,
            )
        )

    return LearningCurveResponse(data=points)


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
    classroom = _check_classroom_access(current_user, classroom_id, db)

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


# ── Student Tag Endpoints ─────────────────────────────────────────────────────


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
    "/teacher/classrooms/{classroom_id}/heatmap",
    response_model=HeatmapResponse,
)
def get_classroom_heatmap(
    classroom_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Get student × story score heatmap for a classroom.

    Returns students, stories, and best scores per (student, story) pair.
    """
    _check_classroom_access(current_user, classroom_id, db)

    # Get all student IDs in this classroom
    enrollments = (
        db.query(ClassroomStudent)
        .filter(ClassroomStudent.classroom_id == classroom_id)
        .all()
    )

    if not enrollments:
        return HeatmapResponse(students=[], stories=[], scores=[])

    student_ids = [e.student_id for e in enrollments]
    students_map = {e.student_id: e.student for e in enrollments}

    # Query all sessions for classroom students with a story_slug and score
    sessions = (
        db.query(LearningSession)
        .filter(
            LearningSession.student_id.in_(student_ids),
            LearningSession.story_slug.isnot(None),
        )
        .all()
    )

    # Build best-score map: (student_id, story_slug) → best session
    best_score_map: dict[tuple[int, str], LearningSession] = {}
    for sess in sessions:
        key = (sess.student_id, sess.story_slug)
        existing = best_score_map.get(key)
        if existing is None:
            best_score_map[key] = sess
        else:
            # Prefer completed sessions; among same status, prefer higher score
            existing_score = existing.overall_score or 0.0
            new_score = sess.overall_score or 0.0
            if sess.status == "completed" and existing.status != "completed":
                best_score_map[key] = sess
            elif sess.status == existing.status and new_score > existing_score:
                best_score_map[key] = sess

    # Collect unique story slugs and resolve titles
    unique_story_slugs: list[str] = sorted(
        {slug for _, slug in best_score_map.keys()}
    )

    stories: list[HeatmapStoryEntry] = []
    for slug in unique_story_slugs:
        title = slug
        try:
            story = get_lesson_by_id(int(slug))
            if story:
                title = story["title"]
        except (ValueError, TypeError):
            title = slug
        stories.append(HeatmapStoryEntry(id=slug, title=title))

    # Build student list in enrollment order
    heatmap_students = [
        HeatmapStudentEntry(id=s_id, name=students_map[s_id].name)
        for s_id in student_ids
    ]

    # Build score entries
    score_entries: list[HeatmapScoreEntry] = []
    for (s_id, slug), sess in best_score_map.items():
        score = round(sess.overall_score, 1) if sess.overall_score is not None else 0.0
        score_entries.append(
            HeatmapScoreEntry(
                student_id=s_id,
                story_id=slug,
                score=score,
                status=sess.status,
            )
        )

    return HeatmapResponse(
        students=heatmap_students,
        stories=stories,
        scores=score_entries,
    )
