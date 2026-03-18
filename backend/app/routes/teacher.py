"""
Teacher Dashboard API — classroom overview and student learning progress.
"""
import csv
import io
import logging
from collections import defaultdict
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from sqlalchemy import func
from sqlalchemy.orm import Session, joinedload

from ..auth.dependencies import get_current_user
from ..database import get_db
from ..dependencies.tenant import _check_classroom_access
from ..models.school import Classroom, ClassroomStudent, ClassroomText
from ..models.session import CharacterError, ErrorCorrection, LearningSession, DialogueTurn
from ..models.student_tag import StudentTag
from ..models.story_tag import StoryTag
from ..models.teacher_instruction import TeacherInstruction
from ..models.notification_read import TeacherNotificationRead
from ..models.text import Text, TextStatus, VisibilityLevel
from ..schemas.teacher_instruction import (
    VALID_INSTRUCTION_TYPES,
    InstructionCreate,
    InstructionResponse,
    InstructionUpdate,
)
from ..models.user import User
from ..models.gamification import StudentXPLog, StudentStreak
from ..services.lesson_loader import get_lesson_by_id
from ..services.stuck_detection_service import build_recommendations, detect_stuck_points
from ..services.prediction_service import predict_learning_difficulty
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


class AtRiskStudentResponse(BaseModel):
    student_id: int
    student_name: str
    risk_level: str          # "low" | "medium" | "high"
    risk_factors: list[str]
    recommended_actions: list[str]
    confidence_score: float
    supporting_data: dict

    model_config = {"from_attributes": True}


class ErrorHeatmapStudentEntry(BaseModel):
    id: int
    name: str

    model_config = {"from_attributes": True}


class ErrorHeatmapErrorEntry(BaseModel):
    student_id: int
    character: str
    error_count: int

    model_config = {"from_attributes": True}


