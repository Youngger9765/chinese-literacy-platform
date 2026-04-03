"""Reading history routes — repeated reading progress tracking.

POST /api/reading-history          — save a reading attempt
GET  /api/reading-history/{student_id}/{lesson_id} — get reading history for a student+lesson
GET  /api/reading-history/{student_id}/{lesson_id}/summary — get summary stats

Issue #909: 重複朗讀 + 進步曲線
"""
import logging
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy import desc
from sqlalchemy.orm import Session

from ...auth.dependencies import get_current_user
from ...database import get_db
from ...models.reading_history import ReadingHistory, ReadingTarget
from ...models.user import User
from ._helpers import verify_student_access

router = APIRouter()
logger = logging.getLogger(__name__)

# Grade-based default CPM targets (characters per minute)
# Based on 曾世杰教授研究 — grade 3-4: 80, grade 5-6: 100, grade 7+: 120
DEFAULT_CPM_TARGETS = {
    3: 80,
    4: 80,
    5: 100,
    6: 100,
    7: 120,
    8: 120,
    9: 120,
}
FALLBACK_CPM_TARGET = 90


# ── Request / Response schemas ────────────────────────────────────────────────

class ReadingHistoryCreate(BaseModel):
    lesson_id: str
    paragraph_index: Optional[int] = None
    reading_type: str = "full"  # "paragraph" or "full"
    cpm: float = Field(ge=0)
    accuracy: float = Field(ge=0, le=100)
    duration_seconds: float = Field(gt=0)


class ReadingHistoryItem(BaseModel):
    id: int
    student_id: int
    lesson_id: str
    paragraph_index: Optional[int]
    reading_type: str
    cpm: float
    accuracy: float
    duration_seconds: float
    created_at: str

    class Config:
        from_attributes = True


class ReadingHistoryResponse(BaseModel):
    history: list[ReadingHistoryItem]
    target_cpm: float
    target_source: str  # "teacher" or "default"


class ReadingProgressSummary(BaseModel):
    total_attempts: int
    best_cpm: float
    latest_cpm: float
    best_accuracy: float
    latest_accuracy: float
    cpm_improvement_pct: float  # % improvement from first to latest
    target_cpm: float
    target_reached: bool
    encouragement: str


# ── POST /api/reading-history ─────────────────────────────────────────────────

