"""create story_tags table

Revision ID: u1v2w3x4y5z6
Revises: t0u1v2w3x4y5
Create Date: 2026-03-20 00:00:00.000000

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "u1v2w3x4y5z6"
down_revision: Union[str, None] = "t0u1v2w3x4y5"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "story_tags",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("teacher_id", sa.Integer(), nullable=False),
        sa.Column("story_ref", sa.String(length=50), nullable=False),
        sa.Column("difficulty_level", sa.String(length=20), nullable=True),
        sa.Column("custom_tags", sa.JSON(), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(
            ["teacher_id"],
            ["users.id"],
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("teacher_id", "story_ref"),
    )
    op.create_index(
        op.f("ix_story_tags_teacher_id"), "story_tags", ["teacher_id"], unique=False
    )
    op.create_index(
        op.f("ix_story_tags_story_ref"), "story_tags", ["story_ref"], unique=False
    )


def downgrade() -> None:
    op.drop_index(op.f("ix_story_tags_story_ref"), table_name="story_tags")
    op.drop_index(op.f("ix_story_tags_teacher_id"), table_name="story_tags")
    op.drop_table("story_tags")
