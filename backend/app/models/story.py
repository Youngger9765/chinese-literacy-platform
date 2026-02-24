from datetime import datetime
from sqlalchemy import String, Integer, Text as SAText, Boolean, JSON, DateTime
from sqlalchemy.orm import Mapped, mapped_column, relationship
from .base import Base


class Story(Base):
    """Platform-curated reading lesson."""
    __tablename__ = "stories"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    lesson_number: Mapped[int] = mapped_column(Integer, unique=True, nullable=False, index=True)
    title: Mapped[str] = mapped_column(String(200), nullable=False)
    grade: Mapped[int] = mapped_column(Integer, nullable=False, index=True)
    grade_code: Mapped[str] = mapped_column(String(10), nullable=False)
    paragraphs: Mapped[list] = mapped_column(JSON, nullable=False)
    story_text: Mapped[str | None] = mapped_column(SAText, nullable=True)
    char_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    genre: Mapped[str] = mapped_column(String(20), nullable=False)
    text_type: Mapped[str] = mapped_column(String(10), nullable=False, default="單")
    category: Mapped[str] = mapped_column(String(20), nullable=False)
    reading_strategy: Mapped[str | None] = mapped_column(String(200), nullable=True)
    thumbnail_path: Mapped[str | None] = mapped_column(String(500), nullable=True)
    vocabulary: Mapped[list | None] = mapped_column(JSON, nullable=True)
    fill_in_blank: Mapped[list | None] = mapped_column(JSON, nullable=True)
    multiple_choice: Mapped[list | None] = mapped_column(JSON, nullable=True)
    reading_benchmark: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    source_file: Mapped[str | None] = mapped_column(String(200), nullable=True)
    is_published: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, default=datetime.utcnow, onupdate=datetime.utcnow)

    sessions: Mapped[list["LearningSession"]] = relationship("LearningSession", back_populates="story")
