"""create_testset_recordings_table

Issue #2287 — crowdsourced reading audio collection.
Adds testset_recordings table (standalone, no FK — contributors identified by name string).

Revision ID: b3c4d5e6f7g8
Revises: a2b3c4d5e6f7
Create Date: 2026-06-20

Migration notes (idempotent DDL):
  - Uses IF NOT EXISTS on table creation — safe to re-run.
  - Downgrade drops the table entirely.
  - No FK, so no cascade concerns.

Run on staging BEFORE merging PR:
    cd backend && alembic upgrade head
"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = "b3c4d5e6f7g8"
down_revision = "a2b3c4d5e6f7"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("""
        CREATE TABLE IF NOT EXISTS testset_recordings (
            id SERIAL PRIMARY KEY,
            contributor_name VARCHAR(100) NOT NULL,
            grade VARCHAR(20) NOT NULL,
            lesson_id VARCHAR(50) NOT NULL,
            version VARCHAR(20) NOT NULL,
            audio_gcs_path VARCHAR(500) NOT NULL,
            created_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )
    """)
    # Indexes — idempotent via IF NOT EXISTS
    op.execute("""
        CREATE INDEX IF NOT EXISTS ix_testset_lesson_version
            ON testset_recordings (lesson_id, version)
    """)
    op.execute("""
        CREATE INDEX IF NOT EXISTS ix_testset_created_at
            ON testset_recordings (created_at)
    """)
    op.execute("""
        CREATE INDEX IF NOT EXISTS ix_testset_contributor
            ON testset_recordings (contributor_name)
    """)


def downgrade() -> None:
    op.drop_table("testset_recordings")
