"""add omo_uploads table for Phase 1 paper upload + AI lesson identification

Revision ID: k6f7a8b9c0d1
Revises: j5e6f7a8b9c0
Create Date: 2026-05-13 00:00:00.000000

Idempotent DDL: uses IF NOT EXISTS so re-running on a DB that already has
the table is a no-op (safe for retry after partial deploy).

Phase 1 columns only — answers/grading columns deferred to Phase 2.
"""

from typing import Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = "k6f7a8b9c0d1"
down_revision: Union[str, None] = "j5e6f7a8b9c0"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Use CREATE TABLE IF NOT EXISTS via raw SQL for idempotency
    op.execute("""
        CREATE TABLE IF NOT EXISTS omo_uploads (
            id            SERIAL PRIMARY KEY,
            student_id    INTEGER NOT NULL
                          REFERENCES users(id) ON DELETE CASCADE,
            lesson_id     INTEGER,
            image_paths   JSONB NOT NULL DEFAULT '[]'::jsonb,
            identification JSONB,
            status        VARCHAR(32) NOT NULL DEFAULT 'pending',
            error_message VARCHAR(500),
            ai_confidence FLOAT,
            created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
    """)

    # Indexes — CREATE INDEX IF NOT EXISTS is idempotent
    op.execute("""
        CREATE INDEX IF NOT EXISTS ix_omo_uploads_student_id
        ON omo_uploads (student_id)
    """)
    op.execute("""
        CREATE INDEX IF NOT EXISTS ix_omo_uploads_lesson_id
        ON omo_uploads (lesson_id)
    """)
    op.execute("""
        CREATE INDEX IF NOT EXISTS ix_omo_uploads_status
        ON omo_uploads (status)
    """)
    op.execute("""
        CREATE INDEX IF NOT EXISTS ix_omo_uploads_student_lesson
        ON omo_uploads (student_id, lesson_id)
    """)


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS omo_uploads")
