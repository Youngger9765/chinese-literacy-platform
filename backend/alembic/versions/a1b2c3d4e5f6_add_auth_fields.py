"""add_auth_fields_to_teacher_student_class

Revision ID: a1b2c3d4e5f6
Revises: 9594d6dbf3c1
Create Date: 2026-02-27

Issue #82: Teacher/Student auth system (Email + Password).
Adds password_hash, is_active, created_at to teachers and students.
Adds class_code to classes, seat_number to class_students.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'a1b2c3d4e5f6'
down_revision: Union[str, None] = '9594d6dbf3c1'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # --- teachers ---
    op.add_column('teachers', sa.Column('password_hash', sa.String(length=255), nullable=False, server_default=''))
    op.add_column('teachers', sa.Column('is_active', sa.Boolean(), nullable=False, server_default=sa.text('true')))
    op.add_column('teachers', sa.Column('created_at', sa.DateTime(), nullable=False, server_default=sa.func.now()))
    # Remove server_defaults after backfill (they're only for existing rows)
    op.alter_column('teachers', 'password_hash', server_default=None)
    op.alter_column('teachers', 'is_active', server_default=None)
    op.alter_column('teachers', 'created_at', server_default=None)

    # --- students ---
    op.add_column('students', sa.Column('password_hash', sa.String(length=255), nullable=False, server_default=''))
    op.add_column('students', sa.Column('is_active', sa.Boolean(), nullable=False, server_default=sa.text('true')))
    op.add_column('students', sa.Column('created_at', sa.DateTime(), nullable=False, server_default=sa.func.now()))
    op.alter_column('students', 'password_hash', server_default=None)
    op.alter_column('students', 'is_active', server_default=None)
    op.alter_column('students', 'created_at', server_default=None)

    # --- classes ---
    op.add_column('classes', sa.Column('class_code', sa.String(length=8), nullable=False, server_default=''))
    op.create_unique_constraint('uq_classes_class_code', 'classes', ['class_code'])
    op.alter_column('classes', 'class_code', server_default=None)

    # --- class_students ---
    op.add_column('class_students', sa.Column('seat_number', sa.Integer(), nullable=False, server_default=sa.text('0')))
    op.create_unique_constraint('uq_class_students_class_seat', 'class_students', ['class_id', 'seat_number'])
    op.alter_column('class_students', 'seat_number', server_default=None)


def downgrade() -> None:
    # --- class_students ---
    op.drop_constraint('uq_class_students_class_seat', 'class_students', type_='unique')
    op.drop_column('class_students', 'seat_number')

    # --- classes ---
    op.drop_constraint('uq_classes_class_code', 'classes', type_='unique')
    op.drop_column('classes', 'class_code')

    # --- students ---
    op.drop_column('students', 'created_at')
    op.drop_column('students', 'is_active')
    op.drop_column('students', 'password_hash')

    # --- teachers ---
    op.drop_column('teachers', 'created_at')
    op.drop_column('teachers', 'is_active')
    op.drop_column('teachers', 'password_hash')
