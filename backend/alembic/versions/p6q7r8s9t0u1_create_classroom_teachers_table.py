"""create classroom_teachers table

Revision ID: p6q7r8s9t0u1
Revises: o5p6q7r8s9t0
Create Date: 2026-03-09 18:00:00.000000

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = 'p6q7r8s9t0u1'
down_revision: Union[str, None] = 'o5p6q7r8s9t0'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'classroom_teachers',
        sa.Column('id', sa.Integer, primary_key=True, autoincrement=True),
        sa.Column('classroom_id', sa.Integer, sa.ForeignKey('classrooms.id', ondelete='CASCADE'), nullable=False),
        sa.Column('teacher_id', sa.Integer, sa.ForeignKey('users.id'), nullable=False),
        sa.Column('role', sa.String(20), nullable=False, server_default='assistant'),
        sa.Column('invited_by', sa.Integer, sa.ForeignKey('users.id'), nullable=True),
        sa.Column('invited_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.UniqueConstraint('classroom_id', 'teacher_id', name='uq_classroom_teachers_classroom_teacher'),
    )

    # Seed existing primary teachers from classrooms table
    op.execute(
        """
        INSERT INTO classroom_teachers (classroom_id, teacher_id, role, invited_at)
        SELECT id, teacher_id, 'primary', created_at
        FROM classrooms
        """
    )


def downgrade() -> None:
    op.drop_table('classroom_teachers')
