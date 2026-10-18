"""add session_id, attempt_no, choice_text to mcq_attempt (#3028)

Revision ID: d5e6f7g8h9i0
Revises: c4d5e6f7g8h9
Create Date: 2026-10-14 00:00:00.000000

Issue #3028 — single-choice "accuracy stars" (and a standing live-monitor
bug fix, see below) need three facts mcq_attempt didn't have:

  - session_id   FK -> learning_sessions.id, ON DELETE SET NULL. Resolved
                 server-side from the student's in_progress session for the
                 lesson; NULL when there is none (e.g. answered outside any
                 session). Without this, "how many times did this student
                 answer this question" accumulates forever across every
                 session the student has ever had, so accuracy can only go
                 down and a brand-new session inherits a bad history.
  - attempt_no   1-based ordinal of this attempt within (session_id,
                 question_id). NULL whenever session_id is NULL.
  - choice_text  The option's literal text (choice, existing VARCHAR(8),
                 keeps storing just the letter).

No backfill: all three are NULL on every existing row. A backfilled
session_id would invent an attribution we can't actually prove; every
consumer query must filter `session_id IS NOT NULL` so pre-migration rows
never pollute a denominator (locked in tests, see
backend/tests/test_mcq_attempt_3028.py).

Idempotent DDL — safe to re-run on shared preview/staging DBs, matching the
rest of this table's history (j5e6f7a8b9c0).
"""
from typing import Sequence, Union

from alembic import op


revision: str = "d5e6f7g8h9i0"
down_revision: Union[str, None] = "c4d5e6f7g8h9"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("""
        ALTER TABLE mcq_attempt
        ADD COLUMN IF NOT EXISTS session_id INTEGER
            REFERENCES learning_sessions(id) ON DELETE SET NULL
    """)
    op.execute("""
        ALTER TABLE mcq_attempt
        ADD COLUMN IF NOT EXISTS attempt_no INTEGER
    """)
    op.execute("""
        ALTER TABLE mcq_attempt
        ADD COLUMN IF NOT EXISTS choice_text VARCHAR(255)
    """)
    op.execute("""
        CREATE INDEX IF NOT EXISTS ix_mcq_attempt_session_id
            ON mcq_attempt (session_id)
    """)


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS ix_mcq_attempt_session_id")
    op.execute("ALTER TABLE mcq_attempt DROP COLUMN IF EXISTS choice_text")
    op.execute("ALTER TABLE mcq_attempt DROP COLUMN IF EXISTS attempt_no")
    op.execute("ALTER TABLE mcq_attempt DROP COLUMN IF EXISTS session_id")
