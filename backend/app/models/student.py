from datetime import datetime

from sqlalchemy import String, Integer, Boolean, DateTime
from sqlalchemy.orm import Mapped, mapped_column, relationship
from .base import Base


class Student(Base):
    __tablename__ = "students"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    password_hash: Mapped[str] = mapped_column(String(255), nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, default=datetime.utcnow)

    sessions: Mapped[list["LearningSession"]] = relationship(  # type: ignore[name-defined]
        "LearningSession", back_populates="student"
    )
    class_students: Mapped[list["ClassStudent"]] = relationship(  # type: ignore[name-defined]
        "ClassStudent", back_populates=None
    )
