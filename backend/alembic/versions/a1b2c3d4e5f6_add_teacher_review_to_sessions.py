"""Add teacher review fields to learning_sessions (Issue #993)

Revision ID: a1b2c3d4e5f6
Revises: z6a7b8c9d0e1
Create Date: 2026-04-08 12:00:00.000000
"""
from alembic import op
import sqlalchemy as sa

revision = "a1b2c3d4e5f6"
down_revision = "z6a7b8c9d0e1"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("learning_sessions", sa.Column("ai_comment", sa.Text(), nullable=True))
    op.add_column("learning_sessions", sa.Column("teacher_comment", sa.Text(), nullable=True))
    op.add_column(
        "learning_sessions",
        sa.Column("teacher_reviewed_at", sa.DateTime(timezone=True), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("learning_sessions", "teacher_reviewed_at")
    op.drop_column("learning_sessions", "teacher_comment")
    op.drop_column("learning_sessions", "ai_comment")
