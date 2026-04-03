"""Reading History model for tracking repeated reading attempts.

Each record represents one reading attempt (either paragraph-level from LiveTutor
or full-text from FullReading). Supports progress curves and CPM target tracking.

Issue #909: 重複朗讀 + 進步曲線
"""
from datetime import datetime
from sqlalchemy import String, Integer, Float, ForeignKey, DateTime, func
from sqlalchemy.orm import Mapped, mapped_column, relationship
from .base import Base


class ReadingHistory(Base):
    """One reading attempt for a student on a specific lesson/paragraph."""
    __tablename__ = "reading_history"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    student_id: Mapped[int] = mapped_column(ForeignKey("users.id"), nullable=False, index=True)
    lesson_id: Mapped[str] = mapped_column(String(100), nullable=False, index=True)
    # NULL = full reading; 0-based index = specific paragraph in LiveTutor
    paragraph_index: Mapped[int | None] = mapped_column(Integer, nullable=True)
    # reading_type: "paragraph" (LiveTutor) or "full" (FullReading)
    reading_type: Mapped[str] = mapped_column(String(20), nullable=False, default="full")
    cpm: Mapped[float] = mapped_column(Float, nullable=False)
    accuracy: Mapped[float] = mapped_column(Float, nullable=False)
    duration_seconds: Mapped[float] = mapped_column(Float, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    student: Mapped["User"] = relationship("User")  # type: ignore[name-defined]


class ReadingTarget(Base):
    """Teacher-set CPM target for a specific lesson (optional).

    If no target exists, the system uses a grade-based default.
    """
    __tablename__ = "reading_targets"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    teacher_id: Mapped[int] = mapped_column(ForeignKey("users.id"), nullable=False, index=True)
    lesson_id: Mapped[str] = mapped_column(String(100), nullable=False, index=True)
    target_cpm: Mapped[float] = mapped_column(Float, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )

    teacher: Mapped["User"] = relationship("User")  # type: ignore[name-defined]
