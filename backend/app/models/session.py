from datetime import datetime
from sqlalchemy import String, Integer, Float, Boolean, Text, ForeignKey, DateTime, Index, func, text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.ext.hybrid import hybrid_property
from sqlalchemy.orm import Mapped, mapped_column, relationship
from .base import Base

# ---------------------------------------------------------------------------
# Step name constants — single source of truth for step number ↔ key mapping.
# Kept at module level so they can be imported by routes without importing the
# full ORM model (avoids circular-import risk in lightweight scripts).
# ---------------------------------------------------------------------------

_STEP_NAMES: dict[int, str] = {
    1: "intro",
    2: "live_tutor",
    3: "comprehension",
    4: "vocab",
    5: "full_reading",
    6: "report",
}
_MAX_STEP_NUM: int = max(_STEP_NAMES)
_STEP_KEY_TO_NUM: dict[str, int] = {v: k for k, v in _STEP_NAMES.items()}
_STEP_NUM_TO_KEY: dict[int, str] = dict(_STEP_NAMES)  # same as _STEP_NAMES, explicit alias

# Frontend step path keys differ from canonical backend STEP_NAMES values.
# Map frontend alias → canonical key.
_FRONTEND_STEP_ALIAS: dict[str, str] = {
    "tutor": "live_tutor",
    "full-reading": "full_reading",
    "reading-annotation": "intro",
}


