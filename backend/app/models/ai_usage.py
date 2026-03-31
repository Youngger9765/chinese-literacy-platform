"""SQLAlchemy model for AI API usage tracking (Issue #874)."""

from sqlalchemy import Column, Integer, String, Boolean, Numeric, DateTime, ForeignKey
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.sql import func

from .base import Base


class AIUsageLog(Base):
    __tablename__ = "ai_usage_log"

    id = Column(Integer, primary_key=True, index=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    student_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    user_role = Column(String(20))
    endpoint = Column(String(80))
    action = Column(String(30))
    model = Column(String(50), default="gemini-2.5-flash")
    latency_ms = Column(Integer)
    story_id = Column(String(30))
    story_title = Column(String(100))
    session_id = Column(Integer)
    step = Column(String(30))
    step_label = Column(String(50))
    classroom_id = Column(Integer)
    assignment_id = Column(Integer)
    request_url = Column(String(200))
    input_tokens = Column(Integer)
    output_tokens = Column(Integer)
    total_tokens = Column(Integer)
    estimated_cost_usd = Column(Numeric(8, 6))
    success = Column(Boolean, default=True)
    error_type = Column(String(50))
    metadata_ = Column("metadata", JSONB)
