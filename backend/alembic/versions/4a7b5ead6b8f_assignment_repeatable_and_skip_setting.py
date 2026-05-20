"""assignment repeatable and skip completed steps setting

Revision ID: 4a7b5ead6b8f
Revises: 4f0e9434c3ef
Create Date: 2026-05-20 00:01:00.000000

Issue #1762:
  - Drop UNIQUE(assignment_id, student_id) from assignment_submissions to allow
    repeatable submissions (students can redo assignments).
  - Add attempt_number column to track which attempt each submission represents.
  - Add skip_completed_steps boolean to assignments so teacher can enable smart-skip.
"""
from typing import Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "4a7b5ead6b8f"
down_revision: Union[str, None] = "4f0e9434c3ef"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Drop UNIQUE constraint if it exists (may not exist in all environments)
    op.execute(
        """
        ALTER TABLE assignment_submissions
        DROP CONSTRAINT IF EXISTS uq_assignment_student
        """
    )

    # Add attempt_number — default 1 so existing rows are treated as first attempt
    op.execute(
        """
        ALTER TABLE assignment_submissions
        ADD COLUMN IF NOT EXISTS attempt_number INTEGER NOT NULL DEFAULT 1
        """
    )

    # Add skip_completed_steps to assignments
    op.execute(
        """
        ALTER TABLE assignments
        ADD COLUMN IF NOT EXISTS skip_completed_steps BOOLEAN NOT NULL DEFAULT false
        """
    )


def downgrade() -> None:
    op.execute(
        """
        ALTER TABLE assignments
        DROP COLUMN IF EXISTS skip_completed_steps
        """
    )
    op.execute(
        """
        ALTER TABLE assignment_submissions
        DROP COLUMN IF EXISTS attempt_number
        """
    )
    # Restore unique constraint — will fail if duplicate rows exist, which is expected
    op.execute(
        """
        ALTER TABLE assignment_submissions
        ADD CONSTRAINT uq_assignment_student UNIQUE (assignment_id, student_id)
        """
    )
