"""add assignment system tables

Covers Issue #143: Assignment Model + 副本策略 (copy strategy)

Tables added:
- assignments: teacher-issued reading assignments for classrooms
- assignment_submissions: per-student assignment progress tracking

Assignment.story_id  → YAML platform text (lesson_number as string)
Assignment.text_id   → DB text (texts table); points to fork for mutable texts

副本策略:
- Platform YAML texts: direct reference via story_id (never copied)
- DB texts, platform visibility: direct reference via text_id (never copied)
- DB texts, non-platform visibility: forked at assignment creation via
  resolve_text_for_assignment() in services/assignment_copy_strategy.py

Revision ID: k1l2m3n4o5p6
Revises: j0k1l2m3n4o5
Create Date: 2026-03-09 12:00:00.000000
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = 'k1l2m3n4o5p6'
down_revision: Union[str, None] = 'j0k1l2m3n4o5'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # --- assignments table ---
    op.create_table(
        'assignments',
        sa.Column('id', sa.Integer(), autoincrement=True, nullable=False),
        sa.Column('classroom_id', sa.Integer(), nullable=False),
        sa.Column('teacher_id', sa.Integer(), nullable=False),
        # Text source: exactly one of story_id or text_id is set
        sa.Column('story_id', sa.String(length=50), nullable=True),
        sa.Column('text_id', sa.Integer(), nullable=True),
        # Optional teacher customisation
        sa.Column('title', sa.String(length=200), nullable=True),
        sa.Column('description', sa.Text(), nullable=True),
        sa.Column('assignment_type', sa.String(length=20), nullable=False, server_default='reading'),
        sa.Column('due_date', sa.DateTime(timezone=True), nullable=True),
        sa.Column('is_active', sa.Boolean(), nullable=False, server_default=sa.text('true')),
        sa.Column(
            'created_at',
            sa.DateTime(timezone=True),
            server_default=sa.text('now()'),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(['classroom_id'], ['classrooms.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['teacher_id'], ['users.id']),
        sa.ForeignKeyConstraint(['text_id'], ['texts.id'], ondelete='SET NULL'),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index(
        op.f('ix_assignments_classroom_id'),
        'assignments',
        ['classroom_id'],
        unique=False,
    )
    op.create_index(
        op.f('ix_assignments_text_id'),
        'assignments',
        ['text_id'],
        unique=False,
    )

    # --- assignment_submissions table ---
    op.create_table(
        'assignment_submissions',
        sa.Column('id', sa.Integer(), autoincrement=True, nullable=False),
        sa.Column('assignment_id', sa.Integer(), nullable=False),
        sa.Column('student_id', sa.Integer(), nullable=False),
        sa.Column('status', sa.String(length=20), nullable=False, server_default='pending'),
        sa.Column('session_id', sa.Integer(), nullable=True),
        sa.Column('submitted_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('score', sa.Float(), nullable=True),
        sa.Column(
            'created_at',
            sa.DateTime(timezone=True),
            server_default=sa.text('now()'),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(['assignment_id'], ['assignments.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['session_id'], ['learning_sessions.id']),
        sa.ForeignKeyConstraint(['student_id'], ['users.id']),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('assignment_id', 'student_id', name='uq_assignment_student'),
    )
    op.create_index(
        op.f('ix_assignment_submissions_assignment_id'),
        'assignment_submissions',
        ['assignment_id'],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index(
        op.f('ix_assignment_submissions_assignment_id'),
        table_name='assignment_submissions',
    )
    op.drop_table('assignment_submissions')

    op.drop_index(op.f('ix_assignments_text_id'), table_name='assignments')
    op.drop_index(op.f('ix_assignments_classroom_id'), table_name='assignments')
    op.drop_table('assignments')
