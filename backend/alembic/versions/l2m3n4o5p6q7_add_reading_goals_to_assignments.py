"""add reading goals to assignments

Revision ID: l2m3n4o5p6q7
Revises: k1l2m3n4o5p6
Create Date: 2026-03-09 00:00:00.000000

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = 'l2m3n4o5p6q7'
down_revision = 'k1l2m3n4o5p6'
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Use IF NOT EXISTS so this migration is safe whether or not the assignments
    # table already has these columns (idempotent on re-run or partial migration state).
    op.execute(
        "ALTER TABLE assignments ADD COLUMN IF NOT EXISTS target_cpm INTEGER"
    )
    op.execute(
        "ALTER TABLE assignments ADD COLUMN IF NOT EXISTS target_accuracy FLOAT"
    )
    op.execute(
        "ALTER TABLE assignments ADD COLUMN IF NOT EXISTS difficulty_label VARCHAR(10)"
    )


def downgrade() -> None:
    op.drop_column('assignments', 'difficulty_label')
    op.drop_column('assignments', 'target_accuracy')
    op.drop_column('assignments', 'target_cpm')
