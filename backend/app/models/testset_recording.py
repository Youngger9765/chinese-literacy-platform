"""TestsetRecording model — Issue #2287.

Stores crowdsourced reading audio contributed by volunteers (no login required).

sqlalchemy-model-safety checklist:
- No FK (standalone table, contributors identified by name string) ✅
- timestamps with server_default=func.now() (Rule 2) ✅
- All columns have explicit nullable declaration ✅
- No relationship() needed (no FK) ✅
- Index on (lesson_id, version) for list query ✅
- Index on created_at for time-based list ordering ✅
"""

from sqlalchemy import DateTime, Integer, String, func, Index
from sqlalchemy.orm import Mapped, mapped_column

from .base import Base


class TestsetRecording(Base):
    """One recording submitted by a volunteer contributor.

    A contributor (identified by name + grade, no auth) records a lesson text
    in either the 'correct' or 'error' version and uploads the audio file.
    The audio is stored in GCS under the test-dataset/ prefix (separate from
    student attempt audio).

    GCS path convention (enforced by route, not here):
        test-dataset/{contributor_slug}/{lesson_id}/{version}_{id}.webm
    """

    __tablename__ = "testset_recordings"
    __table_args__ = (
        Index("ix_testset_lesson_version", "lesson_id", "version"),
        Index("ix_testset_created_at", "created_at"),
        Index("ix_testset_contributor", "contributor_name"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)

    # Contributor identity (no auth — name + grade self-reported)
    contributor_name: Mapped[str] = mapped_column(
        String(100), nullable=False
    )
    grade: Mapped[str] = mapped_column(
        String(20), nullable=False
    )

    # Which lesson and which version was recorded
    lesson_id: Mapped[str] = mapped_column(
        String(50), nullable=False
    )
    version: Mapped[str] = mapped_column(
        String(20), nullable=False  # "correct" or "error"
    )

    # GCS path (relative, under READING_AUDIO_GCS_BUCKET)
    audio_gcs_path: Mapped[str] = mapped_column(
        String(500), nullable=False
    )

    # When was this uploaded
    created_at: Mapped[DateTime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
    )
