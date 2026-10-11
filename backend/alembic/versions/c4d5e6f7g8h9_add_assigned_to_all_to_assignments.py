"""add assigned_to_all to assignments

Revision ID: c4d5e6f7g8h9
Revises: b3c4d5e6f7g8
Create Date: 2026-10-11 00:00:00.000000

Issue #3393: an assignment created with `student_ids` (#3378 "part of the
class") had no field recording that it was partial. create_submissions_for_new_student()
back-filled ALL active assignments for a newly-joined student regardless of
whether they were ever selected, so late joiners silently inherited partial
assignments they were never assigned.

assigned_to_all=True means "whole class" (back-fill late joiners, #996
behaviour, unchanged). Existing rows default to True because #3378's partial
feature only just shipped -- every assignment created before it was
effectively whole-class.
"""
from typing import Union

from alembic import op
import sqlalchemy as sa


revision: str = "c4d5e6f7g8h9"
down_revision: Union[str, None] = "b3c4d5e6f7g8"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "assignments",
        sa.Column(
            "assigned_to_all",
            sa.Boolean(),
            nullable=False,
            server_default=sa.text("true"),
        ),
    )


def downgrade() -> None:
    op.drop_column("assignments", "assigned_to_all")
