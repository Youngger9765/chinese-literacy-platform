"""AnnotationEntry model — per-character annotation in reading-annotation step.

Persists the student's highlight/underline annotations (❓ unknown / 💛 important)
so that progress survives across devices and is visible to teachers.

One row per annotation mark on one LearningSession.  The full list of annotations
for a session is fetched as a batch; there is no single-annotation endpoint.

Issue #2070: annotations_{storyId} was localStorage-only; now also persisted to DB.
"""

from __future__ import annotations

from sqlalchemy import Column, DateTime, ForeignKey, Index, Integer, String, func
from sqlalchemy.orm import relationship

from .base import Base


class AnnotationEntry(Base):
    """One annotation mark (highlight/question) in a reading-annotation session.

    Attributes
    ----------
    id:
        Surrogate PK.
    session_id:
        FK to ``learning_sessions.id``.  CASCADE delete keeps the table clean
        when a session is removed.
    paragraph_index:
        0-based index of the paragraph within story.content[].
    char_start:
        0-based start offset within the paragraph (raw text, pre-zhuyin).
    char_end:
        0-based exclusive end offset (same coordinate system as char_start).
    annotation_type:
        "unknown" (unknown) or "important" (important).  Fixed vocabulary; new types should
        be added by extending this enum rather than free-form strings.
    client_id:
        The client-generated id (ann-<timestamp>-<counter>).  Stored so the
        frontend can deduplicate on reload without relying on surrogate PK order.
    created_at:
        Server-side creation timestamp.
    """

    __tablename__ = "annotation_entries"

    id = Column(Integer, primary_key=True, autoincrement=True)

    # FK to LearningSession; index=True per sqlalchemy-model-safety Rule 1
    session_id = Column(
        Integer,
        ForeignKey("learning_sessions.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    paragraph_index = Column(Integer, nullable=False)
    char_start = Column(Integer, nullable=False)
    char_end = Column(Integer, nullable=False)

    # Fixed vocabulary: "unknown" | "important"
    annotation_type = Column(String(20), nullable=False)

    # Client-generated id stored for idempotent upserts / client dedup
    client_id = Column(String(64), nullable=True, index=True)

    created_at = Column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
    )

    session = relationship(
        "LearningSession",
        back_populates=None,
        lazy="select",
        foreign_keys=[session_id],
    )

    __table_args__ = (
        # Composite index: fast bulk-fetch "all annotations for session X"
        Index("ix_annotation_entries_session_para", "session_id", "paragraph_index"),
    )
