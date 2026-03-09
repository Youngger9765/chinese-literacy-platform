"""
Teacher notification read-state tracking.

Stores which alert keys a teacher has marked as read.
Alert key format: "{classroom_id}:{student_id}:{alert_type}"
"""

from sqlalchemy import Column, DateTime, ForeignKey, Integer, String, UniqueConstraint
from sqlalchemy.sql import func

from .base import Base


class TeacherNotificationRead(Base):
    __tablename__ = "teacher_notification_reads"

    id = Column(Integer, primary_key=True, autoincrement=True)
    teacher_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    alert_key = Column(String(200), nullable=False)  # "{classroom_id}:{student_id}:{alert_type}"
    read_at = Column(DateTime(timezone=True), server_default=func.now())

    __table_args__ = (
        UniqueConstraint("teacher_id", "alert_key", name="uq_teacher_alert_read"),
    )
