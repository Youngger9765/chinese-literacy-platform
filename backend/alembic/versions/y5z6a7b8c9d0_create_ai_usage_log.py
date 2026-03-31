"""create ai_usage_log table

Revision ID: y5z6a7b8c9d0
Revises: x4y5z6a7b8c9
Create Date: 2026-03-31 00:00:00.000000

"""
from typing import Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


# revision identifiers, used by Alembic.
revision: str = "y5z6a7b8c9d0"
down_revision: Union[str, None] = "x4y5z6a7b8c9"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "ai_usage_log",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.Column("student_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=True),
        sa.Column("user_role", sa.String(20), nullable=True),
        sa.Column("endpoint", sa.String(80), nullable=True),
        sa.Column("action", sa.String(30), nullable=True),
        sa.Column("model", sa.String(50), server_default="gemini-2.5-flash", nullable=True),
        sa.Column("latency_ms", sa.Integer(), nullable=True),
        sa.Column("story_id", sa.String(30), nullable=True),
        sa.Column("story_title", sa.String(100), nullable=True),
        sa.Column("session_id", sa.Integer(), nullable=True),
        sa.Column("step", sa.String(30), nullable=True),
        sa.Column("step_label", sa.String(50), nullable=True),
        sa.Column("classroom_id", sa.Integer(), nullable=True),
        sa.Column("assignment_id", sa.Integer(), nullable=True),
        sa.Column("request_url", sa.String(200), nullable=True),
        sa.Column("input_tokens", sa.Integer(), nullable=True),
        sa.Column("output_tokens", sa.Integer(), nullable=True),
        sa.Column("total_tokens", sa.Integer(), nullable=True),
        sa.Column("estimated_cost_usd", sa.Numeric(8, 6), nullable=True),
        sa.Column("success", sa.Boolean(), server_default=sa.text("true"), nullable=True),
        sa.Column("error_type", sa.String(50), nullable=True),
        sa.Column("metadata", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        # ── Denormalized dimensions (snapshot at call time) ──
        sa.Column("student_name", sa.String(100), nullable=True),
        sa.Column("grade_level", sa.String(20), nullable=True),
        sa.Column("teacher_id", sa.Integer(), nullable=True),
        sa.Column("teacher_name", sa.String(100), nullable=True),
        sa.Column("org_id", sa.Integer(), nullable=True),
        sa.Column("school_name", sa.String(100), nullable=True),
        sa.Column("classroom_name", sa.String(100), nullable=True),
        sa.Column("genre", sa.String(30), nullable=True),
        # ── Model details ──
        sa.Column("model_version", sa.String(50), nullable=True),
        sa.Column("prompt_template_id", sa.String(50), nullable=True),
        # ── Additional measures ──
        sa.Column("prompt_char_count", sa.Integer(), nullable=True),
        sa.Column("response_char_count", sa.Integer(), nullable=True),
        sa.Column("retry_count", sa.Integer(), server_default=sa.text("0"), nullable=True),
        # ── Quality flags ──
        sa.Column("content_filtered", sa.Boolean(), server_default=sa.text("false"), nullable=True),
        sa.Column("cache_hit", sa.Boolean(), server_default=sa.text("false"), nullable=True),
        # ── Raw payloads (JSONB for future analysis) ──
        sa.Column("request_payload", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column("response_payload", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        # ── Correlation ──
        sa.Column("request_id", sa.String(36), nullable=True),
        sa.Column("parent_request_id", sa.String(36), nullable=True),
    )
    op.create_index("idx_ai_usage_created", "ai_usage_log", ["created_at"])
    op.create_index("idx_ai_usage_student", "ai_usage_log", ["student_id"])
    op.create_index("idx_ai_usage_endpoint", "ai_usage_log", ["endpoint"])
    op.create_index("idx_ai_usage_story", "ai_usage_log", ["story_id"])
    op.create_index("idx_ai_usage_org", "ai_usage_log", ["org_id"])
    op.create_index("idx_ai_usage_teacher", "ai_usage_log", ["teacher_id"])
    op.create_index("idx_ai_usage_request", "ai_usage_log", ["request_id"])


def downgrade() -> None:
    op.drop_index("idx_ai_usage_request", table_name="ai_usage_log")
    op.drop_index("idx_ai_usage_teacher", table_name="ai_usage_log")
    op.drop_index("idx_ai_usage_org", table_name="ai_usage_log")
    op.drop_index("idx_ai_usage_story", table_name="ai_usage_log")
    op.drop_index("idx_ai_usage_endpoint", table_name="ai_usage_log")
    op.drop_index("idx_ai_usage_student", table_name="ai_usage_log")
    op.drop_index("idx_ai_usage_created", table_name="ai_usage_log")
    op.drop_table("ai_usage_log")
