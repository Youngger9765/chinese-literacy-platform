"""Teacher reading progress routes — view student reading curves and set CPM targets.

GET  /api/teacher/students/{student_id}/reading-progress/{lesson_id}
PUT  /api/teacher/reading-targets/{lesson_id}

Issue #909: 重複朗讀 + 進步曲線（教師端）
"""
import logging
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import desc
from sqlalchemy.orm import Session

from ...auth.dependencies import get_current_user
from ...database import get_db
from ...models.reading_history import ReadingHistory, ReadingTarget
from ...models.school import Classroom, ClassroomStudent
from ...models.user import User

router = APIRouter(tags=["teacher"])
logger = logging.getLogger(__name__)


def _require_teacher_access_to_student(teacher_id: int, student_id: int, db: Session) -> None:
    """Raise 403 if teacher doesn't own a classroom containing this student."""
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
        raise HTTPException(status_code=403, detail="Access denied")


# ── Schemas ───────────────────────────────────────────────────────────────────

class ReadingAttemptItem(BaseModel):
    id: int
    cpm: float
    accuracy: float
    duration_seconds: float
    reading_type: str
    paragraph_index: Optional[int]
    created_at: str


class StudentReadingProgressResponse(BaseModel):
    student_id: int
    student_name: str
    lesson_id: str
    attempts: list[ReadingAttemptItem]
    target_cpm: float
    target_source: str
    total_attempts: int
    best_cpm: float
    latest_cpm: float
    target_reached: bool


class SetReadingTargetRequest(BaseModel):
    target_cpm: float = Field(gt=0, le=500)


class ReadingTargetResponse(BaseModel):
    lesson_id: str
    target_cpm: float
    teacher_id: int
    updated_at: str


# ── GET /api/teacher/students/{student_id}/reading-progress/{lesson_id} ───────

@router.get(
    "/teacher/students/{student_id}/reading-progress/{lesson_id}",
    response_model=StudentReadingProgressResponse,
)
async def get_student_reading_progress(
    student_id: int,
    lesson_id: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Get a student's reading progress curve for a specific lesson (teacher view)."""
    _require_teacher_access_to_student(current_user.id, student_id, db)

    student = db.query(User).filter(User.id == student_id).first()
    if not student:
        raise HTTPException(status_code=404, detail="Student not found")

    records = (
        db.query(ReadingHistory)
        .filter(
            ReadingHistory.student_id == student_id,
            ReadingHistory.lesson_id == lesson_id,
        )
        .order_by(ReadingHistory.created_at.asc())
        .all()
    )

    # Get target
    teacher_target = (
        db.query(ReadingTarget)
        .filter(
            ReadingTarget.lesson_id == lesson_id,
            ReadingTarget.teacher_id == current_user.id,
        )
        .first()
    )
    if teacher_target:
        target_cpm = teacher_target.target_cpm
        target_source = "teacher"
    else:
        target_cpm = 90.0
        target_source = "default"

    best_cpm = max((r.cpm for r in records), default=0)
    latest_cpm = records[-1].cpm if records else 0

    return StudentReadingProgressResponse(
        student_id=student_id,
        student_name=student.name or student.email,
        lesson_id=lesson_id,
        attempts=[
            ReadingAttemptItem(
                id=r.id,
                cpm=r.cpm,
                accuracy=r.accuracy,
                duration_seconds=r.duration_seconds,
                reading_type=r.reading_type,
                paragraph_index=r.paragraph_index,
                created_at=r.created_at.isoformat(),
            )
            for r in records
        ],
        target_cpm=target_cpm,
        target_source=target_source,
        total_attempts=len(records),
        best_cpm=round(best_cpm, 1),
        latest_cpm=round(latest_cpm, 1),
        target_reached=best_cpm >= target_cpm,
    )


# ── PUT /api/teacher/reading-targets/{lesson_id} ─────────────────────────────

@router.put("/teacher/reading-targets/{lesson_id}", response_model=ReadingTargetResponse)
async def set_reading_target(
    lesson_id: str,
    payload: SetReadingTargetRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Set or update the CPM target for a lesson (teacher only)."""
    existing = (
        db.query(ReadingTarget)
        .filter(
            ReadingTarget.lesson_id == lesson_id,
            ReadingTarget.teacher_id == current_user.id,
        )
        .first()
    )

    if existing:
        existing.target_cpm = payload.target_cpm
        db.commit()
        db.refresh(existing)
        target = existing
    else:
        target = ReadingTarget(
            teacher_id=current_user.id,
            lesson_id=lesson_id,
            target_cpm=payload.target_cpm,
        )
        db.add(target)
        db.commit()
        db.refresh(target)

    return ReadingTargetResponse(
        lesson_id=target.lesson_id,
        target_cpm=target.target_cpm,
        teacher_id=target.teacher_id,
        updated_at=target.updated_at.isoformat(),
    )
