"""add omo_upload_attempts table and grading columns to omo_uploads (Phase 1a)

Revision ID: l7g8h9i0j1k2
Revises: k6f7a8b9c0d1
Create Date: 2026-05-13 00:00:00.000000

Idempotent DDL: uses IF NOT EXISTS / ADD COLUMN IF NOT EXISTS so safe to
re-run on a DB that partially has these changes.

Changes:
  1. omo_uploads: add answers, overall_score, ai_overall_confidence, progress columns
  2. omo_uploads: rename 'image_paths' concept is preserved; add new status values
  3. NEW TABLE: omo_upload_attempts (multi-attempt per upload session)
"""

from typing import Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = "l7g8h9i0j1k2"
down_revision: Union[str, None] = "k6f7a8b9c0d1"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # ── 1. Add Phase 1a columns to omo_uploads ───────────────────────────────
    # Use ADD COLUMN IF NOT EXISTS for idempotency

    op.execute("""
        ALTER TABLE omo_uploads
        ADD COLUMN IF NOT EXISTS answers JSONB NOT NULL DEFAULT '[]'::jsonb
    """)

    op.execute("""
        ALTER TABLE omo_uploads
        ADD COLUMN IF NOT EXISTS overall_score FLOAT
    """)

    op.execute("""
        ALTER TABLE omo_uploads
        ADD COLUMN IF NOT EXISTS ai_overall_confidence FLOAT
    """)

    op.execute("""
        ALTER TABLE omo_uploads
        ADD COLUMN IF NOT EXISTS progress JSONB NOT NULL DEFAULT '{}'::jsonb
    """)

    # ── 2. Create omo_upload_attempts table ──────────────────────────────────
    op.execute("""
        CREATE TABLE IF NOT EXISTS omo_upload_attempts (
            id              SERIAL PRIMARY KEY,
            omo_upload_id   BIGINT NOT NULL
                            REFERENCES omo_uploads(id) ON DELETE CASCADE,
            attempt_idx     INTEGER NOT NULL,
            image_paths     JSONB NOT NULL DEFAULT '[]'::jsonb,
            ocr_preview     VARCHAR(500),
            is_active       BOOLEAN NOT NULL DEFAULT true,
            captured_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
    """)

    # Indexes — CREATE INDEX IF NOT EXISTS is idempotent
    op.execute("""
        CREATE INDEX IF NOT EXISTS ix_omo_upload_attempts_upload_id
        ON omo_upload_attempts (omo_upload_id)
    """)


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS omo_upload_attempts")

    # Remove added columns from omo_uploads
    op.execute("ALTER TABLE omo_uploads DROP COLUMN IF EXISTS answers")
    op.execute("ALTER TABLE omo_uploads DROP COLUMN IF EXISTS overall_score")
    op.execute("ALTER TABLE omo_uploads DROP COLUMN IF EXISTS ai_overall_confidence")
    op.execute("ALTER TABLE omo_uploads DROP COLUMN IF EXISTS progress")
