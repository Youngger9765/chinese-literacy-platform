"""add reading goals to assignments

Revision ID: n4o5p6q7r8s9
Revises: m3n4o5p6q7r8
Create Date: 2026-03-09 00:00:00.000000

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = 'n4o5p6q7r8s9'
down_revision = 'm3n4o5p6q7r8'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        "ALTER TABLE assignments ADD COLUMN IF NOT EXISTS "
        "target_cpm INTEGER"
    )
    op.execute(
        "ALTER TABLE assignments ADD COLUMN IF NOT EXISTS "
        "target_accuracy FLOAT"
    )
    op.execute(
        "ALTER TABLE assignments ADD COLUMN IF NOT EXISTS "
        "difficulty_label VARCHAR(10)"
    )


def downgrade() -> None:
    op.drop_column('assignments', 'difficulty_label')
    op.drop_column('assignments', 'target_accuracy')
    op.drop_column('assignments', 'target_cpm')