class ReadingAttemptHistory(Base):
    """Versioned history of reading_result JSONB snapshots for a LearningSession.

    Each time reading_result is overwritten on LearningSession, the previous
    value is snapshotted here before the overwrite so no attempt is lost.
    attempt_no is 1-based; attempt_no=1 is the first recorded attempt.

    Issue #1183: reading_result JSONB 無版本紀錄（重練覆蓋歷史）
    """
    __tablename__ = "reading_attempt_history"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    # FK with index=True (Rule 1) + CASCADE so rows are removed when session is deleted
    session_id: Mapped[int] = mapped_column(
        ForeignKey("learning_sessions.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    # 1-based attempt counter; composite index enables fast "latest attempt" lookup
    attempt_no: Mapped[int] = mapped_column(Integer, nullable=False)
    reading_result: Mapped[dict] = mapped_column(JSONB, nullable=False)
    # Issue #2266: GCS blob path for student audio replay (private bucket).
    # Format: reading-audio/attempts/{id}.webm  — Never a public URL.
    # None = audio not yet uploaded or upload failed (non-fatal).
    audio_gcs_path: Mapped[str | None] = mapped_column(String(500), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    __table_args__ = (
        Index("ix_reading_attempt_history_session_attempt", "session_id", "attempt_no"),
    )

    session: Mapped["LearningSession"] = relationship(  # type: ignore[name-defined]
        "LearningSession",
        back_populates="reading_attempts",
    )


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

    # ── Class-level step constants (mirrors module-level dicts; exposed here so
    # tests and callers can access them via the model class directly) ──────────
    _STEP_KEY_TO_NUM: dict[int, str] = _STEP_KEY_TO_NUM  # type: ignore[assignment]
    _STEP_NUM_TO_KEY: dict[int, str] = _STEP_NUM_TO_KEY  # type: ignore[assignment]
    _FRONTEND_STEP_ALIAS: dict[str, str] = _FRONTEND_STEP_ALIAS  # type: ignore[assignment]

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    student_id: Mapped[int] = mapped_column(ForeignKey("users.id"), nullable=False, index=True)
    text_id: Mapped[int | None] = mapped_column(ForeignKey("texts.id"), nullable=True, index=True)
    classroom_id: Mapped[int | None] = mapped_column(ForeignKey("classrooms.id"), nullable=True, index=True)
    # DEPRECATED (#1188): story_slug is the legacy string key.  text_id FK is the
    # canonical source of truth.  Use story_slug_derived hybrid property for reads.
    # DO NOT write story_slug without also setting text_id.  Column will be dropped
    # post-demo once all readers migrate to story_slug_derived.
    story_slug: Mapped[str | None] = mapped_column(String(100), nullable=True, index=True)
    status: Mapped[str] = mapped_column(String(20), nullable=False, server_default="in_progress", index=True)
    # Issue #1762: distinguish assignment vs self-study sessions
    # Values: "self_study" (default) | "assignment"
    session_mode: Mapped[str] = mapped_column(String(20), nullable=False, server_default="self_study")

    @hybrid_property
    def story_slug_derived(self) -> str | None:
        """Canonical story slug derived from the FK relationship (#1188).

        Returns ``str(text.lesson_number)`` when text_id is set and the Text
        relationship is loaded, otherwise falls back to the legacy story_slug
        column so existing rows with no text_id still work.

        Use this property for all *reads*.  Do not write to story_slug directly.
        """
        if self.text is not None and self.text.lesson_number is not None:
            return str(self.text.lesson_number)
        return self.story_slug

    # DEPRECATED: use current_step_derived computed from step_progress.steps_completed (#1182).
    # Do NOT write to this column from application code. Column kept for zero-downtime
    # deprecation; will be dropped post-demo once step_progress is the sole source of truth.
    current_step: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    accuracy: Mapped[float | None] = mapped_column(Float, nullable=True)
    overall_score: Mapped[float | None] = mapped_column(Float, nullable=True)
    reading_result: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    comprehension_result: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    vocab_result: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    full_reading_result: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    # Bug C fix (#1378): array of per-attempt snapshots, capped at 4.
    # Migration: f1a2b3c4d5e6 — ADD COLUMN IF NOT EXISTS (idempotent).
    # full_reading_result above is kept as backward-compat scalar (= latest attempt).
    # Each element: { attempt_index, timestamp, cpm, accuracy, match_rate,
    #                 duration_ms, audio_url }
    full_reading_attempts: Mapped[list] = mapped_column(
        JSONB, nullable=False, server_default="'[]'::jsonb"
    )
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

    # ── Derived property — single source of truth for "current step" ─────────

    @property
    def current_step_derived(self) -> int:
        """Compute the current step number from step_progress.steps_completed.

        Returns the step number the student should be on next (= max completed + 1),
        capped at _MAX_STEP_NUM so it never exceeds the last step.

        Returns 1 (first step) when:
        - step_progress is None (fresh session)
        - step_progress is not a dict (corrupt value)
        - steps_completed is empty or absent
        - all keys in steps_completed are unknown

        This is the authoritative value; do NOT read the deprecated integer
        current_step column from application code.  (#1182)
        """
        sp = self.step_progress
        if not isinstance(sp, dict):
            return 1
        steps_completed = sp.get("steps_completed")
        if not isinstance(steps_completed, list) or len(steps_completed) == 0:
            return 1
        alias = self._FRONTEND_STEP_ALIAS
        key_to_num = self._STEP_KEY_TO_NUM
        max_num: int = 0
        for s in steps_completed:
            canonical = alias.get(s, s) if isinstance(s, str) else s
            num = key_to_num.get(canonical, 0)
            if num > max_num:
                max_num = num
        if max_num == 0:
            return 1
        return min(max_num + 1, _MAX_STEP_NUM)

    student: Mapped["User"] = relationship("User", back_populates="sessions")  # type: ignore[name-defined]
    text: Mapped["Text"] = relationship("Text", back_populates="sessions")  # type: ignore[name-defined]
    classroom: Mapped["Classroom | None"] = relationship("Classroom")  # type: ignore[name-defined]
    character_errors: Mapped[list["CharacterError"]] = relationship(
        "CharacterError", back_populates="session"
    )
    reading_attempts: Mapped[list["ReadingAttemptHistory"]] = relationship(
        "ReadingAttemptHistory",
        back_populates="session",
        cascade="all, delete-orphan",
        lazy="selectin",
        order_by="ReadingAttemptHistory.attempt_no",
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
