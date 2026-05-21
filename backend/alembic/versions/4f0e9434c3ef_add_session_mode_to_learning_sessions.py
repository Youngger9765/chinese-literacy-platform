"""add session_mode to learning_sessions

Revision ID: 4f0e9434c3ef
Revises: z6a7b8c9d0e1
Create Date: 2026-05-20 00:00:00.000000

Issue #1762: Add session_mode to distinguish assignment vs self-study sessions.
"""
from typing import Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "4f0e9434c3ef"
down_revision: Union[str, None] = "z6a7b8c9d0e1"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Step 1: Add column nullable first (to allow backfilling existing rows)
    op.execute(
        """
        ALTER TABLE learning_sessions
        ADD COLUMN IF NOT EXISTS session_mode VARCHAR(20)
        """
    )

    # Step 2: Backfill all existing rows (including active in-progress sessions on staging)
    op.execute(
        """
        UPDATE learning_sessions
        SET session_mode = 'self_study'
        WHERE session_mode IS NULL
        """
    )

    # Step 3: Set default and NOT NULL constraint
    # (any remaining NULLs at this point = partial migration failure → ALTER will raise)
    op.execute(
        """
        ALTER TABLE learning_sessions
        ALTER COLUMN session_mode SET DEFAULT 'self_study'
        """
    )
    op.execute(
        """
        ALTER TABLE learning_sessions
        ALTER COLUMN session_mode SET NOT NULL
        """
    )


def downgrade() -> None:
    op.execute(
        """
        ALTER TABLE learning_sessions
        DROP COLUMN IF EXISTS session_mode
        """
    )
