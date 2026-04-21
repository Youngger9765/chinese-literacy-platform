"""add partial unique index on learning_sessions (student, story, in_progress)

Revision ID: a7b8c9d0e1f2
Revises: z6a7b8c9d0e1
Create Date: 2026-04-21 00:00:00.000000

Prevents duplicate in_progress sessions for the same student + story_slug (#1179).

Before adding the index, existing duplicates are consolidated: keep the
most-recently-started session in_progress, mark the rest as abandoned.
"""
from typing import Union

from alembic import op
import sqlalchemy as sa


revision: str = "a7b8c9d0e1f2"
down_revision: Union[str, None] = "z6a7b8c9d0e1"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Step 1: consolidate existing duplicate in_progress sessions.
    # For each (student_id, story_slug) with multiple in_progress rows, keep the
    # newest started_at and mark the rest as abandoned so the unique index can apply.
    op.execute(
        """
        WITH ranked AS (
            SELECT id,
                   ROW_NUMBER() OVER (
                       PARTITION BY student_id, story_slug
                       ORDER BY started_at DESC
                   ) AS rn
            FROM learning_sessions
            WHERE status = 'in_progress'
              AND story_slug IS NOT NULL
        )
        UPDATE learning_sessions
           SET status = 'abandoned'
         WHERE id IN (SELECT id FROM ranked WHERE rn > 1);
        """
    )

    # Step 2: create the partial unique index.
    op.create_index(
        "uq_session_student_story_inprogress",
        "learning_sessions",
        ["student_id", "story_slug"],
        unique=True,
        postgresql_where=sa.text("status = 'in_progress' AND story_slug IS NOT NULL"),
    )


def downgrade() -> None:
    op.drop_index("uq_session_student_story_inprogress", table_name="learning_sessions")
    # Note: previously-abandoned sessions are not restored on downgrade.
