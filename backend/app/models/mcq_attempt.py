"""MCQ Attempt model — one row per student answer click.

Records every MCQ choice (right or wrong) so teachers can see students who
keep getting questions wrong without engaging the AI rescue tutor (Issue #1507).

Whether the student actually engaged the rescue tutor is derivable by
joining mcq_rescue_session on (user_id, lesson_id, question_id); no
dedicated flag is needed on this table.

Migration: backend/alembic/versions/j5e6f7a8b9c0_create_mcq_attempt.py

Issue #3028 — single-choice accuracy "stars" need three more facts this
table didn't have, each serving a distinct consumer:

  - session_id   Resolved server-side from the student's in_progress
                 LearningSession for this lesson (nullable — a student can
                 answer outside any session, e.g. from the practice
                 toolbox). Without it, attempt counting for a question
                 accumulates across every time the student has ever done
                 the lesson, including last semester, so accuracy can only
                 ever go down and never recovers. It also fixes a standing
                 bug in live_monitor_service's "stuck on this question"
                 signal, which today counts wrong answers with no session
                 or time scope at all (see that module's docstring).
  - attempt_no   This attempt's 1-based ordinal within (session_id,
                 question_id). NULL whenever session_id is NULL — we never
                 guess an ordinal we can't actually attribute to a session.
                 Stored rather than computed at query time: the star-rating
                 and per-student-trajectory queries become a plain
                 MAX(attempt_no)/ORDER BY instead of a window function, and
                 the value survives if rows are ever pruned.
  - choice_text  The option's literal text, not just its letter. choice
                 (existing, VARCHAR(8)) only stores "A"/"B"/"C"/"D", which
                 is useless for "what did 12 students who got this wrong
                 actually pick" (the class-wide distractor-distribution
                 view a teacher would use to plan tomorrow's lesson).

Existing rows are left NULL for all three — no backfill. A backfilled
session_id would invent a session attribution we cannot actually prove;
better for old rows to simply not count toward star ratings than to
silently fabricate one. Every query against these three fields must filter
`session_id IS NOT NULL` so pre-migration rows never pollute a denominator.
"""

from __future__ import annotations

from sqlalchemy import (
    Boolean,
    Column,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    String,
    func,
)
from sqlalchemy.orm import relationship

from .base import Base


class McqAttempt(Base):
    """One row per MCQ choice the student commits."""

    __tablename__ = "mcq_attempt"

    id = Column(Integer, primary_key=True, autoincrement=True)

    user_id = Column(
        Integer,
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    lesson_id = Column(String(128), nullable=False, index=True)
    question_id = Column(String(128), nullable=False, index=True)

    choice = Column(String(8), nullable=False)
    is_correct = Column(Boolean, nullable=False)

    # ── Issue #3028 — nullable, no backfill, see module docstring ──────────
    session_id = Column(
        Integer,
        ForeignKey("learning_sessions.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    attempt_no = Column(Integer, nullable=True)
    choice_text = Column(String(255), nullable=True)

    created_at = Column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
    )

    user = relationship(
        "User",
        back_populates=None,
        lazy="select",
        foreign_keys=[user_id],
    )
    session = relationship(
        "LearningSession",
        back_populates=None,
        lazy="select",
        foreign_keys=[session_id],
    )

    __table_args__ = (
        Index("ix_mcq_attempt_user_lesson", "user_id", "lesson_id"),
    )
