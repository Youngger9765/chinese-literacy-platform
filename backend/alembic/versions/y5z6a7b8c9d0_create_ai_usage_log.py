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
    )
    op.create_index("idx_ai_usage_created", "ai_usage_log", ["created_at"])
    op.create_index("idx_ai_usage_student", "ai_usage_log", ["student_id"])
    op.create_index("idx_ai_usage_endpoint", "ai_usage_log", ["endpoint"])
    op.create_index("idx_ai_usage_story", "ai_usage_log", ["story_id"])


def downgrade() -> None:
    op.drop_index("idx_ai_usage_story", table_name="ai_usage_log")
    op.drop_index("idx_ai_usage_endpoint", table_name="ai_usage_log")
    op.drop_index("idx_ai_usage_student", table_name="ai_usage_log")
    op.drop_index("idx_ai_usage_created", table_name="ai_usage_log")
    op.drop_table("ai_usage_log")
