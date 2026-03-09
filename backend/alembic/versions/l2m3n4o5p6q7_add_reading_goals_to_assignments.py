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
    op.add_column('assignments', sa.Column('target_cpm', sa.Integer(), nullable=True))
    op.add_column('assignments', sa.Column('target_accuracy', sa.Float(), nullable=True))
    op.add_column('assignments', sa.Column('difficulty_label', sa.String(length=10), nullable=True))


def downgrade() -> None:
    op.drop_column('assignments', 'difficulty_label')
    op.drop_column('assignments', 'target_accuracy')
    op.drop_column('assignments', 'target_cpm')
