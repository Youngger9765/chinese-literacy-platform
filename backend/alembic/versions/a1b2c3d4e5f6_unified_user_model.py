"""unified_user_model

Revision ID: a1b2c3d4e5f6
Revises: 9594d6dbf3c1
Create Date: 2026-03-05 10:00:00.000000

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
    # ──────────────────────────────────────────────
    # 1. Create organizations table
    # ──────────────────────────────────────────────
    op.create_table(
        'organizations',
        sa.Column('id', sa.String(length=36), nullable=False),
        sa.Column('name', sa.String(length=200), nullable=False),
        sa.Column('display_name', sa.String(length=200), nullable=True),
        sa.Column('is_active', sa.Boolean(), nullable=False, server_default=sa.text('true')),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.PrimaryKeyConstraint('id'),
    )

    # ──────────────────────────────────────────────
    # 2. Create users table
    # ──────────────────────────────────────────────
    op.create_table(
        'users',
        sa.Column('id', sa.Integer(), autoincrement=True, nullable=False),
        sa.Column('email', sa.String(length=254), nullable=False),
        sa.Column('password_hash', sa.String(length=255), nullable=False),
        sa.Column('name', sa.String(length=100), nullable=False),
        sa.Column('phone', sa.String(length=20), nullable=True),
        sa.Column('avatar_url', sa.String(length=500), nullable=True),
        sa.Column('is_active', sa.Boolean(), nullable=False, server_default=sa.text('true')),
        sa.Column('email_verified', sa.Boolean(), nullable=False, server_default=sa.text('false')),
        sa.Column('last_login_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('email'),
    )
    op.create_index(op.f('ix_users_email'), 'users', ['email'], unique=True)

    # ──────────────────────────────────────────────
    # 3. Create roles table
    # ──────────────────────────────────────────────
    op.create_table(
        'roles',
        sa.Column('id', sa.Integer(), autoincrement=True, nullable=False),
        sa.Column('name', sa.String(length=50), nullable=False),
        sa.Column('display_name', sa.String(length=100), nullable=False),
        sa.Column('scope_level', sa.String(length=20), nullable=False),
        sa.Column('description', sa.String(length=500), nullable=True),
        sa.Column('is_active', sa.Boolean(), nullable=False, server_default=sa.text('true')),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('name'),
    )

    # ──────────────────────────────────────────────
    # 4. Create user_roles table
    # ──────────────────────────────────────────────
    op.create_table(
        'user_roles',
        sa.Column('id', sa.Integer(), autoincrement=True, nullable=False),
        sa.Column('user_id', sa.Integer(), nullable=False),
        sa.Column('role_id', sa.Integer(), nullable=False),
        sa.Column('scope_type', sa.String(length=20), nullable=False),
        sa.Column('scope_id', sa.String(length=100), nullable=True),
        sa.Column('is_active', sa.Boolean(), nullable=False, server_default=sa.text('true')),
        sa.Column('granted_by', sa.Integer(), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.ForeignKeyConstraint(['user_id'], ['users.id'], name='fk_user_roles_user_id_users', ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['role_id'], ['roles.id'], name='fk_user_roles_role_id_roles'),
        sa.ForeignKeyConstraint(['granted_by'], ['users.id'], name='fk_user_roles_granted_by_users'),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('user_id', 'role_id', 'scope_type', 'scope_id', name='uq_user_roles_user_role_scope'),
    )

    # ──────────────────────────────────────────────
    # 5. Create student_profiles table
    # ──────────────────────────────────────────────
    op.create_table(
        'student_profiles',
        sa.Column('id', sa.Integer(), autoincrement=True, nullable=False),
        sa.Column('user_id', sa.Integer(), nullable=False),
        sa.Column('school_id', sa.Integer(), nullable=False),
        sa.Column('student_number', sa.String(length=20), nullable=True),
        sa.Column('birthdate', sa.Date(), nullable=False),
        sa.Column('password_changed', sa.Boolean(), nullable=False, server_default=sa.text('false')),
        sa.Column('grade', sa.Integer(), nullable=True),
        sa.ForeignKeyConstraint(['user_id'], ['users.id'], name='fk_student_profiles_user_id_users', ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['school_id'], ['schools.id'], name='fk_student_profiles_school_id_schools'),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('user_id', name='uq_student_profiles_user_id'),
        sa.UniqueConstraint('school_id', 'student_number', name='uq_student_profiles_school_student_number'),
    )

    # ──────────────────────────────────────────────
    # 6. Alter schools table — add new columns
    # ──────────────────────────────────────────────
    op.add_column('schools', sa.Column('organization_id', sa.String(length=36), nullable=True))
    op.add_column('schools', sa.Column('display_name', sa.String(length=200), nullable=True))
    op.add_column('schools', sa.Column('address', sa.String(length=500), nullable=True))
    op.add_column('schools', sa.Column('phone', sa.String(length=20), nullable=True))
    op.add_column('schools', sa.Column('admin_user_id', sa.Integer(), nullable=True))
    op.add_column('schools', sa.Column('join_code', sa.String(length=20), nullable=True))
    op.add_column('schools', sa.Column('is_active', sa.Boolean(), nullable=False, server_default=sa.text('true')))
    op.add_column('schools', sa.Column('settings', sa.JSON(), nullable=True))
    op.add_column('schools', sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False))
    op.add_column('schools', sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False))
    op.create_unique_constraint('uq_schools_join_code', 'schools', ['join_code'])
    op.create_foreign_key('fk_schools_organization_id_organizations', 'schools', 'organizations', ['organization_id'], ['id'])
    op.create_foreign_key('fk_schools_admin_user_id_users', 'schools', 'users', ['admin_user_id'], ['id'])

    # ──────────────────────────────────────────────
    # 7. Create classrooms table (replaces classes)
    # ──────────────────────────────────────────────
    op.create_table(
        'classrooms',
        sa.Column('id', sa.Integer(), autoincrement=True, nullable=False),
        sa.Column('school_id', sa.Integer(), nullable=False),
        sa.Column('teacher_id', sa.Integer(), nullable=False),
        sa.Column('name', sa.String(length=100), nullable=False),
        sa.Column('grade', sa.Integer(), nullable=True),
        sa.Column('is_active', sa.Boolean(), nullable=False, server_default=sa.text('true')),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.ForeignKeyConstraint(['school_id'], ['schools.id'], name='fk_classrooms_school_id_schools'),
        sa.ForeignKeyConstraint(['teacher_id'], ['users.id'], name='fk_classrooms_teacher_id_users'),
        sa.PrimaryKeyConstraint('id'),
    )

    # ──────────────────────────────────────────────
    # 8. Create classroom_students table (replaces class_students)
    # ──────────────────────────────────────────────
    op.create_table(
        'classroom_students',
        sa.Column('id', sa.Integer(), autoincrement=True, nullable=False),
        sa.Column('classroom_id', sa.Integer(), nullable=False),
        sa.Column('student_id', sa.Integer(), nullable=False),
        sa.Column('enrolled_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.ForeignKeyConstraint(['classroom_id'], ['classrooms.id'], name='fk_classroom_students_classroom_id_classrooms'),
        sa.ForeignKeyConstraint(['student_id'], ['users.id'], name='fk_classroom_students_student_id_users'),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('classroom_id', 'student_id', name='uq_classroom_students_classroom_student'),
    )

    # ──────────────────────────────────────────────
    # 9. Update texts FKs — repoint to new tables
    #    Use batch_alter_table to safely drop unnamed FK constraints
    # ──────────────────────────────────────────────
    with op.batch_alter_table('texts', schema=None) as batch_op:
        # Drop old FKs (unnamed, pointing to classes and teachers)
        batch_op.drop_constraint('texts_class_id_fkey', type_='foreignkey')
        batch_op.drop_constraint('texts_teacher_id_fkey', type_='foreignkey')
        batch_op.drop_constraint('texts_created_by_id_fkey', type_='foreignkey')
        # Create new FKs pointing to classrooms and users
        batch_op.create_foreign_key('fk_texts_class_id_classrooms', 'classrooms', ['class_id'], ['id'])
        batch_op.create_foreign_key('fk_texts_teacher_id_users', 'users', ['teacher_id'], ['id'])
        batch_op.create_foreign_key('fk_texts_created_by_id_users', 'users', ['created_by_id'], ['id'])

    # ──────────────────────────────────────────────
    # 10. Update learning_sessions — repoint student FK, add columns
    # ──────────────────────────────────────────────
    op.add_column('learning_sessions', sa.Column('classroom_id', sa.Integer(), nullable=True))
    op.add_column('learning_sessions', sa.Column('started_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False))

    with op.batch_alter_table('learning_sessions', schema=None) as batch_op:
        # Drop old FK (unnamed, pointing to students)
        batch_op.drop_constraint('learning_sessions_student_id_fkey', type_='foreignkey')
        # Create new FKs pointing to users and classrooms
        batch_op.create_foreign_key('fk_learning_sessions_student_id_users', 'users', ['student_id'], ['id'])
        batch_op.create_foreign_key('fk_learning_sessions_classroom_id_classrooms', 'classrooms', ['classroom_id'], ['id'])

    # ──────────────────────────────────────────────
    # 11. Drop old tables (order matters for FK deps)
    # ──────────────────────────────────────────────
    op.drop_table('class_students')
    op.drop_table('classes')
    op.drop_table('teachers')
    op.drop_table('students')

    # ──────────────────────────────────────────────
    # 12. Seed roles data
    # ──────────────────────────────────────────────
    roles_table = sa.table(
        'roles',
        sa.column('name', sa.String),
        sa.column('display_name', sa.String),
        sa.column('scope_level', sa.String),
    )
    op.bulk_insert(roles_table, [
        {'name': 'system_admin', 'display_name': '系統管理員', 'scope_level': 'platform'},
        {'name': 'org_owner', 'display_name': '機構擁有者', 'scope_level': 'organization'},
        {'name': 'org_admin', 'display_name': '機構管理員', 'scope_level': 'organization'},
        {'name': 'principal', 'display_name': '校長', 'scope_level': 'school'},
        {'name': 'director', 'display_name': '主任', 'scope_level': 'school'},
        {'name': 'teacher', 'display_name': '教師', 'scope_level': 'school'},
        {'name': 'student', 'display_name': '學生', 'scope_level': 'school'},
        {'name': 'staff', 'display_name': '一般員工', 'scope_level': 'school'},
    ])


def downgrade() -> None:
    # ──────────────────────────────────────────────
    # 1. Re-create old tables: students, teachers, classes, class_students
    #    (Must exist before we can repoint FKs back to them)
    # ──────────────────────────────────────────────
    op.create_table(
        'students',
        sa.Column('id', sa.Integer(), autoincrement=True, nullable=False),
        sa.Column('name', sa.String(length=100), nullable=False),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_table(
        'teachers',
        sa.Column('id', sa.Integer(), autoincrement=True, nullable=False),
        sa.Column('school_id', sa.Integer(), nullable=False),
        sa.Column('email', sa.String(length=254), nullable=False),
        sa.Column('name', sa.String(length=100), nullable=False),
        sa.ForeignKeyConstraint(['school_id'], ['schools.id']),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('email'),
    )
    op.create_table(
        'classes',
        sa.Column('id', sa.Integer(), autoincrement=True, nullable=False),
        sa.Column('teacher_id', sa.Integer(), nullable=False),
        sa.Column('name', sa.String(length=100), nullable=False),
        sa.ForeignKeyConstraint(['teacher_id'], ['teachers.id']),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_table(
        'class_students',
        sa.Column('id', sa.Integer(), autoincrement=True, nullable=False),
        sa.Column('class_id', sa.Integer(), nullable=False),
        sa.Column('student_id', sa.Integer(), nullable=False),
        sa.ForeignKeyConstraint(['class_id'], ['classes.id']),
        sa.ForeignKeyConstraint(['student_id'], ['students.id']),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('class_id', 'student_id'),
    )

    # ──────────────────────────────────────────────
    # 2. Revert learning_sessions FKs back to students, drop new columns
    # ──────────────────────────────────────────────
    with op.batch_alter_table('learning_sessions', schema=None) as batch_op:
        batch_op.drop_constraint('fk_learning_sessions_classroom_id_classrooms', type_='foreignkey')
        batch_op.drop_constraint('fk_learning_sessions_student_id_users', type_='foreignkey')
        batch_op.create_foreign_key(None, 'students', ['student_id'], ['id'])

    op.drop_column('learning_sessions', 'started_at')
    op.drop_column('learning_sessions', 'classroom_id')

    # ──────────────────────────────────────────────
    # 3. Revert texts FKs back to classes and teachers
    # ──────────────────────────────────────────────
    with op.batch_alter_table('texts', schema=None) as batch_op:
        batch_op.drop_constraint('fk_texts_created_by_id_users', type_='foreignkey')
        batch_op.drop_constraint('fk_texts_teacher_id_users', type_='foreignkey')
        batch_op.drop_constraint('fk_texts_class_id_classrooms', type_='foreignkey')
        batch_op.create_foreign_key(None, 'classes', ['class_id'], ['id'])
        batch_op.create_foreign_key(None, 'teachers', ['teacher_id'], ['id'])
        batch_op.create_foreign_key(None, 'teachers', ['created_by_id'], ['id'])

    # ──────────────────────────────────────────────
    # 4. Drop new junction/replacement tables
    # ──────────────────────────────────────────────
    op.drop_table('classroom_students')
    op.drop_table('classrooms')

    # ──────────────────────────────────────────────
    # 5. Drop added columns from schools
    # ──────────────────────────────────────────────
    op.drop_constraint('fk_schools_admin_user_id_users', 'schools', type_='foreignkey')
    op.drop_constraint('fk_schools_organization_id_organizations', 'schools', type_='foreignkey')
    op.drop_constraint('uq_schools_join_code', 'schools', type_='unique')
    op.drop_column('schools', 'updated_at')
    op.drop_column('schools', 'created_at')
    op.drop_column('schools', 'settings')
    op.drop_column('schools', 'is_active')
    op.drop_column('schools', 'join_code')
    op.drop_column('schools', 'admin_user_id')
    op.drop_column('schools', 'phone')
    op.drop_column('schools', 'address')
    op.drop_column('schools', 'display_name')
    op.drop_column('schools', 'organization_id')

    # ──────────────────────────────────────────────
    # 6. Drop new tables (order: dependent tables first)
    # ──────────────────────────────────────────────
    op.drop_table('student_profiles')
    op.drop_table('user_roles')
    op.drop_table('roles')
    op.drop_index(op.f('ix_users_email'), table_name='users')
    op.drop_table('users')
    op.drop_table('organizations')
