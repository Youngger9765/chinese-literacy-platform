from datetime import datetime
from sqlalchemy import String, Integer, Float, ForeignKey, DateTime, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship
from .base import Base


class LearningSession(Base):
    __tablename__ = "learning_sessions"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    student_id: Mapped[int] = mapped_column(ForeignKey("users.id"), nullable=False, index=True)
    text_id: Mapped[int | None] = mapped_column(ForeignKey("texts.id"), nullable=True)
    classroom_id: Mapped[int | None] = mapped_column(ForeignKey("classrooms.id"), nullable=True)
    story_slug: Mapped[str | None] = mapped_column(String(100), nullable=True, index=True)
    status: Mapped[str] = mapped_column(String(20), nullable=False, server_default="in_progress")
    current_step: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    accuracy: Mapped[float | None] = mapped_column(Float, nullable=True)
    overall_score: Mapped[float | None] = mapped_column(Float, nullable=True)
    reading_result: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    comprehension_result: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    vocab_result: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    full_reading_result: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    started_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    student: Mapped["User"] = relationship("User", back_populates="sessions")  # type: ignore[name-defined]
    text: Mapped["Text"] = relationship("Text", back_populates="sessions")  # type: ignore[name-defined]
    classroom: Mapped["Classroom | None"] = relationship("Classroom")  # type: ignore[name-defined]
    character_errors: Mapped[list["CharacterError"]] = relationship(
        "CharacterError", back_populates="session"
    )


class CharacterError(Base):
    __tablename__ = "character_errors"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    session_id: Mapped[int] = mapped_column(ForeignKey("learning_sessions.id"), nullable=False)
    character: Mapped[str] = mapped_column(String(4), nullable=False)
    error_type: Mapped[str] = mapped_column(String(50), nullable=False)

    session: Mapped[LearningSession] = relationship(
        "LearningSession", back_populates="character_errors"
    )
