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
    model = Column(String(50), default="gemini-2.5-flash-lite")
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

    # ── Denormalized dimensions (snapshot at call time) ──
    student_name = Column(String(100))
    grade_level = Column(String(20))
    teacher_id = Column(Integer, index=True)
    teacher_name = Column(String(100))
    org_id = Column(Integer)
    school_name = Column(String(100))
    classroom_name = Column(String(100))
    genre = Column(String(30))

    # ── Model details ──
    model_version = Column(String(50))
    prompt_template_id = Column(String(50))

    # ── Additional measures ──
    prompt_char_count = Column(Integer)
    response_char_count = Column(Integer)
    retry_count = Column(Integer, default=0)

    # ── Quality flags ──
    content_filtered = Column(Boolean, default=False)
    cache_hit = Column(Boolean, default=False)

    # ── Raw payloads (JSONB for future analysis) ──
    request_payload = Column(JSONB)
    response_payload = Column(JSONB)

    # ── Correlation ──
    request_id = Column(String(36))
    parent_request_id = Column(String(36))