@router.post("/reading-history", response_model=ReadingHistoryItem)
async def save_reading_history(
    payload: ReadingHistoryCreate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Save a reading attempt for the current user."""
    record = ReadingHistory(
        student_id=current_user.id,
        lesson_id=payload.lesson_id,
        paragraph_index=payload.paragraph_index,
        reading_type=payload.reading_type,
        cpm=payload.cpm,
        accuracy=payload.accuracy,
        duration_seconds=payload.duration_seconds,
    )
    db.add(record)
    db.commit()
    db.refresh(record)

    # Check if student hit teacher's target — notify if so
    _check_target_reached(current_user.id, payload.lesson_id, payload.cpm, db)

    return ReadingHistoryItem(
        id=record.id,
        student_id=record.student_id,
        lesson_id=record.lesson_id,
        paragraph_index=record.paragraph_index,
        reading_type=record.reading_type,
        cpm=record.cpm,
        accuracy=record.accuracy,
        duration_seconds=record.duration_seconds,
        created_at=record.created_at.isoformat(),
    )


# ── GET /api/reading-history/{student_id}/{lesson_id} ─────────────────────────

@router.get("/reading-history/{student_id}/{lesson_id}", response_model=ReadingHistoryResponse)
async def get_reading_history(
    student_id: int,
    lesson_id: str,
    reading_type: Optional[str] = Query(None, description="Filter by reading_type: 'paragraph' or 'full'"),
    paragraph_index: Optional[int] = Query(None, description="Filter by paragraph_index (for LiveTutor)"),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Get reading history for a student on a specific lesson."""
    verify_student_access(student_id, current_user, db)

    query = (
        db.query(ReadingHistory)
        .filter(
            ReadingHistory.student_id == student_id,
            ReadingHistory.lesson_id == lesson_id,
        )
    )
    if reading_type:
        query = query.filter(ReadingHistory.reading_type == reading_type)
    if paragraph_index is not None:
        query = query.filter(ReadingHistory.paragraph_index == paragraph_index)

    records = query.order_by(ReadingHistory.created_at.asc()).all()

    target_cpm, target_source = _get_target_cpm(student_id, lesson_id, db)

    return ReadingHistoryResponse(
        history=[
            ReadingHistoryItem(
                id=r.id,
                student_id=r.student_id,
                lesson_id=r.lesson_id,
                paragraph_index=r.paragraph_index,
                reading_type=r.reading_type,
                cpm=r.cpm,
                accuracy=r.accuracy,
                duration_seconds=r.duration_seconds,
                created_at=r.created_at.isoformat(),
            )
            for r in records
        ],
        target_cpm=target_cpm,
        target_source=target_source,
    )


# ── GET /api/reading-history/{student_id}/{lesson_id}/summary ─────────────────

@router.get("/reading-history/{student_id}/{lesson_id}/summary", response_model=ReadingProgressSummary)
async def get_reading_summary(
    student_id: int,
    lesson_id: str,
    reading_type: Optional[str] = Query("full"),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Get summary stats and encouragement for a student's reading progress."""
    verify_student_access(student_id, current_user, db)

    query = (
        db.query(ReadingHistory)
        .filter(
            ReadingHistory.student_id == student_id,
            ReadingHistory.lesson_id == lesson_id,
        )
    )
    if reading_type:
        query = query.filter(ReadingHistory.reading_type == reading_type)

    records = query.order_by(ReadingHistory.created_at.asc()).all()

    if not records:
        target_cpm, _ = _get_target_cpm(student_id, lesson_id, db)
        return ReadingProgressSummary(
            total_attempts=0,
            best_cpm=0,
            latest_cpm=0,
            best_accuracy=0,
            latest_accuracy=0,
            cpm_improvement_pct=0,
            target_cpm=target_cpm,
            target_reached=False,
            encouragement="開始你的第一次朗讀吧！",
        )

    best_cpm = max(r.cpm for r in records)
    latest_cpm = records[-1].cpm
    best_accuracy = max(r.accuracy for r in records)
    latest_accuracy = records[-1].accuracy
    first_cpm = records[0].cpm
    improvement = ((latest_cpm - first_cpm) / first_cpm * 100) if first_cpm > 0 else 0

    target_cpm, _ = _get_target_cpm(student_id, lesson_id, db)
    target_reached = best_cpm >= target_cpm

    encouragement = _generate_encouragement(records, improvement, target_reached, target_cpm)

    return ReadingProgressSummary(
        total_attempts=len(records),
        best_cpm=round(best_cpm, 1),
        latest_cpm=round(latest_cpm, 1),
        best_accuracy=round(best_accuracy, 1),
        latest_accuracy=round(latest_accuracy, 1),
        cpm_improvement_pct=round(improvement, 1),
        target_cpm=target_cpm,
        target_reached=target_reached,
        encouragement=encouragement,
    )


# ── Helpers ───────────────────────────────────────────────────────────────────

def _get_target_cpm(student_id: int, lesson_id: str, db: Session) -> tuple[float, str]:
    """Get the CPM target for a student+lesson. Teacher-set takes priority."""
    teacher_target = (
        db.query(ReadingTarget)
        .filter(ReadingTarget.lesson_id == lesson_id)
        .order_by(desc(ReadingTarget.updated_at))
        .first()
    )
    if teacher_target:
        return teacher_target.target_cpm, "teacher"

    return FALLBACK_CPM_TARGET, "default"


def _check_target_reached(student_id: int, lesson_id: str, cpm: float, db: Session) -> None:
    """Check if the student just reached the target. Log it for teacher notification."""
    target_cpm, _ = _get_target_cpm(student_id, lesson_id, db)
    if cpm >= target_cpm:
        # Check if this is the FIRST time reaching the target
        previous_hits = (
            db.query(ReadingHistory)
            .filter(
                ReadingHistory.student_id == student_id,
                ReadingHistory.lesson_id == lesson_id,
                ReadingHistory.cpm >= target_cpm,
            )
            .count()
        )
        if previous_hits <= 1:  # Just this one (already committed)
            logger.info(
                "Student %d reached CPM target %.0f for lesson %s (actual: %.0f)",
                student_id, target_cpm, lesson_id, cpm,
            )
            # Future: push notification to teacher via WebSocket or notification table


def _generate_encouragement(
    records: list[ReadingHistory],
    improvement_pct: float,
    target_reached: bool,
    target_cpm: float,
) -> str:
    """Generate a motivational message based on progress."""
    n = len(records)

    if target_reached:
        return f"太棒了！你已經達到目標速度 {target_cpm:.0f} 字/分鐘！繼續保持"

    if n == 1:
        return "好的開始！再讀一次，看看能不能更快更準確"

    if improvement_pct > 20:
        return f"進步驚人！速度提升了 {improvement_pct:.0f}%，繼續加油"
    elif improvement_pct > 10:
        return f"穩定進步中！速度提升了 {improvement_pct:.0f}%，再讀一次會更好"
    elif improvement_pct > 0:
        return f"你的速度提升了 {improvement_pct:.0f}%！再讀一次會更好"
    elif improvement_pct > -5:
        return "保持得很好！多練習幾次，速度會越來越快"
    else:
        return "別擔心，每個人都有起伏，再試一次吧"
