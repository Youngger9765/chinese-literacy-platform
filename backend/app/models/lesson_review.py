"""Lesson review (學習批閱, #4104) — a teacher's review of one student's lesson.

One ``LessonReview`` row per (student, lesson). It holds what the student sees
(``total_score`` + the ``LessonReviewStep`` rows, written only when the teacher
presses 「送出給學生」) and the teacher's unsent edits (``draft``).

Why a table and not ``learning_sessions.step_progress``: that JSONB is written
by the student's own ``PUT /progress``. Anything stored there could be changed
by the student or overwritten by their next save.

Why keyed by lesson and not by session: redoing a lesson opens a new session
that carries the previous progress forward (#2889). A review tied to one
session would vanish the moment the student redoes the lesson.

A returned step is "redone" when the student's step data for that step changed
after ``returned_at`` — computed at read time from
``step_progress.__meta.step_activity`` (stamped by the server in
``save_step_progress``), not stored here.
"""

from __future__ import annotations

from datetime import datetime

from sqlalchemy import (
    Boolean,
    DateTime,
    ForeignKey,
    Integer,
    String,
    Text,
    UniqueConstraint,
    func,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .base import Base


class LessonReview(Base):
    __tablename__ = "lesson_reviews"
    __table_args__ = (
        UniqueConstraint("student_id", "story_slug", name="uq_lesson_reviews_student_story"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    student_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    # Same key as learning_sessions.story_slug / GET /library/status (lesson number string).
    story_slug: Mapped[str] = mapped_column(String(100), nullable=False, index=True)
    # The classroom the review was made from (audit / which class view it belongs to).
    classroom_id: Mapped[int | None] = mapped_column(
        ForeignKey("classrooms.id", ondelete="SET NULL"), nullable=True, index=True
    )
    # Last teacher who sent it (co-teachers may review — #4104 decision 4).
    teacher_id: Mapped[int | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True
    )
    total_score: Mapped[int | None] = mapped_column(Integer, nullable=True)
    sent_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    # Teacher's unsent edits: {"total_score": int|None, "steps": {step_key: {returned, comment, score}}}.
    # Never shown to the student. Cleared on send.
    draft: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )

    steps: Mapped[list["LessonReviewStep"]] = relationship(
        back_populates="review", cascade="all, delete-orphan", passive_deletes=True
    )


class LessonReviewStep(Base):
    """What the student was sent for one step of the lesson."""

    __tablename__ = "lesson_review_steps"
    __table_args__ = (
        UniqueConstraint("review_id", "step_key", name="uq_lesson_review_steps_review_step"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    review_id: Mapped[int] = mapped_column(
        ForeignKey("lesson_reviews.id", ondelete="CASCADE"), nullable=False, index=True
    )
    # Round-keyed step id as used in step_progress (e.g. "comprehension#c9fyn").
    step_key: Mapped[str] = mapped_column(String(100), nullable=False)
    returned: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, server_default="false")
    returned_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    comment: Mapped[str | None] = mapped_column(Text, nullable=True)
    score: Mapped[int | None] = mapped_column(Integer, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )

    review: Mapped[LessonReview] = relationship(back_populates="steps")