class ErrorHeatmapResponse(BaseModel):
    """Student × character error matrix for classroom teachers."""
    students: list[ErrorHeatmapStudentEntry]
    characters: list[str]  # sorted by total error count desc
    errors: list[ErrorHeatmapErrorEntry]  # only non-zero cells

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

    # Get all students in the classroom — joinedload to avoid N+1 on enrollment.student
    enrollments = (
        db.query(ClassroomStudent)
        .options(joinedload(ClassroomStudent.student))
        .filter(ClassroomStudent.classroom_id == classroom_id)
        .all()
    )

    student_ids_in_classroom = [e.student_id for e in enrollments]

    # Batch-load tags for all students to avoid N+1 queries
    tags_by_student: dict[int, list[StudentTag]] = {}
    if student_ids_in_classroom:
        all_tags = (
            db.query(StudentTag)
            .filter(StudentTag.student_id.in_(student_ids_in_classroom))
            .all()
        )
        for tag in all_tags:
            tags_by_student.setdefault(tag.student_id, []).append(tag)

    # Batch-load session counts per student (single aggregation query, not N queries)
    session_count_rows = (
        db.query(LearningSession.student_id, func.count(LearningSession.id).label("cnt"))
        .filter(LearningSession.student_id.in_(student_ids_in_classroom))
        .group_by(LearningSession.student_id)
        .all()
        if student_ids_in_classroom else []
    )
    session_counts: dict[int, int] = {row.student_id: row.cnt for row in session_count_rows}

    # Batch-load latest session per student using a window function approach:
    # fetch all sessions ordered desc and keep only the first per student in Python.
    all_sessions_for_latest = (
        db.query(LearningSession)
        .filter(LearningSession.student_id.in_(student_ids_in_classroom))
        .order_by(LearningSession.student_id, LearningSession.started_at.desc())
        .all()
        if student_ids_in_classroom else []
    )
    latest_session_by_student: dict[int, LearningSession] = {}
    for s in all_sessions_for_latest:
        if s.student_id not in latest_session_by_student:
            latest_session_by_student[s.student_id] = s

    results = []
    for enrollment in enrollments:
        student = enrollment.student

        total_sessions = session_counts.get(student.id, 0)
        latest_session = latest_session_by_student.get(student.id)

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
    "/teacher/classrooms/{classroom_id}/error-heatmap",
    response_model=ErrorHeatmapResponse,
)
def get_classroom_error_heatmap(
    classroom_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Get student × character error matrix for a classroom.

    Returns all enrolled students, all characters that have at least one error,
    and non-zero (student, character) error counts.  Characters are ordered by
    total error count descending so the most problematic characters appear first.
    """
    _check_classroom_access(current_user, classroom_id, db)

    # Get enrolled students in enrollment order
    enrollments = (
        db.query(ClassroomStudent)
        .filter(ClassroomStudent.classroom_id == classroom_id)
        .all()
    )
    if not enrollments:
        return ErrorHeatmapResponse(students=[], characters=[], errors=[])

    student_ids = [e.student_id for e in enrollments]
    students_map = {e.student_id: e.student for e in enrollments}

    # Query aggregated error counts: (student_id, character) → count
    rows = (
        db.query(
            LearningSession.student_id,
            CharacterError.character,
            func.count(CharacterError.id).label("error_count"),
        )
        .join(CharacterError, CharacterError.session_id == LearningSession.id)
        .filter(LearningSession.student_id.in_(student_ids))
        .group_by(LearningSession.student_id, CharacterError.character)
        .all()
    )

    if not rows:
        students = [
            ErrorHeatmapStudentEntry(id=s_id, name=students_map[s_id].name)
            for s_id in student_ids
        ]
        return ErrorHeatmapResponse(students=students, characters=[], errors=[])

    # Build character → total error count for ordering
    char_totals: dict[str, int] = defaultdict(int)
    for row in rows:
        char_totals[row.character] += row.error_count

    # Sort characters by total errors descending, then alphabetically for stability
    sorted_characters = sorted(
        char_totals.keys(),
        key=lambda c: (-char_totals[c], c),
    )

    # Build student list in enrollment order
    students = [
        ErrorHeatmapStudentEntry(id=s_id, name=students_map[s_id].name)
        for s_id in student_ids
    ]

    # Build error entries (only non-zero cells)
    error_entries = [
        ErrorHeatmapErrorEntry(
            student_id=row.student_id,
            character=row.character,
            error_count=row.error_count,
        )
        for row in rows
    ]

    return ErrorHeatmapResponse(
        students=students,
        characters=sorted_characters,
        errors=error_entries,
    )


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


# ── Teacher Dialogue History (Issue #418) ─────────────────────────────────────


class TeacherDialogueTurnResponse(BaseModel):
    id: int
    turn_order: int
    role: str
    text: str
    is_correct: bool | None
    phase: str | None
    created_at: datetime

    model_config = {"from_attributes": True}


class TeacherDialogueHistoryResponse(BaseModel):
    session_id: int
    student_id: int
    story_slug: str | None
    turns: list[TeacherDialogueTurnResponse]
    total: int


@router.get(
    "/teacher/students/{student_id}/sessions/{session_id}/dialogue",
    response_model=TeacherDialogueHistoryResponse,
)
def get_teacher_student_dialogue(
    student_id: int,
    session_id: int,
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
        .options(joinedload(ClassroomStudent.student))
        .filter(ClassroomStudent.classroom_id == classroom_id)
        .all()
    )

    if not enrollments:
        return []

    student_ids = [e.student_id for e in enrollments]
    now = datetime.now(timezone.utc)
    fourteen_days_ago = now - timedelta(days=14)

    # Batch-load all scored sessions for alert analysis (single query instead of N)
    all_scored_sessions = (
        db.query(LearningSession)
        .filter(
            LearningSession.student_id.in_(student_ids),
            LearningSession.overall_score.isnot(None),
        )
        .order_by(LearningSession.student_id, LearningSession.started_at.asc())
        .all()
    )
    scored_sessions_by_student: dict[int, list[LearningSession]] = {}
    for s in all_scored_sessions:
        scored_sessions_by_student.setdefault(s.student_id, []).append(s)

    # Batch-load latest session per student (single query instead of N)
    all_sessions_ordered = (
        db.query(LearningSession)
        .filter(LearningSession.student_id.in_(student_ids))
        .order_by(LearningSession.student_id, LearningSession.started_at.desc())
        .all()
    )
    latest_session_by_student: dict[int, LearningSession] = {}
    for s in all_sessions_ordered:
        if s.student_id not in latest_session_by_student:
            latest_session_by_student[s.student_id] = s

    alerts: list[StudentAlertResponse] = []

    for enrollment in enrollments:
        student = enrollment.student

        student_sessions = scored_sessions_by_student.get(student.id, [])
        latest_session = latest_session_by_student.get(student.id)
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


@router.get(
    "/teacher/classrooms/{classroom_id}/at-risk-students",
    response_model=list[AtRiskStudentResponse],
)
def get_at_risk_students(
    classroom_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Predict which students may struggle based on early learning patterns.

    Uses a rule-based engine (Issue #254) that analyses:
    - Low accuracy on first 2-3 stories
    - High character error rate
    - Declining accuracy trend
    - Long inactivity gaps
    - Multiple stuck-points

    Returns all students in the classroom with their risk prediction.
    Only medium/high risk students are highlighted by default; the frontend
    may choose to show all or filter to at-risk only.
    """
    _check_classroom_access(current_user, classroom_id, db)

    enrollments = (
        db.query(ClassroomStudent)
        .options(joinedload(ClassroomStudent.student))
        .filter(ClassroomStudent.classroom_id == classroom_id)
        .all()
    )

    if not enrollments:
        return []

    results: list[AtRiskStudentResponse] = []
    for enrollment in enrollments:
        student = enrollment.student
        try:
            prediction = predict_learning_difficulty(student.id, db)
        except Exception:
            logger.exception("Prediction failed for student %d", student.id)
            prediction = {
                "risk_level": "low",
                "risk_factors": [],
                "recommended_actions": [],
                "confidence_score": 0.0,
                "supporting_data": {"error": "prediction_unavailable"},
            }

        results.append(
            AtRiskStudentResponse(
                student_id=student.id,
                student_name=student.name,
                risk_level=prediction["risk_level"],
                risk_factors=prediction["risk_factors"],
                recommended_actions=prediction["recommended_actions"],
                confidence_score=prediction["confidence_score"],
                supporting_data=prediction["supporting_data"],
            )
        )

    # Sort: high → medium → low, then alphabetical within same level
    order = {"high": 0, "medium": 1, "low": 2}
    results.sort(key=lambda r: (order.get(r.risk_level, 3), r.student_name))

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
    """Export classroom student progress as a UTF-8 BOM CSV file.

    Columns: 學生姓名, 已完成課文數, 平均正確率, 平均語速(CPM), 總學習次數,
             已掌握生字, 連續學習天數, 累積XP, 最近學習日期
    """
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

    # Batch-load XP totals (sum of xp_earned per student)
    xp_rows = (
        db.query(StudentXPLog.student_id, func.sum(StudentXPLog.xp_earned).label("total_xp"))
        .filter(StudentXPLog.student_id.in_(student_ids))
        .group_by(StudentXPLog.student_id)
        .all()
        if student_ids
        else []
    )
    xp_by_student: dict[int, int] = {row.student_id: int(row.total_xp) for row in xp_rows}

    # Batch-load current streaks
    streak_rows = (
        db.query(StudentStreak)
        .filter(StudentStreak.student_id.in_(student_ids))
        .all()
        if student_ids
        else []
    )
    streak_by_student: dict[int, int] = {row.student_id: row.current_streak for row in streak_rows}

    # Batch-load mastered character counts
    mastered_rows = (
        db.query(ErrorCorrection.student_id, func.count(ErrorCorrection.id).label("cnt"))
        .filter(
            ErrorCorrection.student_id.in_(student_ids),
            ErrorCorrection.correction_type == "mastered",
        )
        .group_by(ErrorCorrection.student_id)
        .all()
        if student_ids
        else []
    )
    mastered_by_student: dict[int, int] = {row.student_id: int(row.cnt) for row in mastered_rows}

    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow([
        "學生姓名",
        "已完成課文數",
        "平均正確率",
        "平均語速(CPM)",
        "總學習次數",
        "已掌握生字",
        "連續學習天數",
        "累積XP",
        "最近學習日期",
    ])

    for enrollment in enrollments:
        student = enrollment.student
        sessions = sessions_by_student.get(student.id, [])

        total_sessions = len(sessions)
        completed_sessions = [s for s in sessions if s.status == "completed"]
        completed_texts = len({s.story_slug for s in completed_sessions if s.story_slug})

        scores = [s.accuracy for s in sessions if s.accuracy is not None]
        avg_accuracy = f"{sum(scores) / len(scores):.1f}%" if scores else ""

        # Average CPM from reading_result JSONB field
        cpm_values = [
            s.reading_result["cpm"]
            for s in sessions
            if s.reading_result and isinstance(s.reading_result, dict) and s.reading_result.get("cpm") is not None
        ]
        avg_cpm = f"{sum(cpm_values) / len(cpm_values):.0f}" if cpm_values else ""

        latest = max(sessions, key=lambda s: s.started_at, default=None)
        last_date = latest.started_at.strftime("%Y-%m-%d") if latest else ""

        writer.writerow([
            _sanitize_csv_cell(student.name),
            completed_texts,
            avg_accuracy,
            avg_cpm,
            total_sessions,
            mastered_by_student.get(student.id, 0),
            streak_by_student.get(student.id, 0),
            xp_by_student.get(student.id, 0),
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


# ── Teacher Instructions (Individualized) ────────────────────────────────────


@router.post(
    "/teacher/students/{student_id}/instructions",
    status_code=201,
    response_model=InstructionResponse,
)
def create_student_instruction(
    student_id: int,
    payload: InstructionCreate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Create a special instruction for a student. Teacher must own the classroom."""
    # Validate instruction_type
    if payload.instruction_type not in VALID_INSTRUCTION_TYPES:
        raise HTTPException(
            status_code=422,
            detail=f"Invalid instruction_type. Must be one of: {', '.join(sorted(VALID_INSTRUCTION_TYPES))}",
        )

    # Verify teacher owns the classroom
    classroom = _get_classroom_or_404(payload.classroom_id, db)
    _require_owner_or_admin(classroom, current_user, db)

    # Verify student is enrolled in this classroom
    enrollment = (
        db.query(ClassroomStudent)
        .filter(
            ClassroomStudent.classroom_id == payload.classroom_id,
            ClassroomStudent.student_id == student_id,
        )
        .first()
    )
    if not enrollment:
        raise HTTPException(
            status_code=404,
            detail="Student not found in this classroom",
        )

    instruction = TeacherInstruction(
        teacher_id=current_user.id,
        student_id=student_id,
        classroom_id=payload.classroom_id,
        instruction_type=payload.instruction_type,
        content=payload.content,
    )
    db.add(instruction)
    db.commit()
    db.refresh(instruction)

    logger.info(
        "Created instruction %d for student %d in classroom %d (teacher %d)",
        instruction.id, student_id, payload.classroom_id, current_user.id,
    )
    return instruction


@router.get(
    "/teacher/students/{student_id}/instructions",
    response_model=list[InstructionResponse],
)
def list_student_instructions(
    student_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """List active instructions for a student. Teacher must own a classroom containing this student."""
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
        raise HTTPException(
            status_code=403,
            detail="Not authorized to view this student's instructions",
        )

    instructions = (
        db.query(TeacherInstruction)
        .filter(
            TeacherInstruction.student_id == student_id,
            TeacherInstruction.teacher_id == current_user.id,
            TeacherInstruction.is_active == True,  # noqa: E712
        )
        .order_by(TeacherInstruction.created_at.desc())
        .all()
    )
    return instructions


@router.get(
    "/teacher/classrooms/{classroom_id}/instruction-counts",
    response_model=dict[int, int],
)
def get_classroom_instruction_counts(
    classroom_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Get active instruction counts for all students in a classroom (bulk, avoids N+1).

    Returns a mapping of student_id -> active_instruction_count.
    Students with zero instructions are included with count 0.
    """
    classroom = _check_classroom_access(current_user, classroom_id, db)

    # Get all student IDs enrolled in this classroom
    student_ids = [
        row[0]
        for row in db.query(ClassroomStudent.student_id)
        .filter(ClassroomStudent.classroom_id == classroom.id)
        .all()
    ]

    if not student_ids:
        return {}

    # Single aggregated query: count active instructions per student
    rows = (
        db.query(
            TeacherInstruction.student_id,
            func.count(TeacherInstruction.id).label("cnt"),
        )
        .filter(
            TeacherInstruction.student_id.in_(student_ids),
            TeacherInstruction.teacher_id == current_user.id,
            TeacherInstruction.is_active == True,  # noqa: E712
        )
        .group_by(TeacherInstruction.student_id)
        .all()
    )

    counts_from_db = {row.student_id: row.cnt for row in rows}

    # Include all students, defaulting to 0 for those with no instructions
    return {sid: counts_from_db.get(sid, 0) for sid in student_ids}


@router.patch(
    "/teacher/instructions/{instruction_id}",
    response_model=InstructionResponse,
)
def update_instruction(
    instruction_id: int,
    payload: InstructionUpdate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Update an instruction. Only the teacher who created it can update."""
    instruction = (
        db.query(TeacherInstruction)
        .filter(TeacherInstruction.id == instruction_id)
        .first()
    )
    if not instruction:
        raise HTTPException(status_code=404, detail="Instruction not found")
    if instruction.teacher_id != current_user.id:
        raise HTTPException(status_code=403, detail="Not your instruction")

    # Validate instruction_type if provided
    if payload.instruction_type is not None and payload.instruction_type not in VALID_INSTRUCTION_TYPES:
        raise HTTPException(
            status_code=422,
            detail=f"Invalid instruction_type. Must be one of: {', '.join(sorted(VALID_INSTRUCTION_TYPES))}",
        )

    update_data = payload.model_dump(exclude_unset=True)
    for field, value in update_data.items():
        setattr(instruction, field, value)

    db.commit()
    db.refresh(instruction)
    logger.info("Updated instruction %d: %s", instruction_id, list(update_data.keys()))
    return instruction


@router.delete(
    "/teacher/instructions/{instruction_id}",
    response_model=InstructionResponse,
)
def delete_instruction(
    instruction_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Soft-delete an instruction (set is_active=False). Only the teacher who created it can delete."""
    instruction = (
        db.query(TeacherInstruction)
        .filter(TeacherInstruction.id == instruction_id)
        .first()
    )
    if not instruction:
        raise HTTPException(status_code=404, detail="Instruction not found")
    if instruction.teacher_id != current_user.id:
        raise HTTPException(status_code=403, detail="Not your instruction")

    instruction.is_active = False
    db.commit()
    db.refresh(instruction)
    logger.info("Soft-deleted instruction %d (teacher %d)", instruction_id, current_user.id)
    return instruction


# ── Classroom Stuck-Point Overview (Issue #91) ────────────────────────────────


class StudentStuckSummary(BaseModel):
    student_id: int
    student_name: str
    story_stuck_count: int
    character_stuck_count: int
    is_declining: bool
    top_stuck_characters: list[str]
    top_recommendations: list[str]


class ClassroomStuckResponse(BaseModel):
    students: list[StudentStuckSummary]
    total_stuck: int


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


# ── Notification Center ───────────────────────────────────────────────────────


class NotificationItem(BaseModel):
    alert_key: str  # "{classroom_id}:{student_id}:{alert_type}"
    classroom_id: int
    classroom_name: str
    student_id: int
    student_name: str
    alert_type: str  # "inactive" | "low_performance" | "declining"
    detail: str
    last_session_date: datetime | None
    is_read: bool
    read_at: datetime | None

    model_config = {"from_attributes": True}


class NotificationSummaryResponse(BaseModel):
    total: int
    unread: int
    items: list[NotificationItem]


class MarkReadRequest(BaseModel):
    alert_keys: list[str]


def _build_classroom_alerts_for_teacher(
    teacher_id: int,
    db: Session,
) -> list[tuple[Classroom, StudentAlertResponse]]:
    """Return (classroom, alert) pairs for all classrooms owned by the teacher."""
    classrooms = (
        db.query(Classroom)
        .filter(Classroom.teacher_id == teacher_id, Classroom.is_active == True)  # noqa: E712
        .all()
    )

    now = datetime.now(timezone.utc)
    fourteen_days_ago = now - timedelta(days=14)
    results: list[tuple[Classroom, StudentAlertResponse]] = []

    def _make_aware(dt: datetime) -> datetime:
        return dt.replace(tzinfo=timezone.utc) if dt.tzinfo is None else dt

    # Batch-load all enrollments across all classrooms in a single query (avoid N per-classroom queries)
    all_classroom_ids = [c.id for c in classrooms]
    all_enrollments = (
        db.query(ClassroomStudent)
        .options(joinedload(ClassroomStudent.student))
        .filter(ClassroomStudent.classroom_id.in_(all_classroom_ids))
        .all()
        if all_classroom_ids else []
    )
    enrollments_by_classroom: dict[int, list[ClassroomStudent]] = {}
    for e in all_enrollments:
        enrollments_by_classroom.setdefault(e.classroom_id, []).append(e)

    all_student_ids = list({e.student_id for e in all_enrollments})

    # Batch-load all scored sessions and latest sessions for all students at once
    all_scored_sessions_notif = (
        db.query(LearningSession)
        .filter(
            LearningSession.student_id.in_(all_student_ids),
            LearningSession.overall_score.isnot(None),
        )
        .order_by(LearningSession.student_id, LearningSession.started_at.asc())
        .all()
        if all_student_ids else []
    )
    scored_sessions_by_student_notif: dict[int, list[LearningSession]] = {}
    for s in all_scored_sessions_notif:
        scored_sessions_by_student_notif.setdefault(s.student_id, []).append(s)

    all_sessions_for_latest_notif = (
        db.query(LearningSession)
        .filter(LearningSession.student_id.in_(all_student_ids))
        .order_by(LearningSession.student_id, LearningSession.started_at.desc())
        .all()
        if all_student_ids else []
    )
    latest_session_by_student_notif: dict[int, LearningSession] = {}
    for s in all_sessions_for_latest_notif:
        if s.student_id not in latest_session_by_student_notif:
            latest_session_by_student_notif[s.student_id] = s

    for classroom in classrooms:
        enrollments = enrollments_by_classroom.get(classroom.id, [])
        for enrollment in enrollments:
            student = enrollment.student
            student_sessions = scored_sessions_by_student_notif.get(student.id, [])
            latest_session = latest_session_by_student_notif.get(student.id)
            last_session_date = latest_session.started_at if latest_session else None

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
                results.append((
                    classroom,
                    StudentAlertResponse(
                        student_id=student.id,
                        student_name=student.name,
                        alert_type="inactive",
                        detail=detail,
                        last_session_date=last_session_date,
                    ),
                ))
                continue

            scores = [s.overall_score for s in student_sessions if s.overall_score is not None]
            if scores:
                avg_score = sum(scores) / len(scores)
                if avg_score < 50:
                    results.append((
                        classroom,
                        StudentAlertResponse(
                            student_id=student.id,
                            student_name=student.name,
                            alert_type="low_performance",
                            detail=f"平均分數 {avg_score:.0f} 分（低於 50 分）",
                            last_session_date=last_session_date,
                        ),
                    ))
                    continue

            if len(scores) >= 3:
                last3 = scores[-3:]
                if last3[0] > last3[1] > last3[2]:
                    results.append((
                        classroom,
                        StudentAlertResponse(
                            student_id=student.id,
                            student_name=student.name,
                            alert_type="declining",
                            detail=f"最近 3 次分數持續下降：{last3[0]:.0f} → {last3[1]:.0f} → {last3[2]:.0f}",
                            last_session_date=last_session_date,
                        ),
                    ))

    return results


@router.get(
    "/teacher/notifications",
    response_model=NotificationSummaryResponse,
)
def get_teacher_notifications(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Aggregate alerts from all teacher's classrooms and annotate with read state."""
    pairs = _build_classroom_alerts_for_teacher(current_user.id, db)

    all_keys = [
        f"{classroom.id}:{alert.student_id}:{alert.alert_type}"
        for classroom, alert in pairs
    ]

    read_records = (
        db.query(TeacherNotificationRead)
        .filter(
            TeacherNotificationRead.teacher_id == current_user.id,
            TeacherNotificationRead.alert_key.in_(all_keys),
        )
        .all()
    ) if all_keys else []

    read_map: dict[str, datetime] = {r.alert_key: r.read_at for r in read_records}

    items: list[NotificationItem] = []
    for classroom, alert in pairs:
        key = f"{classroom.id}:{alert.student_id}:{alert.alert_type}"
        is_read = key in read_map
        items.append(NotificationItem(
            alert_key=key,
            classroom_id=classroom.id,
            classroom_name=classroom.name,
            student_id=alert.student_id,
            student_name=alert.student_name,
            alert_type=alert.alert_type,
            detail=alert.detail,
            last_session_date=alert.last_session_date,
            is_read=is_read,
            read_at=read_map.get(key),
        ))

    # Sort: unread first, then by alert type priority, then student name
    type_priority = {"inactive": 0, "low_performance": 1, "declining": 2}
    items.sort(key=lambda n: (n.is_read, type_priority.get(n.alert_type, 9), n.student_name))

    unread_count = sum(1 for item in items if not item.is_read)

    return NotificationSummaryResponse(
        total=len(items),
        unread=unread_count,
        items=items,
    )


@router.post(
    "/teacher/notifications/mark-read",
    response_model=dict,
)
def mark_notifications_read(
    payload: MarkReadRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Mark specific alert keys as read for the current teacher."""
    if not payload.alert_keys:
        return {"marked": 0}

    existing_keys = {
        r.alert_key
        for r in db.query(TeacherNotificationRead)
        .filter(
            TeacherNotificationRead.teacher_id == current_user.id,
            TeacherNotificationRead.alert_key.in_(payload.alert_keys),
        )
        .all()
    }

    new_keys = [k for k in payload.alert_keys if k not in existing_keys]
    for key in new_keys:
        db.add(TeacherNotificationRead(teacher_id=current_user.id, alert_key=key))

    if new_keys:
        db.commit()

    logger.info("Teacher %d marked %d notifications as read", current_user.id, len(new_keys))
    return {"marked": len(new_keys)}


@router.post(
    "/teacher/notifications/mark-all-read",
    response_model=dict,
)
def mark_all_notifications_read(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Mark all current alerts as read for the current teacher."""
    pairs = _build_classroom_alerts_for_teacher(current_user.id, db)
    all_keys = [
        f"{classroom.id}:{alert.student_id}:{alert.alert_type}"
        for classroom, alert in pairs
    ]

    if not all_keys:
        return {"marked": 0}

    existing_keys = {
        r.alert_key
        for r in db.query(TeacherNotificationRead)
        .filter(
            TeacherNotificationRead.teacher_id == current_user.id,
            TeacherNotificationRead.alert_key.in_(all_keys),
        )
        .all()
    }

    new_keys = [k for k in all_keys if k not in existing_keys]
    for key in new_keys:
        db.add(TeacherNotificationRead(teacher_id=current_user.id, alert_key=key))

    if new_keys:
        db.commit()

    logger.info("Teacher %d marked all %d notifications as read", current_user.id, len(new_keys))
    return {"marked": len(new_keys)}


# ── Cross-Text Learning Pattern Analysis (Issue #253) ─────────────────────────


class TextPerformanceSummary(BaseModel):
    story_slug: str
    story_title: str | None
    attempt_count: int
    avg_score: float | None
    avg_accuracy: float | None
    avg_comprehension_score: float | None
    first_attempt_at: datetime | None
    last_attempt_at: datetime | None


class StudentCrossTextPattern(BaseModel):
    student_id: int
    student_name: str
    total_texts_attempted: int
    total_sessions: int
    overall_avg_score: float | None
    score_trend: list[dict]  # [{date, score, story_slug, title}] sorted by date
    text_performance: list[TextPerformanceSummary]
    repeated_error_chars: list[dict]  # [{char, error_count, story_count, story_slugs}]
    strong_texts: list[str]   # story_slugs where avg_score >= 80
    weak_texts: list[str]     # story_slugs where avg_score < 60


class ClassroomCrossTextPattern(BaseModel):
    classroom_id: int
    classroom_name: str
    total_students: int
    total_sessions: int
    text_difficulty_ranking: list[dict]  # [{story_slug, title, avg_score, attempt_count}]
    class_score_trend: list[dict]  # [{date, avg_score}]
    common_error_chars: list[dict]  # [{char, student_count, total_errors}]
    student_patterns: list[StudentCrossTextPattern]


@router.get(
    "/teacher/classrooms/{classroom_id}/cross-text-analysis",
    response_model=ClassroomCrossTextPattern,
)
def get_cross_text_analysis(
    classroom_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Aggregate cross-text learning pattern analysis for a classroom.

    Returns per-student and class-level views of:
    - Score trends across texts over time
    - Common error characters recurring across multiple texts
    - Text difficulty ranking based on average class performance
    - Individual student strengths and weaknesses by text
    """
    classroom = _check_classroom_access(current_user, classroom_id, db)

    student_rows = (
        db.query(User)
        .join(ClassroomStudent, ClassroomStudent.student_id == User.id)
        .filter(ClassroomStudent.classroom_id == classroom_id)
        .all()
    )
    student_ids = [s.id for s in student_rows]
    student_map = {s.id: s.name or s.username or s.email for s in student_rows}

    if not student_ids:
        return ClassroomCrossTextPattern(
            classroom_id=classroom_id,
            classroom_name=classroom.name,
            total_students=0,
            total_sessions=0,
            text_difficulty_ranking=[],
            class_score_trend=[],
            common_error_chars=[],
            student_patterns=[],
        )

    # Fetch all completed sessions for all students in classroom
    all_sessions = (
        db.query(LearningSession)
        .filter(
            LearningSession.student_id.in_(student_ids),
            LearningSession.status == "completed",
            LearningSession.story_slug.isnot(None),
        )
        .order_by(LearningSession.started_at.asc())
        .all()
    )

    # Fetch all character errors for classroom sessions
    session_ids = [s.id for s in all_sessions]
    all_char_errors: list[CharacterError] = []
    if session_ids:
        all_char_errors = (
            db.query(CharacterError)
            .filter(CharacterError.session_id.in_(session_ids))
            .all()
        )

    # Build story title lookup (best-effort)
    def _get_title(slug: str) -> str | None:
        try:
            story = get_lesson_by_id(int(slug))
            return story["title"] if story else None
        except (ValueError, TypeError):
            return slug

    # ── Class-level score trend (daily avg) ──────────────────────────────────
    daily_scores: dict[str, list[float]] = defaultdict(list)
    for s in all_sessions:
        if s.overall_score is not None:
            day = s.started_at.strftime("%Y-%m-%d")
            daily_scores[day].append(s.overall_score)

    class_score_trend = [
        {"date": day, "avg_score": round(sum(scores) / len(scores), 1)}
        for day, scores in sorted(daily_scores.items())
    ]

    # ── Text difficulty ranking ───────────────────────────────────────────────
    text_scores: dict[str, list[float]] = defaultdict(list)
    text_attempts: dict[str, int] = defaultdict(int)
    for s in all_sessions:
        if s.story_slug:
            text_attempts[s.story_slug] += 1
            if s.overall_score is not None:
                text_scores[s.story_slug].append(s.overall_score)

    text_difficulty_ranking = sorted(
        [
            {
                "story_slug": slug,
                "title": _get_title(slug),
                "avg_score": round(sum(text_scores[slug]) / len(text_scores[slug]), 1)
                if text_scores[slug]
                else None,
                "attempt_count": text_attempts[slug],
            }
            for slug in text_attempts
        ],
        key=lambda x: (x["avg_score"] is None, x["avg_score"] or 0),
    )

    # ── Common error chars across class ──────────────────────────────────────
    sid_to_student: dict[int, int] = {s.id: s.student_id for s in all_sessions}
    sid_to_slug: dict[int, str] = {
        s.id: s.story_slug for s in all_sessions if s.story_slug
    }

    char_student_set: dict[str, set[int]] = defaultdict(set)
    char_total_errors: dict[str, int] = defaultdict(int)
    for err in all_char_errors:
        student_id = sid_to_student.get(err.session_id)
        if student_id:
            char_student_set[err.character].add(student_id)
            char_total_errors[err.character] += 1

    common_error_chars = sorted(
        [
            {
                "char": char,
                "student_count": len(students),
                "total_errors": char_total_errors[char],
            }
            for char, students in char_student_set.items()
        ],
        key=lambda x: (-x["student_count"], -x["total_errors"]),
    )[:20]

    # ── Per-student patterns ──────────────────────────────────────────────────
    student_patterns: list[StudentCrossTextPattern] = []

    for sid in student_ids:
        s_sessions = [s for s in all_sessions if s.student_id == sid]
        if not s_sessions:
            continue

        s_session_ids = {s.id for s in s_sessions}
        s_errors = [e for e in all_char_errors if e.session_id in s_session_ids]

        # Score trend
        score_trend = [
            {
                "date": s.started_at.strftime("%Y-%m-%d"),
                "score": s.overall_score,
                "story_slug": s.story_slug,
                "title": _get_title(s.story_slug) if s.story_slug else None,
            }
            for s in s_sessions
            if s.overall_score is not None
        ]

        # Text performance breakdown
        slug_sessions: dict[str, list[LearningSession]] = defaultdict(list)
        for s in s_sessions:
            if s.story_slug:
                slug_sessions[s.story_slug].append(s)

        text_performance = []
        strong_texts: list[str] = []
        weak_texts: list[str] = []
        for slug, slug_sess in slug_sessions.items():
            scores = [s.overall_score for s in slug_sess if s.overall_score is not None]
            accuracies = [s.accuracy for s in slug_sess if s.accuracy is not None]
            comp_scores = [
                s.comprehension_score for s in slug_sess if s.comprehension_score is not None
            ]
            avg_sc = round(sum(scores) / len(scores), 1) if scores else None
            text_performance.append(
                TextPerformanceSummary(
                    story_slug=slug,
                    story_title=_get_title(slug),
                    attempt_count=len(slug_sess),
                    avg_score=avg_sc,
                    avg_accuracy=round(sum(accuracies) / len(accuracies), 1)
                    if accuracies
                    else None,
                    avg_comprehension_score=round(sum(comp_scores) / len(comp_scores), 1)
                    if comp_scores
                    else None,
                    first_attempt_at=min(s.started_at for s in slug_sess),
                    last_attempt_at=max(s.started_at for s in slug_sess),
                )
            )
            if avg_sc is not None:
                if avg_sc >= 80:
                    strong_texts.append(slug)
                elif avg_sc < 60:
                    weak_texts.append(slug)

        # Repeated error chars (appearing in 2+ different texts)
        char_slug_set: dict[str, set[str]] = defaultdict(set)
        char_count: dict[str, int] = defaultdict(int)
        for err in s_errors:
            slug = sid_to_slug.get(err.session_id)
            if slug:
                char_slug_set[err.character].add(slug)
            char_count[err.character] += 1

        repeated_error_chars = sorted(
            [
                {
                    "char": char,
                    "error_count": char_count[char],
                    "story_count": len(slugs),
                    "story_slugs": list(slugs),
                }
                for char, slugs in char_slug_set.items()
                if len(slugs) >= 2
            ],
            key=lambda x: (-x["story_count"], -x["error_count"]),
        )[:10]

        all_scores = [s.overall_score for s in s_sessions if s.overall_score is not None]
        student_patterns.append(
            StudentCrossTextPattern(
                student_id=sid,
                student_name=student_map.get(sid, f"Student {sid}"),
                total_texts_attempted=len(slug_sessions),
                total_sessions=len(s_sessions),
                overall_avg_score=round(sum(all_scores) / len(all_scores), 1)
                if all_scores
                else None,
                score_trend=score_trend,
                text_performance=sorted(text_performance, key=lambda x: x.story_slug),
                repeated_error_chars=repeated_error_chars,
                strong_texts=strong_texts,
                weak_texts=weak_texts,
            )
        )

    student_patterns.sort(key=lambda x: -x.total_sessions)

    return ClassroomCrossTextPattern(
        classroom_id=classroom_id,
        classroom_name=classroom.name,
        total_students=len(student_ids),
        total_sessions=len(all_sessions),
        text_difficulty_ranking=text_difficulty_ranking,
        class_score_trend=class_score_trend,
        common_error_chars=common_error_chars,
        student_patterns=student_patterns,
    )


# ── Teacher Custom Text Library (我的課文) ───────────────────────────────────

_GENRE_TO_CATEGORY = {
    "記敘文": "Fable",
    "說明文": "Science",
    "説明文": "Science",
    "議論文": "History",
    "文言文": "History",
    "應用文": "Daily",
}

_GRADE_CODE_MAP = {
    4: "G4",
    5: "G5",
    6: "G6",
    7: "G7",
    8: "G8",
    9: "G9",
}


class TeacherTextCreateRequest(BaseModel):
    title: str
    grade: int
    genre: str
    text_type: str = "單"
    reading_strategy: str | None = None
    paragraphs: list[str]
    vocabulary: list[dict] | None = None


class TeacherTextUpdateRequest(BaseModel):
    title: str | None = None
    grade: int | None = None
    genre: str | None = None
    text_type: str | None = None
    reading_strategy: str | None = None
    paragraphs: list[str] | None = None
    vocabulary: list[dict] | None = None


class TeacherTextItem(BaseModel):
    id: int
    title: str
    grade: int
    grade_code: str
    genre: str
    text_type: str
    paragraph_count: int
    char_count: int
    reading_strategy: str | None
    status: str
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class TeacherTextDetail(TeacherTextItem):
    paragraphs: list[str]
    vocabulary: list[dict] | None


class TeacherTextListResponse(BaseModel):
    texts: list[TeacherTextItem]
    total: int


def _text_to_item(text: Text) -> TeacherTextItem:
    return TeacherTextItem(
        id=text.id,
        title=text.title,
        grade=text.grade,
        grade_code=text.grade_code,
        genre=text.genre,
        text_type=text.text_type,
        paragraph_count=len(text.paragraphs) if text.paragraphs else 0,
        char_count=text.char_count,
        reading_strategy=text.reading_strategy,
        status=text.status,
        created_at=text.created_at,
        updated_at=text.updated_at,
    )


def _text_to_detail(text: Text) -> TeacherTextDetail:
    item = _text_to_item(text)
    return TeacherTextDetail(
        **item.model_dump(),
        paragraphs=text.paragraphs or [],
        vocabulary=text.vocabulary,
    )


def _get_text_or_404(text_id: int, teacher_id: int, db: Session) -> Text:
    """Return Text owned by this teacher or raise 404."""
    text = db.query(Text).filter(
        Text.id == text_id,
        Text.teacher_id == teacher_id,
    ).first()
    if not text:
        raise HTTPException(status_code=404, detail="課文不存在或無權限存取")
    return text


@router.get(
    "/teacher/my-texts",
    response_model=TeacherTextListResponse,
)
def list_my_texts(
    search: str | None = None,
    grade: int | None = None,
    genre: str | None = None,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """List all custom texts created by the authenticated teacher."""
    query = db.query(Text).filter(Text.teacher_id == current_user.id)

    if grade is not None:
        query = query.filter(Text.grade == grade)
    if genre:
        query = query.filter(Text.genre == genre)
    if search:
        query = query.filter(Text.title.ilike(f"%{search}%"))

    texts = query.order_by(Text.updated_at.desc()).all()
    return TeacherTextListResponse(
        texts=[_text_to_item(t) for t in texts],
        total=len(texts),
    )


@router.get(
    "/teacher/my-texts/{text_id}",
    response_model=TeacherTextDetail,
)
def get_my_text(
    text_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Get full detail of a teacher's custom text."""
    text = _get_text_or_404(text_id, current_user.id, db)
    return _text_to_detail(text)


@router.post(
    "/teacher/my-texts",
    response_model=TeacherTextDetail,
    status_code=201,
)
def create_my_text(
    body: TeacherTextCreateRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Create a new custom text owned by the authenticated teacher."""
    full_text = "\n".join(body.paragraphs)
    char_count = len(full_text.replace("\n", "").replace(" ", ""))
    grade_code = _GRADE_CODE_MAP.get(body.grade, f"G{body.grade}")
    category = _GENRE_TO_CATEGORY.get(body.genre, "Daily")

    text = Text(
        title=body.title,
        grade=body.grade,
        grade_code=grade_code,
        genre=body.genre,
        text_type=body.text_type,
        category=category,
        reading_strategy=body.reading_strategy,
        paragraphs=body.paragraphs,
        full_text=full_text,
        char_count=char_count,
        vocabulary=body.vocabulary,
        visibility=VisibilityLevel.private,
        status=TextStatus.draft,
        teacher_id=current_user.id,
        created_by_id=current_user.id,
    )
    db.add(text)
    db.commit()
    db.refresh(text)
    return _text_to_detail(text)


@router.put(
    "/teacher/my-texts/{text_id}",
    response_model=TeacherTextDetail,
)
def update_my_text(
    text_id: int,
    body: TeacherTextUpdateRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Update an existing custom text owned by the authenticated teacher."""
    text = _get_text_or_404(text_id, current_user.id, db)

    if body.title is not None:
        text.title = body.title
    if body.grade is not None:
        text.grade = body.grade
        text.grade_code = _GRADE_CODE_MAP.get(body.grade, f"G{body.grade}")
    if body.genre is not None:
        text.genre = body.genre
        text.category = _GENRE_TO_CATEGORY.get(body.genre, "Daily")
    if body.text_type is not None:
        text.text_type = body.text_type
    if body.reading_strategy is not None:
        text.reading_strategy = body.reading_strategy
    if body.paragraphs is not None:
        text.paragraphs = body.paragraphs
        full_text = "\n".join(body.paragraphs)
        text.full_text = full_text
        text.char_count = len(full_text.replace("\n", "").replace(" ", ""))
    if body.vocabulary is not None:
        text.vocabulary = body.vocabulary

    text.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(text)
    return _text_to_detail(text)


@router.delete(
    "/teacher/my-texts/{text_id}",
    status_code=204,
)
def delete_my_text(
    text_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Delete a custom text owned by the authenticated teacher."""
    text = _get_text_or_404(text_id, current_user.id, db)
    db.delete(text)
    db.commit()


# ── Story Tags (difficulty + custom labels) ───────────────────────────────────

VALID_DIFFICULTY_LEVELS = {"easy", "medium", "hard"}
MAX_CUSTOM_TAGS = 10
MAX_TAG_LENGTH = 30


class StoryTagUpsertRequest(BaseModel):
    """Request body for setting difficulty and custom tags on a story."""
    difficulty_level: str | None = None  # "easy" / "medium" / "hard" / null to clear
    custom_tags: list[str] | None = None  # up to 10 tags, each max 30 chars


class StoryTagResponse(BaseModel):
    """Response schema for a story tag entry."""
    story_ref: str
    difficulty_level: str | None
    custom_tags: list[str]

    model_config = {"from_attributes": True}


def _get_or_create_story_tag(
    teacher_id: int, story_ref: str, db: Session
) -> StoryTag:
    tag = db.query(StoryTag).filter(
        StoryTag.teacher_id == teacher_id,
        StoryTag.story_ref == story_ref,
    ).first()
    if not tag:
        tag = StoryTag(teacher_id=teacher_id, story_ref=story_ref)
        db.add(tag)
    return tag


@router.get(
    "/teacher/story-tags/{story_ref}",
    response_model=StoryTagResponse,
)
def get_story_tag(
    story_ref: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Get the teacher's difficulty and custom tags for a story.

    story_ref: lesson_number string for platform stories (e.g. "3"),
               or "text:{id}" for teacher-created texts (e.g. "text:42").
    Returns default values if no tag record exists yet.
    """
    tag = db.query(StoryTag).filter(
        StoryTag.teacher_id == current_user.id,
        StoryTag.story_ref == story_ref,
    ).first()
    if not tag:
        return StoryTagResponse(
            story_ref=story_ref,
            difficulty_level=None,
            custom_tags=[],
        )
    return StoryTagResponse(
        story_ref=story_ref,
        difficulty_level=tag.difficulty_level,
        custom_tags=tag.custom_tags or [],
    )


@router.put(
    "/teacher/story-tags/{story_ref}",
    response_model=StoryTagResponse,
)
def upsert_story_tag(
    story_ref: str,
    body: StoryTagUpsertRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Set or update difficulty and custom tags for a story.

    story_ref: lesson_number string for platform stories (e.g. "3"),
               or "text:{id}" for teacher-created texts (e.g. "text:42").
    Passing null for difficulty_level clears the override (falls back to auto-detect).
    Passing an empty list for custom_tags clears all tags.
    """
    if body.difficulty_level is not None and body.difficulty_level not in VALID_DIFFICULTY_LEVELS:
        raise HTTPException(
            status_code=422,
            detail=f"difficulty_level must be one of: {sorted(VALID_DIFFICULTY_LEVELS)}",
        )
    if body.custom_tags is not None:
        if len(body.custom_tags) > MAX_CUSTOM_TAGS:
            raise HTTPException(
                status_code=422,
                detail=f"custom_tags cannot exceed {MAX_CUSTOM_TAGS} items",
            )
        for t in body.custom_tags:
            if len(t.strip()) == 0:
                raise HTTPException(status_code=422, detail="Tag names cannot be empty")
            if len(t) > MAX_TAG_LENGTH:
                raise HTTPException(
                    status_code=422,
                    detail=f"Each tag must be {MAX_TAG_LENGTH} characters or fewer",
                )

    tag = _get_or_create_story_tag(current_user.id, story_ref, db)
    if body.difficulty_level is not None or (
        body.difficulty_level is None and "difficulty_level" in body.model_fields_set
    ):
        tag.difficulty_level = body.difficulty_level
    if body.custom_tags is not None:
        tag.custom_tags = [t.strip() for t in body.custom_tags if t.strip()]

    db.commit()
    db.refresh(tag)
    return StoryTagResponse(
        story_ref=story_ref,
        difficulty_level=tag.difficulty_level,
        custom_tags=tag.custom_tags or [],
    )


@router.delete(
    "/teacher/story-tags/{story_ref}",
    status_code=204,
)
def delete_story_tag(
    story_ref: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Remove all custom tags and difficulty override for a story."""
    tag = db.query(StoryTag).filter(
        StoryTag.teacher_id == current_user.id,
        StoryTag.story_ref == story_ref,
    ).first()
    if tag:
        db.delete(tag)
        db.commit()


@router.get(
    "/teacher/story-tags",
    response_model=list[StoryTagResponse],
)
def list_story_tags(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """List all story tag settings created by the authenticated teacher."""
    tags = db.query(StoryTag).filter(
        StoryTag.teacher_id == current_user.id
    ).order_by(StoryTag.updated_at.desc()).all()
    return [
        StoryTagResponse(
            story_ref=t.story_ref,
            difficulty_level=t.difficulty_level,
            custom_tags=t.custom_tags or [],
        )
        for t in tags
    ]
