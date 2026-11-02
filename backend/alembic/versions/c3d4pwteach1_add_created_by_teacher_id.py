"""add users.created_by_teacher_id, the password-teacher gate (#3818)

Revision ID: c3d4pwteach1
Revises: b2c3d4moe02
Create Date: 2026-11-02 00:00:00.000000

Why this migration exists: teachers could reset the password of ANY student
enrolled in their classroom, even students they never created (self-
registered accounts that later self-enrolled via a join code). This stamps
the teacher who actually created each student account so the application
layer (classroom_password.py) can gate on it instead of on classroom
membership. See docs/prd/2026-11-02-password-teacher-prd.md.

Idempotent DDL: checks information_schema.columns before ADD COLUMN, wraps
CREATE INDEX in IF NOT EXISTS, and the FK constraint add is guarded by a
pg_constraint lookup — safe to re-run on a shared preview/staging DB (see
sqlalchemy-model-safety skill Rule 6).

Adds:
  created_by_teacher_id  INTEGER NULL, FK -> users.id, indexed
    NULL means "nobody recorded creating this account" (self-registration,
    Junyi SSO first login, or legacy data predating this migration) and is
    fail-closed: no teacher may reset that account's password.

Backfills existing data (see PRD "資料模型變更" for the full rationale):
  only synthetic (@student.lingoleap.local) accounts -- the email domain
  shared by batch-create, CSV upload, and Junyi-import new-student creation
  -- using the EARLIEST active student-role grant's UserRole.granted_by.
  "Earliest" matters: a later role grant on an already-existing account
  (e.g. an admin manually re-granting a role, or Junyi import reusing an
  existing account) must not be mistaken for account creation. Accounts
  with a real email domain (self-registered, real Junyi SSO accounts) are
  left NULL -- there is no reliable historical signal to recover their
  creator from, and NULL is the correct, fail-closed answer for them.
"""
from typing import Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "c3d4pwteach1"
down_revision: Union[str, None] = "b2c3d4moe02"
branch_labels = None
depends_on = None

_FK_NAME = "users_created_by_teacher_id_fkey"


def _column_exists(conn, table: str, column: str) -> bool:
    result = conn.execute(
        sa.text(
            "SELECT column_name FROM information_schema.columns "
            "WHERE table_name = :table AND column_name = :column"
        ),
        {"table": table, "column": column},
    )
    return result.fetchone() is not None


def _fk_exists(conn, constraint_name: str) -> bool:
    result = conn.execute(
        sa.text("SELECT 1 FROM pg_constraint WHERE conname = :name"),
        {"name": constraint_name},
    )
    return result.fetchone() is not None


def upgrade() -> None:
    conn = op.get_bind()

    if not _column_exists(conn, "users", "created_by_teacher_id"):
        op.add_column(
            "users",
            sa.Column("created_by_teacher_id", sa.Integer(), nullable=True),
        )

    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_users_created_by_teacher_id "
        "ON users (created_by_teacher_id)"
    )

    if not _fk_exists(conn, _FK_NAME):
        op.create_foreign_key(
            _FK_NAME, "users", "users", ["created_by_teacher_id"], ["id"]
        )

    # Backfill: synthetic (teacher-created) accounts only, from the earliest
    # active student-role grant recorded for each user. DISTINCT ON ...
    # ORDER BY created_at ASC picks the first grant, not the most recent one
    # (a later re-grant on an existing self-registered account must not be
    # mistaken for the account's creator).
    op.execute(
        """
        UPDATE users u
        SET created_by_teacher_id = sub.granted_by
        FROM (
            SELECT DISTINCT ON (ur.user_id) ur.user_id, ur.granted_by
            FROM user_roles ur
            JOIN roles r ON ur.role_id = r.id
            WHERE r.name = 'student' AND ur.granted_by IS NOT NULL
            ORDER BY ur.user_id, ur.created_at ASC
        ) sub
        WHERE u.id = sub.user_id
          AND u.email LIKE '%@student.lingoleap.local'
          AND u.created_by_teacher_id IS NULL
        """
    )


def downgrade() -> None:
    conn = op.get_bind()
    if _fk_exists(conn, _FK_NAME):
        op.drop_constraint(_FK_NAME, "users", type_="foreignkey")
    op.execute("DROP INDEX IF EXISTS ix_users_created_by_teacher_id")
    if _column_exists(conn, "users", "created_by_teacher_id"):
        op.drop_column("users", "created_by_teacher_id")
