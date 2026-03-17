from datetime import datetime
from typing import Literal

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

# Valid roles for ClassroomTeacher junction table
ClassroomTeacherRole = Literal["primary", "assistant"]


class School(Base):
    __tablename__ = "schools"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    domain: Mapped[str | None] = mapped_column(String(255), nullable=True, unique=True, index=True)
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
    # Allowed email domains for teacher registration (issue #407).
    # If set to a non-empty list, only teachers whose email domain appears in this list
    # may join this school.  Stored as JSON list of lowercase domain strings,
    # e.g. ["school.edu.tw", "mail.school.edu.tw"].
    # When None or [] there is no domain restriction.
    allowed_email_domains: Mapped[list | None] = mapped_column(JSON, nullable=True)
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
    teacher: Mapped["User"] = relationship("User", foreign_keys="[Classroom.teacher_id]")
    classroom_students: Mapped[list["ClassroomStudent"]] = relationship(
        "ClassroomStudent", back_populates="classroom"
    )
    classroom_teachers: Mapped[list["ClassroomTeacher"]] = relationship(
        "ClassroomTeacher", back_populates="classroom", cascade="all, delete-orphan"
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


class ClassroomTeacher(Base):
    """Junction table: many teachers per classroom.

    The primary teacher (owner) is always the one stored in Classroom.teacher_id.
    This table tracks additional co-teachers with role='primary' (owner) or 'assistant'.
    On classroom creation the owner is automatically inserted with role='primary'.
    """

    __tablename__ = "classroom_teachers"
    __table_args__ = (UniqueConstraint("classroom_id", "teacher_id"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    classroom_id: Mapped[int] = mapped_column(
        ForeignKey("classrooms.id", ondelete="CASCADE"), nullable=False
    )
    teacher_id: Mapped[int] = mapped_column(ForeignKey("users.id"), nullable=False)
    # "primary" = owner (Classroom.teacher_id), "assistant" = co-teacher
    role: Mapped[str] = mapped_column(String(20), nullable=False, default="assistant")
    invited_by: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    invited_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    # Relationships
    classroom: Mapped["Classroom"] = relationship("Classroom", back_populates="classroom_teachers")
    teacher: Mapped["User"] = relationship("User", foreign_keys=[teacher_id])
    inviter: Mapped["User | None"] = relationship("User", foreign_keys=[invited_by])


class ClassroomText(Base):
    __tablename__ = "classroom_texts"
    __table_args__ = (UniqueConstraint("classroom_id", "text_id"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    classroom_id: Mapped[int] = mapped_column(
        ForeignKey("classrooms.id", ondelete="CASCADE"), nullable=False
    )
    text_id: Mapped[str] = mapped_column(String(50), nullable=False)
    assigned_by: Mapped[int | None] = mapped_column(
        ForeignKey("users.id"), nullable=True
    )
    assigned_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    # Auto-cleanup fields — set expires_at when assigning a text with a semester end date.
    # The cleanup job soft-deletes rows where expires_at < now() and deleted_at is NULL.
    expires_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True, index=True
    )
    deleted_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )

    # Relationships
    classroom: Mapped["Classroom"] = relationship("Classroom")
    assigner: Mapped["User | None"] = relationship("User")
