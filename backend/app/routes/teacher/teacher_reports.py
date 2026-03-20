"""Teacher reports endpoints: CSV export, error vocab."""
import csv
import io
import logging
from datetime import datetime

from fastapi import APIRouter, Depends, Request
from fastapi.responses import StreamingResponse
from sqlalchemy import func
from sqlalchemy.orm import Session

from ...auth.dependencies import get_current_user
from ...database import get_db
from ...dependencies.tenant import _check_classroom_access
from ...models.school import ClassroomStudent
from ...models.session import CharacterError, ErrorCorrection, LearningSession
from ...models.gamification import StudentStreak, StudentXPLog
from ...models.user import User
from ...services.audit_logger import AuditAction, audit_log_endpoint
from .teacher_schemas import ErrorVocabItem

router = APIRouter(tags=["teacher"])
logger = logging.getLogger(__name__)


def _sanitize_csv_cell(value: str) -> str:
    """Prevent CSV formula injection by prefixing dangerous leading characters."""
    if isinstance(value, str) and value and value[0] in ("=", "+", "-", "@", "\t", "\r"):
        return "'" + value
    return value


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
    _check_classroom_access(current_user, classroom_id, db)

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


@router.get("/teacher/classrooms/{classroom_id}/export")
def export_classroom_report(
    classroom_id: int,
    request: Request,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Export classroom student progress as a UTF-8 BOM CSV file.

    Columns: 學生姓名, 已完成課文數, 平均正確率, 平均語速(CPM), 總學習次數,
             已掌握生字, 連續學習天數, 累積XP, 最近學習日期
    """
    classroom = _check_classroom_access(current_user, classroom_id, db)
    audit_log_endpoint(
        request=request,
        action=AuditAction.EXPORT_REPORT,
        user_id=current_user.id,
        target_student_id=None,
    )

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
    # utf-8-sig encoding adds the UTF-8 BOM (EF BB BF)
    return StreamingResponse(
        iter([csv_content.encode("utf-8-sig")]),
        media_type="text/csv; charset=UTF-8",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )
