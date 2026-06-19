"""add audio_gcs_path to reading_attempt_history and assignment_submissions

Revision ID: a2b3c4d5e6f7
Revises: 2ed91926c851
Create Date: 2026-06-19

Issue #2266: Store GCS blob path in DB so students can replay their reading
audio and teachers can access it for audit.

Two columns added (both nullable, no FK/index needed — queries go via session_id):
  - reading_attempt_history.audio_gcs_path  VARCHAR(500) NULL
  - assignment_submissions.audio_gcs_path   VARCHAR(500) NULL

GCS path format: reading-audio/attempts/{attempt_id}.webm
Signed URL generation is handled in the route layer; this column stores the
private GCS path only — never a public URL.
"""

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision = "a2b3c4d5e6f7"
down_revision = "2ed91926c851"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # reading_attempt_history — idempotent (IF NOT EXISTS)
    op.execute("""
        DO $$
        BEGIN
            IF NOT EXISTS (
                SELECT 1 FROM information_schema.columns
                WHERE table_name = 'reading_attempt_history'
                  AND column_name = 'audio_gcs_path'
            ) THEN
                ALTER TABLE reading_attempt_history
                    ADD COLUMN audio_gcs_path VARCHAR(500) NULL;
            END IF;
        END $$;
    """)

    # assignment_submissions — idempotent (IF NOT EXISTS)
    op.execute("""
        DO $$
        BEGIN
            IF NOT EXISTS (
                SELECT 1 FROM information_schema.columns
                WHERE table_name = 'assignment_submissions'
                  AND column_name = 'audio_gcs_path'
            ) THEN
                ALTER TABLE assignment_submissions
                    ADD COLUMN audio_gcs_path VARCHAR(500) NULL;
            END IF;
        END $$;
    """)


def downgrade() -> None:
    op.execute("""
        ALTER TABLE reading_attempt_history
            DROP COLUMN IF EXISTS audio_gcs_path;
    """)
    op.execute("""
        ALTER TABLE assignment_submissions
            DROP COLUMN IF EXISTS audio_gcs_path;
    """)
