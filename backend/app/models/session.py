from datetime import datetime

from sqlalchemy import String, Integer, Float, Boolean, Text, ForeignKey, DateTime, func
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
    ai_analysis: Mapped[str | None] = mapped_column(Text, nullable=True, default=None)
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
    dialogue_turns: Mapped[list["DialogueTurn"]] = relationship(
        "DialogueTurn", back_populates="learning_session", order_by="DialogueTurn.turn_order"
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


class DialogueTurn(Base):
    """Stores individual turns from a Socratic comprehension dialogue.

    Keyed by the UUID `socratic_session_id` used by the in-memory agent.
    When the caller also provides a `learning_session_id` (DB LearningSession PK),
    the turns are linked so they can be retrieved via
    GET /api/learning/sessions/{id}/dialogue.
    """

    __tablename__ = "dialogue_turns"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    # UUID string from the in-memory socratic agent session
    socratic_session_id: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    # Optional link to the DB LearningSession
    learning_session_id: Mapped[int | None] = mapped_column(
        ForeignKey("learning_sessions.id"), nullable=True, index=True
    )
    # 0-based ordering within the socratic session
    turn_order: Mapped[int] = mapped_column(Integer, nullable=False)
    # "ai" | "student" | "feedback"
    role: Mapped[str] = mapped_column(String(20), nullable=False)
    text: Mapped[str] = mapped_column(String(2000), nullable=False)
    # Only set for feedback turns (True = correct, False = incorrect)
    is_correct: Mapped[bool | None] = mapped_column(Boolean, nullable=True)
    # Phase at this point ("factual" | "inferential" | "evaluative")
    phase: Mapped[str | None] = mapped_column(String(20), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    learning_session: Mapped["LearningSession | None"] = relationship(
        "LearningSession", back_populates="dialogue_turns"
    )
