"""add full_reading_attempts column to learning_sessions

Revision ID: a1b2c3d4e5f6
Revises: z6a7b8c9d0e1
Create Date: 2026-05-01 00:00:00.000000

Bug C fix (#1378): full_reading_result overwrites on each attempt, losing history.
This migration adds full_reading_attempts JSONB array that appends each attempt
(capped at 4). The existing full_reading_result scalar is kept for backward compat.

Schema of each element in full_reading_attempts:
  {
    "attempt_index": 1,         # 1-based
    "timestamp": "ISO8601",
    "cpm": 210,
    "accuracy": 0.95,
    "match_rate": 0.95,
    "duration_ms": 30000,
    "audio_url": "gs://..." | null
  }
"""
from typing import Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB


# revision identifiers, used by Alembic.
revision: str = "a1b2c3d4e5f6"
down_revision: Union[str, None] = "z6a7b8c9d0e1"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Idempotent: use raw SQL with IF NOT EXISTS guard so re-running is safe
    op.execute("""
        ALTER TABLE learning_sessions
        ADD COLUMN IF NOT EXISTS full_reading_attempts JSONB DEFAULT '[]'::jsonb NOT NULL
    """)


def downgrade() -> None:
    op.execute("""
        ALTER TABLE learning_sessions
        DROP COLUMN IF EXISTS full_reading_attempts
    """)
