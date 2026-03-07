from datetime import datetime

from sqlalchemy import (
    String,
    Integer,
    Float,
    Boolean,
    Text,
    DateTime,
    ForeignKey,
    UniqueConstraint,
    func,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship
from .base import Base


class Assignment(Base):
    __tablename__ = "assignments"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    classroom_id: Mapped[int] = mapped_column(
        ForeignKey("classrooms.id", ondelete="CASCADE"), nullable=False, index=True
    )
    teacher_id: Mapped[int] = mapped_column(ForeignKey("users.id"), nullable=False)
    story_id: Mapped[str] = mapped_column(String(50), nullable=False)  # lesson_number as string
    title: Mapped[str | None] = mapped_column(String(200), nullable=True)  # custom title, fallback to story title
    description: Mapped[str | None] = mapped_column(Text, nullable=True)  # teacher instructions
    assignment_type: Mapped[str] = mapped_column(String(20), default="reading")  # "reading" | "comprehension"
    due_date: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    # Relationships
    classroom: Mapped["Classroom"] = relationship("Classroom", backref="assignments")  # type: ignore[name-defined]
    teacher: Mapped["User"] = relationship("User", foreign_keys=[teacher_id])  # type: ignore[name-defined]
    submissions: Mapped[list["AssignmentSubmission"]] = relationship(
        "AssignmentSubmission", back_populates="assignment", cascade="all, delete-orphan"
    )


class AssignmentSubmission(Base):
    __tablename__ = "assignment_submissions"
    __table_args__ = (UniqueConstraint("assignment_id", "student_id", name="uq_assignment_student"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    assignment_id: Mapped[int] = mapped_column(
        ForeignKey("assignments.id", ondelete="CASCADE"), nullable=False, index=True
    )
    student_id: Mapped[int] = mapped_column(ForeignKey("users.id"), nullable=False)
    status: Mapped[str] = mapped_column(String(20), default="pending")  # "pending" | "in_progress" | "submitted" | "graded"
    session_id: Mapped[int | None] = mapped_column(ForeignKey("learning_sessions.id"), nullable=True)
    submitted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    score: Mapped[float | None] = mapped_column(Float, nullable=True)  # from LearningSession accuracy
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    # Relationships
    assignment: Mapped["Assignment"] = relationship("Assignment", back_populates="submissions")
    student: Mapped["User"] = relationship("User", foreign_keys=[student_id])  # type: ignore[name-defined]
    session: Mapped["LearningSession"] = relationship("LearningSession", foreign_keys=[session_id])  # type: ignore[name-defined]
