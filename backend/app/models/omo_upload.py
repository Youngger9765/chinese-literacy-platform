"""OMO (Online-Merge-Offline) upload models.

Phase 1a: upload + AI lesson identification + multi-attempt + grading.
Phase 1b: image_hash dedup on OmoUploadAttempt.

sqlalchemy-model-safety checklist:
- FK with index=True (Rule 1) ✅
- timestamps with server_default=func.now() (Rule 2) ✅
- relationship with cascade + lazy (Rule 3) ✅
- JSONB columns with server_default (Rule 4) ✅
- status enum as String(32) with server_default (Rule 5) ✅
- image_hash index=True (Rule 1) ✅
"""

from datetime import datetime
from typing import Optional

from sqlalchemy import Boolean, Float, ForeignKey, Integer, String, DateTime, func, Index
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .base import Base


class OmoUpload(Base):
    """Stores a student's paper worksheet upload session and AI grading result.

    Status lifecycle:
        pending       → record created, no images yet
        identifying   → AI Gemini identification in progress
        identified    → AI returned top-3 candidates; waiting for student confirm
        grading       → student confirmed lesson; grading job in progress
        graded        → per-question answers extracted and scored
        error         → any step failed (see error_message)

    Phase 1a replaces the earlier Phase 1 model — adds multi-attempt support
    (omo_upload_attempts), answers JSONB, and progress JSONB.
    """

    __tablename__ = "omo_uploads"
    __table_args__ = (
        Index("ix_omo_uploads_student_lesson", "student_id", "lesson_id"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)

    # Student who uploaded — NOT linked to a LearningSession in Phase 1
    student_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    # Confirmed lesson_id (integer lesson_number from lesson_loader).
    # NULL until student confirms the AI's identification candidate.
    lesson_id: Mapped[Optional[int]] = mapped_column(Integer, nullable=True, index=True)

    # AI identification result: top-3 candidates with confidence
    # Shape: [{"lesson_id": int, "grade_code": str, "title": str, "confidence": float, "reasoning": str}]
    identification: Mapped[Optional[list]] = mapped_column(JSONB, nullable=True)

    # Per-question grading answers JSONB array.
    # Each element shape:
    # {
    #   "question_id": "fb_1",
    #   "student_answer": "偷出狐白裘",
    #   "correct_answer": "偷出狐白裘",
    #   "score": 1.0,
    #   "ai_confidence": 0.95,
    #   "reasoning": "...",
    #   "source_attempt_id": 12,
    #   "position": {"x": 0.45, "y": 0.32},
    #   "flag": null | {"flagged_by": int, "reason": str, "flagged_at": str}
    # }
    answers: Mapped[list] = mapped_column(
        JSONB, nullable=False, server_default="'[]'::jsonb"
    )

    # Grading progress and overall score
    overall_score: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    ai_overall_confidence: Mapped[Optional[float]] = mapped_column(Float, nullable=True)

    # Progress tracking for async grading job
    # Shape: {"total": int, "graded": int, "stage": str}
    progress: Mapped[dict] = mapped_column(
        JSONB, nullable=False, server_default="'{}'::jsonb"
    )

    # Status of AI pipeline
    status: Mapped[str] = mapped_column(
        String(32), nullable=False, server_default="pending", index=True
    )

    # AI error message (if status == "error")
    error_message: Mapped[Optional[str]] = mapped_column(String(500), nullable=True)

    # Upload-replace UX: timestamp when a newer upload supersedes this one
    superseded_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), nullable=True
    )

    # Top-1 candidate confidence (denormalised for quick filtering)
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

    # Relationships
    student: Mapped["User"] = relationship(  # type: ignore[name-defined]
        "User",
        lazy="select",
    )
    attempts: Mapped[list["OmoUploadAttempt"]] = relationship(
        "OmoUploadAttempt",
        back_populates="upload",
        cascade="all, delete-orphan",
        lazy="selectin",
        order_by="OmoUploadAttempt.attempt_idx",
    )


class OmoUploadAttempt(Base):
    """One capture attempt within an OMO upload session.

    A student may photograph the same worksheet multiple times
    (e.g. front page + back page, or retake a blurry shot).
    All attempts are kept permanently — never auto-deleted.

    Phase 1a: supports multi-page worksheets and retakes.
    """

    __tablename__ = "omo_upload_attempts"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)

    # FK to omo_uploads — Rule 1: must have index=True
    omo_upload_id: Mapped[int] = mapped_column(
        ForeignKey("omo_uploads.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    # 0-based ordering within the upload session
    attempt_idx: Mapped[int] = mapped_column(Integer, nullable=False)

    # GCS object paths for this attempt (one per photo)
    # Shape: ["1/42/0/0.jpg", "1/42/0/1.jpg"]
    image_paths: Mapped[list] = mapped_column(
        JSONB, nullable=False, server_default="'[]'::jsonb"
    )

    # SHA-256 content hash of the primary uploaded image (first file).
    # Used for dedup: if same hash + same student already exists, skip re-identification.
    # Empty string for legacy records that pre-date Phase 1b.
    # index=False here — the index is declared in __table_args__ below to avoid duplication.
    image_hash: Mapped[str] = mapped_column(
        String(64), nullable=False, server_default=""
    )

    # Short OCR preview text extracted from the image (for display before grading)
    ocr_preview: Mapped[Optional[str]] = mapped_column(String(500), nullable=True)

    # Whether this attempt is the "active" one used for grading
    # (latest by default; student or teacher can switch)
    is_active: Mapped[bool] = mapped_column(
        Boolean, nullable=False, server_default="true"
    )

    captured_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    upload: Mapped["OmoUpload"] = relationship(
        "OmoUpload",
        back_populates="attempts",
    )

    __table_args__ = (
        Index("ix_omo_upload_attempts_upload_id", "omo_upload_id"),
        Index("ix_omo_upload_attempts_image_hash", "image_hash"),
    )
