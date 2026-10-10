"""add junyi_class_id to classrooms

Revision ID: b3c4d5e6f7g8
Revises: a2b3c4d5e6f7
Create Date: 2026-10-11 12:00:00.000000

Classroom identity for Junyi import (issue #3380).
"""
from typing import Union

from alembic import op
import sqlalchemy as sa


revision: str = "b3c4d5e6f7g8"
down_revision: Union[str, None] = "a2b3c4d5e6f7"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "classrooms",
        sa.Column("junyi_class_id", sa.String(length=64), nullable=True),
    )
    op.create_index(
        "ix_classrooms_junyi_class_id", "classrooms", ["junyi_class_id"]
    )
    op.create_index(
        "uq_classrooms_teacher_junyi_class",
        "classrooms",
        ["teacher_id", "junyi_class_id"],
        unique=True,
        postgresql_where=sa.text("junyi_class_id IS NOT NULL"),
    )


def downgrade() -> None:
    op.drop_index("uq_classrooms_teacher_junyi_class", table_name="classrooms")
    op.drop_index("ix_classrooms_junyi_class_id", table_name="classrooms")
    op.drop_column("classrooms", "junyi_class_id")
