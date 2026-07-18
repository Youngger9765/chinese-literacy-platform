"""repair existing PII rows in staging DB (#1931)

PR #1930 fixed future seeds but left existing data dirty:
  - 2 early-dogfood gmail accounts' email fields still hold real PII
    (is_active was set False but email was not anonymized)
  - 王管理員 (admin@test.com) still has a UserRole row with role='teacher'
  - 小明 (student@test.com) may still be enrolled in 七年甲班 (grade-7 class)

This migration repairs those rows idempotently:
  A) UPDATE gmail user emails → inactive_{id}@test.com
  B) DELETE teacher UserRole for admin@test.com
  C) DELETE 小明's 七年甲班 ClassroomStudent enrollment

All operations use WHERE conditions so they are safe to run on any DB
state (fresh, partially-repaired, or fully-repaired).

Revision ID: pii01rep02air03
Revises: 705ba7c6b659
Create Date: 2026-05-23

"""
from typing import Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy import text


# revision identifiers, used by Alembic.
revision: str = "pii01rep02air03"
down_revision: Union[str, None] = "705ba7c6b659"
branch_labels = None
depends_on = None


def upgrade() -> None:
    """Repair existing PII rows — idempotent, safe to re-run.

    Bug A: Anonymize real gmail email addresses.
           CONCAT('inactive_', id::text, '@test.com') turns them into
           deterministic, non-PII addresses that can never match future
           real accounts (real emails won't start with 'inactive_N@').

    Bug B: Remove the erroneous teacher role from 王管理員 (admin@test.com).
           admin should hold only system_admin + org_admin (2 roles).

    Bug C: Remove 小明's enrollment in 七年甲班.
           小明 is a grade-3 persona; the grade-7 enrollment was a seed bug
           introduced before PR #1920.
    """
    conn = op.get_bind()

    # ------------------------------------------------------------------
    # Bug A: anonymize gmail PII emails
    # Idempotent: WHERE LIKE '%@gmail.com' → 0 rows if already repaired
    # ------------------------------------------------------------------
    conn.execute(text(
        "UPDATE users"
        "  SET email = CONCAT('inactive_', id::text, '@test.com')"
        " WHERE email LIKE '%@gmail.com'"
    ))

    # ------------------------------------------------------------------
    # Bug B: delete teacher role from admin@test.com
    # Idempotent: subquery returns NULL if admin not found → 0 rows deleted
    # ------------------------------------------------------------------
    conn.execute(text(
        "DELETE FROM user_roles"
        " WHERE user_id = (SELECT id FROM users WHERE email = 'admin@test.com')"
        "   AND role_id = (SELECT id FROM roles WHERE name = 'teacher')"
    ))

    # ------------------------------------------------------------------
    # Bug C: remove 小明's grade-7 class enrollment(s)
    # Idempotent: 0 rows if already removed or if 小明 not in any 七年 class
    # ------------------------------------------------------------------
    conn.execute(text(
        "DELETE FROM classroom_students"
        " WHERE student_id = (SELECT id FROM users WHERE email = 'student@test.com')"
        "   AND classroom_id IN (SELECT id FROM classrooms WHERE name LIKE '%七年%')"
    ))


def downgrade() -> None:
    """No-op — data repair cannot be safely reversed.

    Restoring deleted rows would require re-inserting real PII, which defeats
    the purpose of this migration.  A no-op downgrade is acceptable for a
    one-time data-repair migration.
    """
    pass
