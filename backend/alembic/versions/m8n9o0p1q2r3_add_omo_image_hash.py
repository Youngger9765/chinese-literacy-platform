"""add image_hash to omo_upload_attempts for dedup

Revision ID: m8n9o0p1q2r3
Revises: l7g8h9i0j1k2
Create Date: 2026-05-14 00:00:00.000000

Idempotent DDL: uses ADD COLUMN IF NOT EXISTS, safe to re-run.

Changes:
  1. omo_upload_attempts: add image_hash VARCHAR(64) NOT NULL DEFAULT ''
  2. Create index ix_omo_upload_attempts_hash_user on (image_hash, upload.student_id)
     — actually we index on omo_upload_attempts.image_hash directly for fast lookup
     The join to omo_uploads.student_id is done in application code.
"""

from typing import Union

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = "m8n9o0p1q2r3"
down_revision: Union[str, None] = "l7g8h9i0j1k2"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Add image_hash column to omo_upload_attempts (idempotent)
    conn = op.get_bind()

    # Check if column exists before adding
    result = conn.execute(sa.text(
        "SELECT column_name FROM information_schema.columns "
        "WHERE table_name='omo_upload_attempts' AND column_name='image_hash'"
    ))
    if not result.fetchone():
        op.add_column(
            "omo_upload_attempts",
            sa.Column("image_hash", sa.String(64), nullable=False, server_default=""),
        )

    # Create index for fast hash lookup (idempotent)
    try:
        op.create_index(
            "ix_omo_upload_attempts_image_hash",
            "omo_upload_attempts",
            ["image_hash"],
        )
    except Exception:
        pass  # index may already exist


def downgrade() -> None:
    try:
        op.drop_index("ix_omo_upload_attempts_image_hash", table_name="omo_upload_attempts")
    except Exception:
        pass
    conn = op.get_bind()
    result = conn.execute(sa.text(
        "SELECT column_name FROM information_schema.columns "
        "WHERE table_name='omo_upload_attempts' AND column_name='image_hash'"
    ))
    if result.fetchone():
        op.drop_column("omo_upload_attempts", "image_hash")
