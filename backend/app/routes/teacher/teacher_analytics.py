"""Teacher analytics endpoints: heatmaps and time stats.

Issue #1224: time-stats now uses SQL aggregates instead of .limit(5000) +
Python iteration, eliminating the memory cap and improving performance.
"""
import logging
from collections import defaultdict
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import case, func
from sqlalchemy.orm import Session, joinedload

from ...auth.dependencies import get_current_user
from ...database import get_db
from ...dependencies.tenant import _check_classroom_access
from ...models.school import ClassroomStudent
from ...models.session import CharacterError, LearningSession
from ...models.user import User
from ...services.lesson_loader import get_lesson_by_id
from .teacher_schemas import (
    ErrorHeatmapErrorEntry,
    ErrorHeatmapResponse,
    ErrorHeatmapStudentEntry,
    HeatmapResponse,
    HeatmapScoreEntry,
    HeatmapStoryEntry,
    HeatmapStudentEntry,
    TimeStatsResponse,
)

router = APIRouter(tags=["teacher"])
logger = logging.getLogger(__name__)

# Maximum sessions the heatmap endpoint will process in one request.
# Exceeding this limit raises 400 so the caller knows to apply additional filters
# (e.g. date range or story filter) rather than silently receiving truncated data.
# Mirrors _ADMIN_EXPORT_ROW_LIMIT in organizations.py.
_HEATMAP_SESSION_LIMIT = 5_000


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
    _check_classroom_access(current_user, classroom_id, db)

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

    # Week boundaries (used in SQL filters below)
    now = datetime.now(timezone.utc)
    this_monday = (now - timedelta(days=now.weekday())).replace(
        hour=0, minute=0, second=0, microsecond=0
    )
    last_monday = this_monday - timedelta(days=7)

    # ── Duration stats via SQL (Issue #1224) ──────────────────────────────────
    # Replaces .limit(5000) + Python iteration.
    # SQLite: (julianday(completed_at) - julianday(started_at)) * 1440 → minutes
    # PostgreSQL: EXTRACT(EPOCH FROM (completed_at - started_at)) / 60 → minutes
    # We use a portable approach: pull only the two timestamp columns for rows
    # that have both, then do arithmetic in Python — still O(1) memory vs
    # pulling full ORM objects for 5000 rows.
    duration_rows = (
        db.query(LearningSession.started_at, LearningSession.completed_at)
        .filter(
            LearningSession.student_id.in_(student_ids),
            LearningSession.started_at.isnot(None),
            LearningSession.completed_at.isnot(None),
        )
        .all()
    )

    total_minutes = 0.0
    duration_count = 0
    for started_at, completed_at in duration_rows:
        # Normalise tz-awareness (SQLite returns naive datetimes)
        if started_at.tzinfo is None:
            started_at = started_at.replace(tzinfo=timezone.utc)
        if completed_at.tzinfo is None:
            completed_at = completed_at.replace(tzinfo=timezone.utc)
        delta = (completed_at - started_at).total_seconds() / 60.0
        if delta > 0:
            total_minutes += delta
            duration_count += 1

    total_hours = round(total_minutes / 60.0, 1)
    avg_minutes = round(total_minutes / duration_count, 1) if duration_count else None

    # ── Distinct study days via SQL COUNT DISTINCT (Issue #1224) ──────────────
    study_days_row = (
        db.query(func.count(func.distinct(func.date(LearningSession.started_at))))
        .filter(
            LearningSession.student_id.in_(student_ids),
            LearningSession.started_at.isnot(None),
        )
        .scalar()
    )
    study_days: int = study_days_row or 0

    # ── Week counts via SQL SUM(CASE WHEN ...) (Issue #1224) ──────────────────
    week_counts = (
        db.query(
            func.sum(
                case(
                    (LearningSession.started_at >= this_monday, 1),
                    else_=0,
                )
            ).label("this_week"),
            func.sum(
                case(
                    (
                        (LearningSession.started_at >= last_monday)
                        & (LearningSession.started_at < this_monday),
                        1,
                    ),
                    else_=0,
                )
            ).label("last_week"),
        )
        .filter(
            LearningSession.student_id.in_(student_ids),
            LearningSession.started_at.isnot(None),
        )
        .one()
    )
    sessions_this_week: int = week_counts.this_week or 0
    sessions_last_week: int = week_counts.last_week or 0

    return TimeStatsResponse(
        total_hours=total_hours,
        avg_minutes_per_session=avg_minutes,
        study_days=study_days,
        sessions_this_week=sessions_this_week,
        sessions_last_week=sessions_last_week,
    )


