"""add teacher_notification_reads table for issue #256

Revision ID: o5p6q7r8s9t0
Revises: k1l2m3n4o5p6
Create Date: 2026-03-09 14:00:00.000000

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = 'o5p6q7r8s9t0'
down_revision: Union[str, None] = 'k1l2m3n4o5p6'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'teacher_notification_reads',
        sa.Column('id', sa.Integer(), autoincrement=True, nullable=False),
        sa.Column('teacher_id', sa.Integer(), nullable=False),
        sa.Column('alert_key', sa.String(length=200), nullable=False),
        sa.Column(
            'read_at',
            sa.DateTime(timezone=True),
            server_default=sa.text('now()'),
            nullable=True,
        ),
        sa.ForeignKeyConstraint(['teacher_id'], ['users.id']),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('teacher_id', 'alert_key', name='uq_teacher_alert_read'),
    )
    op.create_index(
        op.f('ix_teacher_notification_reads_teacher_id'),
        'teacher_notification_reads',
        ['teacher_id'],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index(
        op.f('ix_teacher_notification_reads_teacher_id'),
        table_name='teacher_notification_reads',
    )
    op.drop_table('teacher_notification_reads')
