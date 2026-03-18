"""StoryTag — teacher-defined difficulty and custom tags for stories.

Supports both platform stories (identified by lesson_number) and
teacher-created texts (identified by text_id). One row per teacher per story.
"""

from datetime import datetime

from sqlalchemy import (
    DateTime,
    ForeignKey,
    Integer,
    String,
    JSON,
    UniqueConstraint,
    func,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .base import Base


class StoryTag(Base):
    """Teacher-defined tags and difficulty override for a story.

    NOTE: DB migration required before this table is live.
    Fields: teacher_id, story_ref (lesson_number as string or 'text:{text_id}'),
    difficulty_level, custom_tags (JSON array of strings).
    """

    __tablename__ = "story_tags"
    __table_args__ = (UniqueConstraint("teacher_id", "story_ref"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)

    teacher_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    # For platform stories: str(lesson_number), e.g. "3"
    # For teacher texts: "text:{text_id}", e.g. "text:42"
    story_ref: Mapped[str] = mapped_column(String(50), nullable=False, index=True)

    # "easy" / "medium" / "hard" — overrides grade-based auto-detection
    difficulty_level: Mapped[str | None] = mapped_column(String(20), nullable=True)

    # Free-form custom tags list, e.g. ["重要考題", "期末複習"]
    custom_tags: Mapped[list | None] = mapped_column(JSON, nullable=True)

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
        nullable=False,
    )

    teacher: Mapped["User"] = relationship("User", foreign_keys=[teacher_id])  # type: ignore[name-defined]
