"""create reading_history and reading_targets tables

Revision ID: z6a7b8c9d0e1
Revises: y5z6a7b8c9d0
Create Date: 2026-04-04 00:00:00.000000

"""
from typing import Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "z6a7b8c9d0e1"
down_revision: Union[str, None] = "y5z6a7b8c9d0"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "reading_history",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("student_id", sa.Integer(), nullable=False),
        sa.Column("lesson_id", sa.String(100), nullable=False),
        sa.Column("paragraph_index", sa.Integer(), nullable=True),
        sa.Column("reading_type", sa.String(20), nullable=False, server_default="full"),
        sa.Column("cpm", sa.Float(), nullable=False),
        sa.Column("accuracy", sa.Float(), nullable=False),
        sa.Column("duration_seconds", sa.Float(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(["student_id"], ["users.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_reading_history_student_id", "reading_history", ["student_id"])
    op.create_index("ix_reading_history_lesson_id", "reading_history", ["lesson_id"])

    op.create_table(
        "reading_targets",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("teacher_id", sa.Integer(), nullable=False),
        sa.Column("lesson_id", sa.String(100), nullable=False),
        sa.Column("target_cpm", sa.Float(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(["teacher_id"], ["users.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_reading_targets_teacher_id", "reading_targets", ["teacher_id"])
    op.create_index("ix_reading_targets_lesson_id", "reading_targets", ["lesson_id"])


def downgrade() -> None:
    op.drop_table("reading_targets")
    op.drop_table("reading_history")
