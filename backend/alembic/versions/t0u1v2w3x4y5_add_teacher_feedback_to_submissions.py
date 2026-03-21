"""add teacher_feedback to assignment_submissions

Adds a nullable text column `teacher_feedback` to assignment_submissions so
teachers can write per-student feedback when grading (Issue #424).

Revision ID: t0u1v2w3x4y5
Revises: s9t0u1v2w3x4
Create Date: 2026-03-17 00:00:00.000000

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "t0u1v2w3x4y5"
down_revision: Union[str, None] = "s9t0u1v2w3x4"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute(
        "ALTER TABLE assignment_submissions ADD COLUMN IF NOT EXISTS teacher_feedback TEXT;"
    )


def downgrade() -> None:
    op.drop_column("assignment_submissions", "teacher_feedback")
