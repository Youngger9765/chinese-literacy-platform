"""
Toolbox session models (#1460) — practice toolbox: each tool gets its own table.

The practice toolbox (`/tools` page, 10 tools) was previously sharing
``learning_sessions`` with assignment / self-study sessions. Phase 1 of #1460
splits each tool into its own dedicated table so:

- Each row = ONE independent practice attempt (single-shot, no progression)
- No ``step_progress`` / no ``current_step``
- No ``status`` field — ``completed_at`` NULL ⇒ in-progress, NOT NULL ⇒ done
- ``result`` is a tool-specific JSONB blob
- Toolbox sessions never appear in assignment / self-study queries

LingoLeap SQLAlchemy safety rules applied:

- FK index=True for student_id and text_id (Rule 1)
- server_default for timestamps
- Composite ``(student_id, started_at)`` index for the most common query
  (a student's recent practice list)
- ondelete CASCADE on student_id so user deletion cleans up
- ondelete SET NULL on text_id so deleting a text preserves the practice record

Migration: ``backend/alembic/versions/h3c4d5e6f7a8_create_toolbox_session_tables.py``
"""

from __future__ import annotations

from sqlalchemy import (
    Column,
    DateTime,
    Float,
    ForeignKey,
    Index,
    Integer,
    func,
    text,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import declared_attr

from .base import Base


class ToolboxSessionMixin:
    """Shared columns for all toolbox session tables (#1460).

    Tool-specific tables inherit this mixin + Base. Each table has identical
    structure; tool-specific data lives inside the ``result`` JSONB column.
    """

    id = Column(Integer, primary_key=True, autoincrement=True)

    # FK with index (LingoLeap Rule 1) + CASCADE so user deletion removes records
    student_id = Column(
        Integer,
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    # Optional — toolbox practice may or may not be tied to a specific text.
    # SET NULL on text deletion so the practice record (and student stats)
    # are preserved even if the lesson is later removed.
    text_id = Column(
        Integer,
        ForeignKey("texts.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )

    # Tool-specific result blob; schema varies per tool. Tools document their
    # own JSON shape in their respective route handler.
    # nullable=False + server_default enforced at DB level (#1474).
    result = Column(JSONB, nullable=False, server_default=text("'{}'::jsonb"))

    # Primary metric (e.g. accuracy 0–1, score 0–100); semantics defined by tool.
    score = Column(Float, nullable=True)

    # Wall-clock time spent on this attempt, in milliseconds.
    duration_ms = Column(Integer, nullable=True)

    # Lifecycle timestamps — timestamptz per LingoLeap safety rules.
    started_at = Column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
    )
    completed_at = Column(DateTime(timezone=True), nullable=True)

    @declared_attr
    def __table_args__(cls):
        # Composite index — most common query: "list my recent practices,
        # newest first" → ORDER BY started_at DESC WHERE student_id = ?
        return (
            Index(
                f"ix_{cls.__tablename__}_student_started",
                "student_id",
                "started_at",
            ),
        )


# ── 10 tool-specific tables ────────────────────────────────────────────────
# Order matches TOOL_OPTIONS in frontend/src/components/tools/ToolPicker.tsx.


class ToolboxTutorSession(ToolboxSessionMixin, Base):
    """朗讀練習 — paragraph-by-paragraph reading with AI feedback (LiveTutor)."""

    __tablename__ = "toolbox_tutor_sessions"


class ToolboxFullReadingSession(ToolboxSessionMixin, Base):
    """全文朗讀 — full-text reading evaluation (cpm / accuracy / match rate)."""

    __tablename__ = "toolbox_full_reading_sessions"


class ToolboxListeningSession(ToolboxSessionMixin, Base):
    """聽力理解 — listen to AI-read text, answer comprehension questions."""

    __tablename__ = "toolbox_listening_sessions"


class ToolboxVocabSession(ToolboxSessionMixin, Base):
    """生字書寫 — character stroke-order practice with zhuyin guidance."""

    __tablename__ = "toolbox_vocab_sessions"


class ToolboxSentencePracticeSession(ToolboxSessionMixin, Base):
    """造句練習 — AI-guided sentence construction using lesson vocabulary."""

    __tablename__ = "toolbox_sentence_practice_sessions"


class ToolboxVocabDefinitionSession(ToolboxSessionMixin, Base):
    """詞語配對 — match vocabulary words to their definitions."""

    __tablename__ = "toolbox_vocab_definition_sessions"


class ToolboxVocabApplicationSession(ToolboxSessionMixin, Base):
    """詞語應用 — fill-in-the-blank vocab usage in sentences."""

    __tablename__ = "toolbox_vocab_application_sessions"


class ToolboxComprehensionSession(ToolboxSessionMixin, Base):
    """課文理解 — Socratic-style AI dialogue.

    Phase 1 stores dialogue turns as a JSON array inside ``result``. If a
    later phase needs per-turn querying or individual-turn analytics, add a
    sibling ``toolbox_comprehension_dialogue_turns`` table at that point.
    """

    __tablename__ = "toolbox_comprehension_sessions"


class ToolboxVocabWordSearchSession(ToolboxSessionMixin, Base):
    """詞語搜尋 — find target vocabulary words in a character grid."""

    __tablename__ = "toolbox_vocab_word_search_sessions"


class ToolboxKnowledgeStationSession(ToolboxSessionMixin, Base):
    """知識補給站 — extension knowledge videos and supplementary content."""

    __tablename__ = "toolbox_knowledge_station_sessions"
