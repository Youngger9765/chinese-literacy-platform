"""add reading_attempt_history table for versioned reading_result snapshots

Revision ID: ra01hist02ver03
Revises: dt01fk02cascade03
Create Date: 2026-04-26 00:00:00.000000

Issue #1183: reading_result JSONB 無版本紀錄（重練覆蓋歷史）

Creates reading_attempt_history to snapshot previous reading_result values
before each overwrite on learning_sessions.reading_result.

DDL is idempotent (IF NOT EXISTS / EXCEPTION WHEN duplicate_object / DROP IF EXISTS)
so it is safe to re-run on shared preview-db / staging-db environments.
"""

from typing import Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB

# revision identifiers, used by Alembic.
revision: str = "ra01hist02ver03"
down_revision: Union[str, None] = "dt01fk02cascade03"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Create table (idempotent: CREATE TABLE IF NOT EXISTS via raw DDL)
    op.execute("""
        CREATE TABLE IF NOT EXISTS reading_attempt_history (
            id          SERIAL PRIMARY KEY,
            session_id  INTEGER NOT NULL
                            REFERENCES learning_sessions(id) ON DELETE CASCADE,
            attempt_no  INTEGER NOT NULL,
            reading_result JSONB NOT NULL,
            created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
    """)

    # FK index on session_id (Rule 1: every FK must have index=True)
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_reading_attempt_history_session_id "
        "ON reading_attempt_history (session_id)"
    )

    # Composite index for fast "max attempt_no per session" lookups
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_reading_attempt_history_session_attempt "
        "ON reading_attempt_history (session_id, attempt_no)"
    )


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS ix_reading_attempt_history_session_attempt")
    op.execute("DROP INDEX IF EXISTS ix_reading_attempt_history_session_id")
    op.execute("DROP TABLE IF EXISTS reading_attempt_history")
