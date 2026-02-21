from sqlalchemy import String, Integer, Text, Boolean, ForeignKey
from sqlalchemy.orm import Mapped, mapped_column, relationship
from .base import Base


class Text(Base):
    """Story / lesson content uploaded by a teacher."""

    __tablename__ = "texts"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    teacher_id: Mapped[int] = mapped_column(ForeignKey("teachers.id"), nullable=False)
    title: Mapped[str] = mapped_column(String(200), nullable=False)
    author: Mapped[str] = mapped_column(String(100), nullable=True)
    content: Mapped[str] = mapped_column(Text, nullable=False)  # JSON array of paragraph strings
    level: Mapped[int] = mapped_column(Integer, nullable=False, default=3)
    category: Mapped[str] = mapped_column(String(50), nullable=True)
    copyright_confirmed: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)

    sessions: Mapped[list["LearningSession"]] = relationship(  # type: ignore[name-defined]
        "LearningSession", back_populates="text"
    )
