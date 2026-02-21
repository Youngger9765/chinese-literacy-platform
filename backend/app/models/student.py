from sqlalchemy import String, Integer
from sqlalchemy.orm import Mapped, mapped_column, relationship
from .base import Base


class Student(Base):
    __tablename__ = "students"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    name: Mapped[str] = mapped_column(String(100), nullable=False)

    sessions: Mapped[list["LearningSession"]] = relationship(  # type: ignore[name-defined]
        "LearningSession", back_populates="student"
    )
    class_students: Mapped[list["ClassStudent"]] = relationship(  # type: ignore[name-defined]
        "ClassStudent", back_populates=None
    )
