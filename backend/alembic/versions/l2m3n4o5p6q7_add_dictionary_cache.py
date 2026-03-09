"""add dictionary_cache table for MOE dictionary API caching

Revision ID: l2m3n4o5p6q7
Revises: k1l2m3n4o5p6
Create Date: 2026-03-09

"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = 'l2m3n4o5p6q7'
down_revision = 'k2l3m4n5o6p7'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        'dictionary_cache',
        sa.Column('id', sa.Integer(), autoincrement=True, nullable=False),
        sa.Column('character', sa.String(length=4), nullable=False),
        sa.Column('source', sa.String(length=20), nullable=False),
        sa.Column('zhuyin', sa.String(length=50), nullable=True),
        sa.Column('stroke_count', sa.Integer(), nullable=True),
        sa.Column('definitions', postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column('raw_response', sa.Text(), nullable=True),
        sa.Column('fetched_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('not_found', sa.Integer(), nullable=False),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('character', 'source', name='uq_dictionary_cache_char_source'),
    )
    op.create_index(op.f('ix_dictionary_cache_character'), 'dictionary_cache', ['character'], unique=False)


def downgrade() -> None:
    op.drop_index(op.f('ix_dictionary_cache_character'), table_name='dictionary_cache')
    op.drop_table('dictionary_cache')
