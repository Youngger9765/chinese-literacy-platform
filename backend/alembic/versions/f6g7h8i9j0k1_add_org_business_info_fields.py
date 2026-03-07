"""add business info fields to organizations

Revision ID: f6g7h8i9j0k1
Revises: e5f6g7h8i9j0
Create Date: 2026-03-07 18:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


# revision identifiers, used by Alembic.
revision: str = 'f6g7h8i9j0k1'
down_revision: Union[str, None] = 'e5f6g7h8i9j0'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('organizations', sa.Column('description', sa.Text(), nullable=True))
    op.add_column('organizations', sa.Column('tax_id', sa.String(20), nullable=True))
    op.add_column('organizations', sa.Column('contact_email', sa.String(200), nullable=True))
    op.add_column('organizations', sa.Column('contact_phone', sa.String(50), nullable=True))
    op.add_column('organizations', sa.Column('address', sa.Text(), nullable=True))
    op.add_column('organizations', sa.Column('settings', postgresql.JSONB(astext_type=sa.Text()), nullable=True))


def downgrade() -> None:
    op.drop_column('organizations', 'settings')
    op.drop_column('organizations', 'address')
    op.drop_column('organizations', 'contact_phone')
    op.drop_column('organizations', 'contact_email')
    op.drop_column('organizations', 'tax_id')
    op.drop_column('organizations', 'description')
