from datetime import datetime

from sqlalchemy import (
    String,
    Integer,
    Boolean,
    JSON,
    DateTime,
    ForeignKey,
    UniqueConstraint,
    func,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship
from .base import Base


class School(Base):
    __tablename__ = "schools"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    organization_id: Mapped[str | None] = mapped_column(
        ForeignKey("organizations.id"), nullable=True
    )
    display_name: Mapped[str | None] = mapped_column(String(200), nullable=True)
    address: Mapped[str | None] = mapped_column(String(500), nullable=True)
    phone: Mapped[str | None] = mapped_column(String(20), nullable=True)
    admin_user_id: Mapped[int | None] = mapped_column(
        ForeignKey("users.id"), nullable=True
    )
    join_code: Mapped[str | None] = mapped_column(String(20), unique=True, nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    settings: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )

    # Relationships
    organization: Mapped["Organization | None"] = relationship("Organization")
    admin_user: Mapped["User | None"] = relationship("User")
    classrooms: Mapped[list["Classroom"]] = relationship("Classroom", back_populates="school")


class Classroom(Base):
    __tablename__ = "classrooms"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    school_id: Mapped[int] = mapped_column(ForeignKey("schools.id"), nullable=False)
    teacher_id: Mapped[int] = mapped_column(ForeignKey("users.id"), nullable=False)
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    grade: Mapped[int | None] = mapped_column(Integer, nullable=True)
    join_code: Mapped[str | None] = mapped_column(String(8), unique=True, nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    # Relationships
    school: Mapped["School"] = relationship("School", back_populates="classrooms")
    teacher: Mapped["User"] = relationship("User")
    classroom_students: Mapped[list["ClassroomStudent"]] = relationship(
        "ClassroomStudent", back_populates="classroom"
    )


class ClassroomStudent(Base):
    __tablename__ = "classroom_students"
    __table_args__ = (UniqueConstraint("classroom_id", "student_id"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    classroom_id: Mapped[int] = mapped_column(ForeignKey("classrooms.id"), nullable=False)
    student_id: Mapped[int] = mapped_column(ForeignKey("users.id"), nullable=False)
    enrolled_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    # Relationships
    classroom: Mapped["Classroom"] = relationship("Classroom", back_populates="classroom_students")
    student: Mapped["User"] = relationship("User")
