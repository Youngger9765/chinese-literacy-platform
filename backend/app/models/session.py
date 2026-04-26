from datetime import datetime
from sqlalchemy import String, Integer, Float, Boolean, Text, ForeignKey, DateTime, Index, func, text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship
from .base import Base


class ErrorCorrection(Base):
    """Tracks when a student marks a character as practiced or mastered."""
    __tablename__ = "error_corrections"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    student_id: Mapped[int] = mapped_column(ForeignKey("users.id"), nullable=False, index=True)
    character: Mapped[str] = mapped_column(String(10), nullable=False)
    correction_type: Mapped[str] = mapped_column(String(20), default="practice")  # practice, mastered
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    student: Mapped["User"] = relationship("User")  # type: ignore[name-defined]


class LearningSession(Base):
    __tablename__ = "learning_sessions"
    __table_args__ = (
        # Prevent duplicate in_progress sessions for same student + story (#1179)
        Index(
            "uq_session_student_story_inprogress",
            "student_id",
            "story_slug",
            unique=True,
            postgresql_where=text("status = 'in_progress' AND story_slug IS NOT NULL"),
        ),
        # Compound index for student dashboard session filter (#1223)
        Index("ix_learning_sessions_student_id_status", "student_id", "status"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    student_id: Mapped[int] = mapped_column(ForeignKey("users.id"), nullable=False, index=True)
    text_id: Mapped[int | None] = mapped_column(ForeignKey("texts.id"), nullable=True)
    classroom_id: Mapped[int | None] = mapped_column(ForeignKey("classrooms.id"), nullable=True)
    story_slug: Mapped[str | None] = mapped_column(String(100), nullable=True, index=True)
    status: Mapped[str] = mapped_column(String(20), nullable=False, server_default="in_progress", index=True)
    # DEPRECATED (#1182): use step_progress.steps_completed as single source of truth.
    # Do NOT write to this column from new code. Column retained pre-demo; drop in a post-demo PR.
    # Read via the current_step_derived property instead.
    current_step: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    accuracy: Mapped[float | None] = mapped_column(Float, nullable=True)
    overall_score: Mapped[float | None] = mapped_column(Float, nullable=True)
    reading_result: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    comprehension_result: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    vocab_result: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    full_reading_result: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    # General step progress store for all learning steps (Issue #660)
    # Stores current_step, steps_completed[], and per-step step_data
    step_progress: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    # Serialized Socratic SessionState snapshot for fast Cloud Run restart recovery (Issue #961)
    dialogue_state: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    ai_analysis: Mapped[str | None] = mapped_column(Text, nullable=True, default=None)
    # Teacher review fields (Issue #993)
    ai_comment: Mapped[str | None] = mapped_column(Text, nullable=True, default=None)
    teacher_comment: Mapped[str | None] = mapped_column(Text, nullable=True, default=None)
    teacher_reviewed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True, default=None)
    # 3-level comprehension scoring (Issue #243)
    comprehension_score: Mapped[float | None] = mapped_column(Float, nullable=True)
    literal_score: Mapped[float | None] = mapped_column(Float, nullable=True)
    inferential_score: Mapped[float | None] = mapped_column(Float, nullable=True)
    evaluative_score: Mapped[float | None] = mapped_column(Float, nullable=True)
    comprehension_feedback: Mapped[str | None] = mapped_column(Text, nullable=True)
    started_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    # ── Derived step number from JSONB (single source of truth) ──────────────
    # Map between integer step numbers and their string keys.
    # Kept here so the derivation is co-located with the model.
    _STEP_KEY_TO_NUM: dict = {
        "intro": 1,
        "live_tutor": 2,
        "comprehension": 3,
        "vocab": 4,
        "full_reading": 5,
        "report": 6,
    }
    _FRONTEND_STEP_ALIAS: dict = {
        "tutor": "live_tutor",
        "full-reading": "full_reading",
        "reading-annotation": "intro",
    }
    _STEP_NUM_TO_KEY: dict = {v: k for k, v in _STEP_KEY_TO_NUM.items()}

    @property
    def current_step_derived(self) -> int:
        """Derive the current step integer from step_progress.steps_completed.

        Returns the step number the student is currently on:
        - max(steps_completed) + 1  when steps_completed is non-empty
        - 1 when no progress recorded

        This is the replacement for the deprecated `current_step` integer column.
        All new code should read this property, not the column. (#1182)
        """
        sp = self.step_progress
        if not isinstance(sp, dict):
            return 1
        raw = sp.get("steps_completed")
        if not isinstance(raw, list) or not raw:
            return 1
        max_num = 0
        for key in raw:
            if not isinstance(key, str):
                continue
            normalized = self._FRONTEND_STEP_ALIAS.get(key, key)
            num = self._STEP_KEY_TO_NUM.get(normalized, 0)
            if num > max_num:
                max_num = num
        if max_num == 0:
            return 1
        return min(max_num + 1, max(self._STEP_KEY_TO_NUM.values()))

    student: Mapped["User"] = relationship("User", back_populates="sessions")  # type: ignore[name-defined]
    text: Mapped["Text"] = relationship("Text", back_populates="sessions")  # type: ignore[name-defined]
    classroom: Mapped["Classroom | None"] = relationship("Classroom")  # type: ignore[name-defined]
    character_errors: Mapped[list["CharacterError"]] = relationship(
        "CharacterError", back_populates="session"
    )
    dialogue_turns: Mapped[list["DialogueTurn"]] = relationship(
        "DialogueTurn",
        back_populates="learning_session",
        order_by="DialogueTurn.turn_order",
        cascade="all, delete-orphan",
        lazy="selectin",
    )


class CharacterError(Base):
    __tablename__ = "character_errors"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    session_id: Mapped[int] = mapped_column(ForeignKey("learning_sessions.id"), nullable=False, index=True)
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
    # Required link to the DB LearningSession (NOT NULL + CASCADE — Issue #1189)
    learning_session_id: Mapped[int] = mapped_column(
        ForeignKey("learning_sessions.id", ondelete="CASCADE"), nullable=False, index=True
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

    learning_session: Mapped["LearningSession"] = relationship(
        "LearningSession", back_populates="dialogue_turns"
    )
