from datetime import datetime
from sqlalchemy import String, Integer, Float, ForeignKey, DateTime
from sqlalchemy.orm import Mapped, mapped_column, relationship
from .base import Base


class LearningSession(Base):
    __tablename__ = "learning_sessions"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    student_id: Mapped[int] = mapped_column(ForeignKey("students.id"), nullable=False)
    text_id: Mapped[int] = mapped_column(ForeignKey("texts.id"), nullable=False)
    current_step: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    accuracy: Mapped[float | None] = mapped_column(Float, nullable=True)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)

    student: Mapped["Student"] = relationship("Student", back_populates="sessions")  # type: ignore[name-defined]
    text: Mapped["Text"] = relationship("Text", back_populates="sessions")  # type: ignore[name-defined]
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
