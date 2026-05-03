"""
MCQ Rescue Session model — tracks per-student rescue dialogue outcomes.

TODO: Alembic migration pending Young's approval — see #1387 acceptance criteria.
      Run `alembic revision --autogenerate -m "add mcq_rescue_session table"` after approval.
      Must follow LingoLeap SQLAlchemy safety rules:
        - FK index=True (already set below)
        - server_default for timestamps
        - cascade + lazy on relationships
        - Idempotent DDL (IF NOT EXISTS) in migration

This stub is import-safe and will not create the table until a migration runs.
"""

from __future__ import annotations

from sqlalchemy import (
    Column,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    func,
)
from sqlalchemy.orm import relationship

from .base import Base


class McqRescueSession(Base):
    """Records a single MCQ rescue dialogue between a student and the AI tutor.

    One row per (user_id, question_id) rescue attempt.
    Multiple retries on the same question create new rows.
    """

    __tablename__ = "mcq_rescue_session"

    id = Column(Integer, primary_key=True, autoincrement=True)

    # Who did the rescue?
    user_id = Column(
        Integer,
        ForeignKey("user.id", ondelete="CASCADE"),
        nullable=False,
        index=True,  # LingoLeap rule: FK always has index=True
    )

    # Which MCQ question triggered the rescue?
    question_id = Column(String(128), nullable=False, index=True)

    # Which lesson (story) does the question belong to?
    lesson_id = Column(String(128), nullable=False, index=True)

    # The wrong choice the student picked (e.g. "A", "B")
    wrong_choice = Column(String(8), nullable=False)

    # Lifecycle timestamps — server_default per LingoLeap SQLAlchemy safety rules
    started_at = Column(DateTime, nullable=False, server_default=func.now())
    ended_at = Column(DateTime, nullable=True)

    # Outcome
    total_turns = Column(Integer, nullable=False, default=0)
    final_step = Column(Integer, nullable=True)     # 1-5, which step we ended at
    outcome = Column(
        String(32),
        nullable=True,
        # Allowed values: "passed" | "gave_up" | "timeout" | "direct_teach" | "error"
    )
    retry_count = Column(Integer, nullable=False, default=0)  # times student retried rescue

    # Relationships
    user = relationship(
        "User",
        back_populates=None,   # User model doesn't back-populate this (avoid touching User model)
        lazy="select",         # explicit lazy per LingoLeap safety rules
        foreign_keys=[user_id],
    )

    __table_args__ = (
        # Composite index for the common query pattern: "all rescues for this user on this lesson"
        Index("ix_mcq_rescue_session_user_lesson", "user_id", "lesson_id"),
    )
