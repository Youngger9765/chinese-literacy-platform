"""add missing tables and columns from merged features

Covers:
- #248 Error Correction: error_corrections table
- #243 Comprehension Scoring: 5 columns on learning_sessions
- #90 Teacher Instructions: teacher_instructions table
- #242 Socratic dialogue history: dialogue_turns table
- #299 Student tags: student_tags table

Revision ID: j0k1l2m3n4o5
Revises: i9j0k1l2m3n4
Create Date: 2026-03-09 12:00:00.000000

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = 'j0k1l2m3n4o5'
down_revision: Union[str, None] = 'i9j0k1l2m3n4'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # --- #248: error_corrections table ---
    op.create_table(
        'error_corrections',
        sa.Column('id', sa.Integer(), autoincrement=True, nullable=False),
        sa.Column('student_id', sa.Integer(), nullable=False),
        sa.Column('character', sa.String(length=10), nullable=False),
        sa.Column('correction_type', sa.String(length=20), nullable=True, server_default='practice'),
        sa.Column(
            'created_at',
            sa.DateTime(timezone=True),
            server_default=sa.text('now()'),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(['student_id'], ['users.id']),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index(
        op.f('ix_error_corrections_student_id'),
        'error_corrections',
        ['student_id'],
        unique=False,
    )

    # --- #243: comprehension scoring columns on learning_sessions ---
    op.add_column(
        'learning_sessions',
        sa.Column('comprehension_score', sa.Float(), nullable=True),
    )
    op.add_column(
        'learning_sessions',
        sa.Column('literal_score', sa.Float(), nullable=True),
    )
    op.add_column(
        'learning_sessions',
        sa.Column('inferential_score', sa.Float(), nullable=True),
    )
    op.add_column(
        'learning_sessions',
        sa.Column('evaluative_score', sa.Float(), nullable=True),
    )
    op.add_column(
        'learning_sessions',
        sa.Column('comprehension_feedback', sa.Text(), nullable=True),
    )

    # --- #90: teacher_instructions table ---
    op.create_table(
        'teacher_instructions',
        sa.Column('id', sa.Integer(), autoincrement=True, nullable=False),
        sa.Column('teacher_id', sa.Integer(), nullable=False),
        sa.Column('student_id', sa.Integer(), nullable=False),
        sa.Column('classroom_id', sa.Integer(), nullable=False),
        sa.Column('instruction_type', sa.String(length=50), nullable=True, server_default='general'),
        sa.Column('content', sa.Text(), nullable=False),
        sa.Column('is_active', sa.Boolean(), nullable=True, server_default=sa.text('true')),
        sa.Column(
            'created_at',
            sa.DateTime(timezone=True),
            server_default=sa.text('now()'),
            nullable=True,
        ),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(['classroom_id'], ['classrooms.id']),
        sa.ForeignKeyConstraint(['student_id'], ['users.id']),
        sa.ForeignKeyConstraint(['teacher_id'], ['users.id']),
        sa.PrimaryKeyConstraint('id'),
    )

    # --- #242: dialogue_turns table ---
    op.create_table(
        'dialogue_turns',
        sa.Column('id', sa.Integer(), autoincrement=True, nullable=False),
        sa.Column('socratic_session_id', sa.String(length=64), nullable=False),
        sa.Column('learning_session_id', sa.Integer(), nullable=True),
        sa.Column('turn_order', sa.Integer(), nullable=False),
        sa.Column('role', sa.String(length=20), nullable=False),
        sa.Column('text', sa.String(length=2000), nullable=False),
        sa.Column('is_correct', sa.Boolean(), nullable=True),
        sa.Column('phase', sa.String(length=20), nullable=True),
        sa.Column(
            'created_at',
            sa.DateTime(timezone=True),
            server_default=sa.text('now()'),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(
            ['learning_session_id'],
            ['learning_sessions.id'],
        ),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index(
        op.f('ix_dialogue_turns_socratic_session_id'),
        'dialogue_turns',
        ['socratic_session_id'],
        unique=False,
    )
    op.create_index(
        op.f('ix_dialogue_turns_learning_session_id'),
        'dialogue_turns',
        ['learning_session_id'],
        unique=False,
    )

    # --- #299: student_tags table ---
    op.create_table(
        'student_tags',
        sa.Column('id', sa.Integer(), autoincrement=True, nullable=False),
        sa.Column('student_id', sa.Integer(), nullable=False),
        sa.Column('teacher_id', sa.Integer(), nullable=False),
        sa.Column('tag_name', sa.String(length=50), nullable=False),
        sa.Column('color', sa.String(length=20), nullable=False, server_default='gray'),
        sa.Column(
            'created_at',
            sa.DateTime(timezone=True),
            server_default=sa.text('now()'),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(['student_id'], ['users.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['teacher_id'], ['users.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('student_id', 'tag_name'),
    )
    op.create_index(
        op.f('ix_student_tags_student_id'),
        'student_tags',
        ['student_id'],
        unique=False,
    )
    op.create_index(
        op.f('ix_student_tags_teacher_id'),
        'student_tags',
        ['teacher_id'],
        unique=False,
    )


def downgrade() -> None:
    # student_tags
    op.drop_index(op.f('ix_student_tags_teacher_id'), table_name='student_tags')
    op.drop_index(op.f('ix_student_tags_student_id'), table_name='student_tags')
    op.drop_table('student_tags')

    # dialogue_turns
    op.drop_index(op.f('ix_dialogue_turns_learning_session_id'), table_name='dialogue_turns')
    op.drop_index(op.f('ix_dialogue_turns_socratic_session_id'), table_name='dialogue_turns')
    op.drop_table('dialogue_turns')

    # teacher_instructions
    op.drop_table('teacher_instructions')

    # comprehension scoring columns
    op.drop_column('learning_sessions', 'comprehension_feedback')
    op.drop_column('learning_sessions', 'evaluative_score')
    op.drop_column('learning_sessions', 'inferential_score')
    op.drop_column('learning_sessions', 'literal_score')
    op.drop_column('learning_sessions', 'comprehension_score')

    # error_corrections
    op.drop_index(op.f('ix_error_corrections_student_id'), table_name='error_corrections')
    op.drop_table('error_corrections')