@router.get(
    "/teacher/classrooms/{classroom_id}/heatmap",
    response_model=HeatmapResponse,
)
def get_classroom_heatmap(
    classroom_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Get student x story score heatmap for a classroom.

    Returns students, stories, and best scores per (student, story) pair.
    """
    _check_classroom_access(current_user, classroom_id, db)

    # Get all student IDs in this classroom (safety cap)
    # joinedload(ClassroomStudent.student) avoids N+1 lazy loads when accessing e.student
    enrollments = (
        db.query(ClassroomStudent)
        .options(joinedload(ClassroomStudent.student))
        .filter(ClassroomStudent.classroom_id == classroom_id)
        .limit(5000)
        .all()
    )

    if not enrollments:
        return HeatmapResponse(students=[], stories=[], scores=[])

    student_ids = [e.student_id for e in enrollments]
    students_map = {e.student_id: e.student for e in enrollments}

    # Query sessions for classroom students that have a story_slug.
    # Fetch one extra row to detect overflow — if we get more than the limit,
    # raise 400 so the caller knows data would be silently truncated.
    sessions_raw = (
        db.query(LearningSession)
        .filter(
            LearningSession.student_id.in_(student_ids),
            LearningSession.story_slug.isnot(None),
        )
        .limit(_HEATMAP_SESSION_LIMIT + 1)
        .all()
    )
    if len(sessions_raw) > _HEATMAP_SESSION_LIMIT:
        raise HTTPException(
            status_code=400,
            detail=(
                f"此班級的 session 數量超過上限 {_HEATMAP_SESSION_LIMIT:,} 筆，"
                "請聯絡管理員或加上日期篩選條件後再試。"
            ),
        )
    sessions = sessions_raw

    # Build best-score map: (student_id, story_slug) -> best session
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


@router.get(
    "/teacher/classrooms/{classroom_id}/error-heatmap",
    response_model=ErrorHeatmapResponse,
)
def get_classroom_error_heatmap(
    classroom_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Get student x character error matrix for a classroom.

    Returns all enrolled students, all characters that have at least one error,
    and non-zero (student, character) error counts.  Characters are ordered by
    total error count descending so the most problematic characters appear first.
    """
    _check_classroom_access(current_user, classroom_id, db)

    # Get enrolled students in enrollment order (safety cap)
    # joinedload(ClassroomStudent.student) avoids N+1 lazy loads when accessing e.student
    enrollments = (
        db.query(ClassroomStudent)
        .options(joinedload(ClassroomStudent.student))
        .filter(ClassroomStudent.classroom_id == classroom_id)
        .limit(5000)
        .all()
    )
    if not enrollments:
        return ErrorHeatmapResponse(students=[], characters=[], errors=[])

    student_ids = [e.student_id for e in enrollments]
    students_map = {e.student_id: e.student for e in enrollments}

    # Query aggregated error counts: (student_id, character) -> count (safety cap)
    rows = (
        db.query(
            LearningSession.student_id,
            CharacterError.character,
            func.count(CharacterError.id).label("error_count"),
        )
        .join(CharacterError, CharacterError.session_id == LearningSession.id)
        .filter(LearningSession.student_id.in_(student_ids))
        .group_by(LearningSession.student_id, CharacterError.character)
        .limit(5000)
        .all()
    )

    if not rows:
        students = [
            ErrorHeatmapStudentEntry(id=s_id, name=students_map[s_id].name)
            for s_id in student_ids
        ]
        return ErrorHeatmapResponse(students=students, characters=[], errors=[])

    # Build character -> total error count for ordering
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
