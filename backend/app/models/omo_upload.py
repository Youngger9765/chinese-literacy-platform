"""OMO (Online-Merge-Offline) upload model.

Phase 1: upload + AI lesson identification only.
Phase 2+: answer extraction, grading, teacher review (deferred).

sqlalchemy-model-safety checklist:
- FK with index=True (Rule 1) ✅
- timestamps with server_default=func.now() (Rule 2) ✅
- relationship with cascade + lazy (Rule 3) ✅
- JSONB columns with server_default (Rule 4) ✅
- status enum as String(32) with server_default (Rule 5) ✅
"""

from datetime import datetime
from typing import Optional

from sqlalchemy import Float, ForeignKey, Integer, String, DateTime, func, Index
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .base import Base


class OmoUpload(Base):
    """Stores a student's paper worksheet photo upload and AI identification result.

    Status lifecycle:
        pending       → image uploaded, AI identification not started
        identifying   → AI Gemini call in progress
        identified    → AI returned top-3 lesson candidates; waiting for student confirm
        failed        → AI identification failed (blur, no match, quota)

    Phase 2 will add: extracted / graded / applied statuses for answer extraction.
    """

    __tablename__ = "omo_uploads"
    __table_args__ = (
        # Compound index: student's uploads by lesson for quick history lookup
        Index("ix_omo_uploads_student_lesson", "student_id", "lesson_id"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)

    # Student who uploaded — NOT linked to a LearningSession in Phase 1
    # (session is created only after student confirms the identified lesson)
    student_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        index=True,   # Rule 1: FK must have index=True
    )

    # Confirmed lesson_id (integer lesson_number from lesson_loader).
    # NULL until student confirms the AI's identification candidate.
    lesson_id: Mapped[Optional[int]] = mapped_column(Integer, nullable=True, index=True)

    # GCS object paths — list of strings like
    # "{user_id}/{upload_id}/{n}.jpg"
    # Signed URLs are generated on-the-fly, not stored.
    image_paths: Mapped[list] = mapped_column(
        JSONB, nullable=False, server_default="'[]'::jsonb"
    )

    # AI identification result: top-3 candidates with confidence
    # Shape: [{"lesson_id": int, "grade_code": str, "title": str, "confidence": float}]
    identification: Mapped[Optional[dict]] = mapped_column(JSONB, nullable=True)

    # Status of AI pipeline
    status: Mapped[str] = mapped_column(
        String(32), nullable=False, server_default="pending", index=True
    )

    # AI error message (if status == "failed")
    error_message: Mapped[Optional[str]] = mapped_column(String(500), nullable=True)

    # Overall confidence from top-1 candidate (denormalised for quick filtering)
    ai_confidence: Mapped[Optional[float]] = mapped_column(Float, nullable=True)

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
        nullable=False,
    )

    # Relationship back to user (load on demand — uploads list rarely needs user)
    student: Mapped["User"] = relationship(  # type: ignore[name-defined]
        "User",
        lazy="select",
    )
