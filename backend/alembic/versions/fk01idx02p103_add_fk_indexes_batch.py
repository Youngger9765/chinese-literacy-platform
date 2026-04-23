"""add FK indexes batch (issue #1265)

Revision ID: fk01idx02p103
Revises: px01perf02idx03
Create Date: 2026-04-23 10:00:00.000000

Adds indexes for P1 performance optimization wave — 6 high-frequency FK columns
that appear in hot WHERE/JOIN paths but had no B-tree index:

  - classroom_students.classroom_id  (ix_classroom_students_classroom_id)
  - classroom_students.student_id    (ix_classroom_students_student_id)
  - classrooms.teacher_id            (ix_classrooms_teacher_id)
  - assignments.teacher_id           (ix_assignments_teacher_id)
  - assignment_submissions.session_id (ix_assignment_submissions_session_id)
  - user_roles.user_id               (ix_user_roles_user_id)

All new indexes use CREATE INDEX CONCURRENTLY to avoid table locks on production.
Alembic requires autocommit mode for CONCURRENTLY.
All index creations are idempotent (IF NOT EXISTS guards).

Sister migration: px01perf02idx03 (P0 wave, PR #1226)

Per Young approval 2026-04-23.
"""

from alembic import op
from sqlalchemy import inspect as sa_inspect

# revision identifiers, used by Alembic.
revision = "fk01idx02p103"
down_revision = "px01perf02idx03"
branch_labels = None
depends_on = None


def _table_exists(bind, table_name: str) -> bool:
    return table_name in sa_inspect(bind).get_table_names()


def _index_exists(bind, table_name: str, index_name: str) -> bool:
    if not _table_exists(bind, table_name):
        return False
    return any(
        idx["name"] == index_name
        for idx in sa_inspect(bind).get_indexes(table_name)
    )


def upgrade() -> None:
    bind = op.get_bind()

    # ── classroom_students.classroom_id ───────────────────────────────────────
    if not _index_exists(bind, "classroom_students", "ix_classroom_students_classroom_id"):
        with op.get_context().autocommit_block():
            op.execute(
                "CREATE INDEX CONCURRENTLY IF NOT EXISTS ix_classroom_students_classroom_id "
                "ON classroom_students (classroom_id)"
            )

    # ── classroom_students.student_id ─────────────────────────────────────────
    if not _index_exists(bind, "classroom_students", "ix_classroom_students_student_id"):
        with op.get_context().autocommit_block():
            op.execute(
                "CREATE INDEX CONCURRENTLY IF NOT EXISTS ix_classroom_students_student_id "
                "ON classroom_students (student_id)"
            )

    # ── classrooms.teacher_id ─────────────────────────────────────────────────
    if not _index_exists(bind, "classrooms", "ix_classrooms_teacher_id"):
        with op.get_context().autocommit_block():
            op.execute(
                "CREATE INDEX CONCURRENTLY IF NOT EXISTS ix_classrooms_teacher_id "
                "ON classrooms (teacher_id)"
            )

    # ── assignments.teacher_id ────────────────────────────────────────────────
    if not _index_exists(bind, "assignments", "ix_assignments_teacher_id"):
        with op.get_context().autocommit_block():
            op.execute(
                "CREATE INDEX CONCURRENTLY IF NOT EXISTS ix_assignments_teacher_id "
                "ON assignments (teacher_id)"
            )

    # ── assignment_submissions.session_id ─────────────────────────────────────
    if not _index_exists(bind, "assignment_submissions", "ix_assignment_submissions_session_id"):
        with op.get_context().autocommit_block():
            op.execute(
                "CREATE INDEX CONCURRENTLY IF NOT EXISTS ix_assignment_submissions_session_id "
                "ON assignment_submissions (session_id)"
            )

    # ── user_roles.user_id ────────────────────────────────────────────────────
    if not _index_exists(bind, "user_roles", "ix_user_roles_user_id"):
        with op.get_context().autocommit_block():
            op.execute(
                "CREATE INDEX CONCURRENTLY IF NOT EXISTS ix_user_roles_user_id "
                "ON user_roles (user_id)"
            )


def downgrade() -> None:
    bind = op.get_bind()

    if _index_exists(bind, "user_roles", "ix_user_roles_user_id"):
        op.drop_index("ix_user_roles_user_id", table_name="user_roles")

    if _index_exists(bind, "assignment_submissions", "ix_assignment_submissions_session_id"):
        op.drop_index(
            "ix_assignment_submissions_session_id",
            table_name="assignment_submissions",
        )

    if _index_exists(bind, "assignments", "ix_assignments_teacher_id"):
        op.drop_index("ix_assignments_teacher_id", table_name="assignments")

    if _index_exists(bind, "classrooms", "ix_classrooms_teacher_id"):
        op.drop_index("ix_classrooms_teacher_id", table_name="classrooms")

    if _index_exists(bind, "classroom_students", "ix_classroom_students_student_id"):
        op.drop_index(
            "ix_classroom_students_student_id",
            table_name="classroom_students",
        )

    if _index_exists(bind, "classroom_students", "ix_classroom_students_classroom_id"):
        op.drop_index(
            "ix_classroom_students_classroom_id",
            table_name="classroom_students",
        )
