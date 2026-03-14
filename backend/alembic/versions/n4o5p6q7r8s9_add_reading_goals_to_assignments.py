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
    # Use a DO block so the ALTER is skipped if the assignments table doesn't
    # exist yet (can happen on preview DBs where alembic_version was seeded
    # from a prior run but the actual schema was reset).
    op.execute(
        """
        DO $$
        BEGIN
            IF EXISTS (
                SELECT 1 FROM information_schema.tables
                WHERE table_schema = 'public' AND table_name = 'assignments'
            ) THEN
                ALTER TABLE assignments ADD COLUMN IF NOT EXISTS target_cpm INTEGER;
                ALTER TABLE assignments ADD COLUMN IF NOT EXISTS target_accuracy FLOAT;
                ALTER TABLE assignments ADD COLUMN IF NOT EXISTS difficulty_label VARCHAR(10);
            END IF;
        END
        $$
        """
    )


def downgrade() -> None:
    op.drop_column('assignments', 'difficulty_label')
    op.drop_column('assignments', 'target_accuracy')
    op.drop_column('assignments', 'target_cpm')
