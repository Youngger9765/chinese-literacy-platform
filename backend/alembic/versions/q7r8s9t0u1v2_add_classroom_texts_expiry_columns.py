"""add expires_at and deleted_at to classroom_texts

Revision ID: q7r8s9t0u1v2
Revises: p6q7r8s9t0u1
Create Date: 2026-03-09 18:01:00.000000

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = 'q7r8s9t0u1v2'
down_revision: Union[str, None] = 'p6q7r8s9t0u1'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        'classroom_texts',
        sa.Column('expires_at', sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index('ix_classroom_texts_expires_at', 'classroom_texts', ['expires_at'])

    op.add_column(
        'classroom_texts',
        sa.Column('deleted_at', sa.DateTime(timezone=True), nullable=True),
    )


def downgrade() -> None:
    op.drop_column('classroom_texts', 'deleted_at')
    op.drop_index('ix_classroom_texts_expires_at', table_name='classroom_texts')
    op.drop_column('classroom_texts', 'expires_at')
