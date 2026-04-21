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
    """A reading assignment issued by a teacher to a classroom.

    副本策略 (Copy Strategy):
    - Platform texts (YAML-based, story_id set): stable, never edited → direct reference.
      The assignment stores only story_id; no DB copy is needed.
    - DB texts (texts table, text_id set): teacher/school-owned and may be edited.
      At assignment creation the service calls `fork_text_for_assignment()` which creates
      a frozen fork (forked_from_id set) so edits to the original do not affect
      in-flight assignments. text_id then points to the fork, not the original.

    Exactly one of story_id or text_id is set; the other is None.
    """

    __tablename__ = "assignments"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    classroom_id: Mapped[int] = mapped_column(
        ForeignKey("classrooms.id", ondelete="CASCADE"), nullable=False, index=True
    )
    teacher_id: Mapped[int] = mapped_column(ForeignKey("users.id"), nullable=False)

    # --- Text source (exactly one of the two must be set) ---
    # story_id: YAML platform text (lesson_number as string, e.g. "1", "57")
    story_id: Mapped[str | None] = mapped_column(String(50), nullable=True)
    # text_id: DB text (texts table); points to the fork for non-platform texts
    text_id: Mapped[int | None] = mapped_column(
        ForeignKey("texts.id", ondelete="SET NULL"), nullable=True, index=True
    )

    title: Mapped[str | None] = mapped_column(String(200), nullable=True)  # custom title, fallback to story title
    description: Mapped[str | None] = mapped_column(Text, nullable=True)  # teacher instructions
    assignment_type: Mapped[str] = mapped_column(String(20), default="reading")  # "reading" | "comprehension"
    due_date: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    # Reading goals (Issue #84)
    target_cpm: Mapped[int | None] = mapped_column(Integer, nullable=True)       # target chars/min; None = use default
    target_accuracy: Mapped[float | None] = mapped_column(Float, nullable=True)  # 0-100 %; None = use default
    difficulty_label: Mapped[str | None] = mapped_column(String(10), nullable=True)  # 初級/中級/高級
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    # Relationships
    classroom: Mapped["Classroom"] = relationship("Classroom", backref="assignments")  # type: ignore[name-defined]
    teacher: Mapped["User"] = relationship("User", foreign_keys=[teacher_id])  # type: ignore[name-defined]
    text: Mapped["Text | None"] = relationship("Text", foreign_keys=[text_id])  # type: ignore[name-defined]
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
    session_id: Mapped[int | None] = mapped_column(
        ForeignKey("learning_sessions.id", ondelete="SET NULL"), nullable=True
    )
    submitted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    score: Mapped[float | None] = mapped_column(Float, nullable=True)  # from LearningSession accuracy
    teacher_feedback: Mapped[str | None] = mapped_column(Text, nullable=True)  # per-student teacher comment (Issue #424)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    # Relationships
    assignment: Mapped["Assignment"] = relationship("Assignment", back_populates="submissions")
    student: Mapped["User"] = relationship("User", foreign_keys=[student_id])  # type: ignore[name-defined]
    session: Mapped["LearningSession"] = relationship("LearningSession", foreign_keys=[session_id])  # type: ignore[name-defined]
