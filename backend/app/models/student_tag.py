from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Integer, String, UniqueConstraint, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .base import Base


class StudentTag(Base):
    __tablename__ = "student_tags"
    __table_args__ = (UniqueConstraint("student_id", "tag_name"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    student_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    teacher_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    tag_name: Mapped[str] = mapped_column(String(50), nullable=False)
    color: Mapped[str] = mapped_column(String(20), nullable=False, default="gray")
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    # Relationships
    student: Mapped["User"] = relationship("User", foreign_keys=[student_id])  # type: ignore[name-defined]
    teacher: Mapped["User"] = relationship("User", foreign_keys=[teacher_id])  # type: ignore[name-defined]
