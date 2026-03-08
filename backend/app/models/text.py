from datetime import datetime

from sqlalchemy import (
    String,
    Integer,
    Text as TextColumn,
    JSON,
    DateTime,
    ForeignKey,
    Enum as SQLEnum,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship
from .base import Base

import enum


class VisibilityLevel(str, enum.Enum):
    platform = "platform"
    organization = "organization"
    school = "school"
    class_ = "class"
    private = "private"


class TextStatus(str, enum.Enum):
    draft = "draft"
    published = "published"
    archived = "archived"


class Text(Base):
    """Reading lesson content with multi-level ownership."""

    __tablename__ = "texts"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)

    # === Content ===
    title: Mapped[str] = mapped_column(String(200), nullable=False)
    paragraphs: Mapped[list] = mapped_column(JSON, nullable=False)  # string[]
    full_text: Mapped[str | None] = mapped_column(
        TextColumn, nullable=True
    )  # concatenated for search
    char_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)

    # === Classification ===
    grade: Mapped[int] = mapped_column(
        Integer, nullable=False, index=True
    )  # 4-9
    grade_code: Mapped[str] = mapped_column(
        String(10), nullable=False
    )  # "G4-1"
    genre: Mapped[str] = mapped_column(
        String(20), nullable=False
    )  # 記敘文/說明文/議論文/文言文/應用文
    text_type: Mapped[str] = mapped_column(
        String(10), nullable=False, default="單"
    )  # 單/多*2/多*3
    category: Mapped[str] = mapped_column(
        String(20), nullable=False
    )  # Fable/Science/History/Daily
    reading_strategy: Mapped[str | None] = mapped_column(
        String(200), nullable=True
    )

    # === Media ===
    thumbnail_path: Mapped[str | None] = mapped_column(
        String(500), nullable=True
    )  # GCS relative path

    # === Exercises ===
    vocabulary: Mapped[list | None] = mapped_column(
        JSON, nullable=True
    )  # [{word, definition, note?}]
    fill_in_blank: Mapped[list | None] = mapped_column(
        JSON, nullable=True
    )  # [{sentence, answer}]
    multiple_choice: Mapped[list | None] = mapped_column(
        JSON, nullable=True
    )  # [{question, options[], answer, explanation}]
    reading_benchmark: Mapped[dict | None] = mapped_column(
        JSON, nullable=True
    )  # {levels: [{threshold, feedback}]}

    # === Ownership ===
    visibility: Mapped[str] = mapped_column(
        SQLEnum(VisibilityLevel, name="visibility_level", create_constraint=True, values_callable=lambda e: [x.value for x in e]),
        nullable=False,
        default=VisibilityLevel.platform,
        index=True,
    )
    school_id: Mapped[int | None] = mapped_column(
        ForeignKey("schools.id"), nullable=True
    )
    class_id: Mapped[int | None] = mapped_column(
        ForeignKey("classrooms.id"), nullable=True
    )
    teacher_id: Mapped[int | None] = mapped_column(
        ForeignKey("users.id"), nullable=True
    )
    created_by_id: Mapped[int | None] = mapped_column(
        ForeignKey("users.id"), nullable=True
    )

    # === Fork/Copy ===
    forked_from_id: Mapped[int | None] = mapped_column(
        ForeignKey("texts.id"), nullable=True
    )

    # === Status ===
    status: Mapped[str] = mapped_column(
        SQLEnum(TextStatus, name="text_status", create_constraint=True),
        nullable=False,
        default=TextStatus.published,
    )
    lesson_number: Mapped[int | None] = mapped_column(
        Integer, nullable=True, unique=True, index=True
    )  # platform texts only
    source_file: Mapped[str | None] = mapped_column(String(200), nullable=True)

    # === Timestamps ===
    created_at: Mapped[datetime] = mapped_column(
        DateTime, nullable=False, default=datetime.utcnow
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime,
        nullable=False,
        default=datetime.utcnow,
        onupdate=datetime.utcnow,
    )

    # === Relationships ===
    school: Mapped["School | None"] = relationship(  # type: ignore[name-defined]
        "School", foreign_keys=[school_id]
    )
    classroom: Mapped["Classroom | None"] = relationship(  # type: ignore[name-defined]
        "Classroom", foreign_keys=[class_id]
    )
    teacher: Mapped["User | None"] = relationship(  # type: ignore[name-defined]
        "User", foreign_keys=[teacher_id]
    )
    created_by: Mapped["User | None"] = relationship(  # type: ignore[name-defined]
        "User", foreign_keys=[created_by_id]
    )
    forked_from: Mapped["Text | None"] = relationship(
        "Text", remote_side=[id], foreign_keys=[forked_from_id]
    )
    sessions: Mapped[list["LearningSession"]] = relationship(  # type: ignore[name-defined]
        "LearningSession", back_populates="text"
    )
