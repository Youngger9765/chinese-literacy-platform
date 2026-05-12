"""MCQ Attempt model — one row per student answer click.

Records every MCQ choice (right or wrong) so teachers can see students who
keep getting questions wrong without engaging the AI rescue tutor (Issue #1507).

Whether the student actually engaged the rescue tutor is derivable by
joining mcq_rescue_session on (user_id, lesson_id, question_id); no
dedicated flag is needed on this table.

Migration: backend/alembic/versions/j5e6f7a8b9c0_create_mcq_attempt.py
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

    __table_args__ = (
        Index("ix_mcq_attempt_user_lesson", "user_id", "lesson_id"),
    )
