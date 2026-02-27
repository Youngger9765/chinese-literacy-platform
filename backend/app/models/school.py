from datetime import datetime

from sqlalchemy import String, Integer, Boolean, DateTime, ForeignKey, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship
from .base import Base


class School(Base):
    __tablename__ = "schools"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    name: Mapped[str] = mapped_column(String(200), nullable=False)

    teachers: Mapped[list["Teacher"]] = relationship("Teacher", back_populates="school")


class Teacher(Base):
    __tablename__ = "teachers"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    school_id: Mapped[int] = mapped_column(ForeignKey("schools.id"), nullable=False)
    email: Mapped[str] = mapped_column(String(254), unique=True, nullable=False)
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    password_hash: Mapped[str] = mapped_column(String(255), nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, default=datetime.utcnow)

    school: Mapped[School] = relationship("School", back_populates="teachers")
    classes: Mapped[list["Class"]] = relationship("Class", back_populates="teacher")


class Class(Base):
    __tablename__ = "classes"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    teacher_id: Mapped[int] = mapped_column(ForeignKey("teachers.id"), nullable=False)
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    class_code: Mapped[str] = mapped_column(String(8), unique=True, nullable=False)

    teacher: Mapped[Teacher] = relationship("Teacher", back_populates="classes")
    class_students: Mapped[list["ClassStudent"]] = relationship(
        "ClassStudent", back_populates="class_"
    )


class ClassStudent(Base):
    __tablename__ = "class_students"
    __table_args__ = (
        UniqueConstraint("class_id", "student_id"),
        UniqueConstraint("class_id", "seat_number"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    class_id: Mapped[int] = mapped_column(ForeignKey("classes.id"), nullable=False)
    student_id: Mapped[int] = mapped_column(ForeignKey("students.id"), nullable=False)
    seat_number: Mapped[int] = mapped_column(Integer, nullable=False)

    class_: Mapped[Class] = relationship("Class", back_populates="class_students")
