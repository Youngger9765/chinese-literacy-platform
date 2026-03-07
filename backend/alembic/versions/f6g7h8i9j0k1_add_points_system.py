"""add points system to organizations

Revision ID: f6g7h8i9j0k1
Revises: e5f6g7h8i9j0
Create Date: 2026-03-07 18:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'f6g7h8i9j0k1'
down_revision: Union[str, None] = 'e5f6g7h8i9j0'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Add points columns to organizations
    op.add_column('organizations', sa.Column('total_points', sa.Integer(), nullable=True))
    op.add_column('organizations', sa.Column('used_points', sa.Integer(), nullable=False, server_default='0'))
    op.add_column('organizations', sa.Column('subscription_start_date', sa.DateTime(timezone=True), nullable=True))
    op.add_column('organizations', sa.Column('subscription_end_date', sa.DateTime(timezone=True), nullable=True))

    # Create organization_points_log table
    op.create_table(
        'organization_points_log',
        sa.Column('id', sa.Integer(), autoincrement=True, nullable=False),
        sa.Column('organization_id', sa.String(36), nullable=False),
        sa.Column('user_id', sa.Integer(), nullable=True),
        sa.Column('points_used', sa.Integer(), nullable=False),
        sa.Column('feature_type', sa.String(50), nullable=False),
        sa.Column('description', sa.Text(), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.PrimaryKeyConstraint('id'),
        sa.ForeignKeyConstraint(['organization_id'], ['organizations.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['user_id'], ['users.id']),
    )
    op.create_index('ix_organization_points_log_organization_id', 'organization_points_log', ['organization_id'])


def downgrade() -> None:
    op.drop_index('ix_organization_points_log_organization_id', table_name='organization_points_log')
    op.drop_table('organization_points_log')

    op.drop_column('organizations', 'subscription_end_date')
    op.drop_column('organizations', 'subscription_start_date')
    op.drop_column('organizations', 'used_points')
    op.drop_column('organizations', 'total_points')
