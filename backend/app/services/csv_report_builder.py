"""
csv_report_builder.py — CSV report builder service.

Part of the organizations.py split (Issue #1890).
Extracted from admin_report_export.py to allow direct unit testing and
future reuse outside the HTTP layer.
"""

import csv
import io
from datetime import datetime

from sqlalchemy.orm import Session, joinedload

from ..models.school import Classroom, ClassroomStudent, School
from ..models.session import LearningSession


def _sanitize_csv_cell(value: str) -> str:
    """Prevent CSV formula injection by prefixing dangerous leading characters.

    Characters that Excel/LibreOffice Calc interpret as formula starters:
    =, +, -, @, tab (\\t), carriage return (\\r).
    """
    if isinstance(value, str) and value and value[0] in ("=", "+", "-", "@", "\t", "\r"):
        return "'" + value
    return value


def build_platform_report_csv(
    db: Session,
    school_id: int | None = None,
    classroom_id: int | None = None,
    row_limit: int = 10_000,
) -> tuple[str, int]:
    """Build a UTF-8 CSV string for the platform-wide student progress report.

    Args:
        db: SQLAlchemy session.
        school_id: Optional filter by school.
        classroom_id: Optional filter by classroom (takes precedence over school_id).
        row_limit: Maximum number of enrollment rows to export.

    Returns:
        A (csv_string, row_count) tuple. The string is NOT BOM-encoded — the
        caller is responsible for encoding as utf-8-sig for download.

    Raises:
        ValueError: When the result set exceeds *row_limit*.
    """
    query = (
        db.query(ClassroomStudent)
        .options(
            joinedload(ClassroomStudent.student),
            joinedload(ClassroomStudent.classroom).joinedload(Classroom.school),
        )
        .join(Classroom, ClassroomStudent.classroom_id == Classroom.id)
        .join(School, Classroom.school_id == School.id)
    )

    if classroom_id is not None:
        query = query.filter(ClassroomStudent.classroom_id == classroom_id)
    elif school_id is not None:
        query = query.filter(Classroom.school_id == school_id)

    enrollments = query.limit(row_limit + 1).all()
    if len(enrollments) > row_limit:
        raise ValueError(
            f"匯出資料量過大，請加上 school_id 或 classroom_id 篩選條件"
            f"（上限 {row_limit:,} 筆）"
        )

    # Batch-load all sessions for these students to avoid N+1
    student_ids = [e.student_id for e in enrollments]
    all_sessions = (
        db.query(LearningSession)
        .filter(LearningSession.student_id.in_(student_ids))
        .all()
        if student_ids
        else []
    )
    sessions_by_student: dict[int, list] = {}
    for s in all_sessions:
        sessions_by_student.setdefault(s.student_id, []).append(s)

    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow([
        "學校名稱", "班級名稱", "學生姓名",
        "已完成課文數", "平均正確率", "總學習次數", "最近學習日期",
    ])

    for enrollment in enrollments:
        student = enrollment.student
        classroom = enrollment.classroom
        school = classroom.school
        sessions = sessions_by_student.get(student.id, [])

        total_sessions = len(sessions)
        completed = [s for s in sessions if s.status == "completed"]
        completed_texts = len({s.story_slug for s in completed if s.story_slug})

        scores = [s.accuracy for s in sessions if s.accuracy is not None]
        avg_accuracy = f"{sum(scores) / len(scores):.1f}%" if scores else ""

        latest = max(sessions, key=lambda s: s.started_at, default=None)
        last_date = latest.started_at.strftime("%Y-%m-%d") if latest else ""

        writer.writerow([
            _sanitize_csv_cell(school.name),
            _sanitize_csv_cell(classroom.name),
            _sanitize_csv_cell(student.name),
            completed_texts,
            avg_accuracy,
            total_sessions,
            last_date,
        ])

    csv_content = output.getvalue()
    output.close()
    return csv_content, len(enrollments)


def make_report_filename(prefix: str = "platform-report") -> str:
    """Generate a dated filename for the CSV download."""
    return f"{prefix}-{datetime.now().strftime('%Y%m%d')}.csv"
