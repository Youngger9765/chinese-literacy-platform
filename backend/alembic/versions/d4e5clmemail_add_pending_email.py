"""add users.pending_email, the two-phase account-claim handshake (#3824)

Revision ID: d4e5clmemail
Revises: d4e5seatnum1
Create Date: 2026-11-03 00:00:00.000000

Why this migration exists: #3824 lets a student holding a teacher-created
("child") account bind a real email + password to take full ownership of it,
clearing `created_by_teacher_id` (#3818) so the original creator loses
reset-password authority. A security review (H1) found the single-phase
version let anyone who merely knew the account's printed card password
PERMANENTLY strip the real creator's recovery authority in one request --
before #3824 a stolen card was recoverable (the teacher could still reset
it); the single-phase design made it not recoverable. This column makes the
handover two-phase: the new email is held here, not written to `users.email`,
until the account's recorded password teacher (or system_admin) explicitly
approves the request (classroom_password.py's approve-claim endpoint) --
an earlier email-token-redemption design was rejected by a second review
pass (it only downgraded H1: an attacker who controls new_email could file
and redeem alone, with no teacher notification). `created_by_teacher_id`
stays set for the whole pending window, so the original creator can still
reset the password (which also clears this column, revoking the in-flight
claim -- see classroom_password.py). See
docs/prd/2026-11-02-child-handover-prd.md.

Idempotent DDL: checks information_schema.columns before ADD COLUMN and
wraps CREATE INDEX in IF NOT EXISTS -- safe to re-run on a shared
preview/staging DB (sqlalchemy-model-safety skill Rule 6). No FK (this is a
plain string, not a reference to another row) and no backfill (brand new
concept with no prior data to recover).

Adds:
  pending_email  VARCHAR(254) NULL, indexed
    NULL means "no pending claim in flight" for this account.
"""
from typing import Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "d4e5clmemail"
down_revision: Union[str, None] = "d4e5seatnum1"
branch_labels = None
depends_on = None


def _column_exists(conn, table: str, column: str) -> bool:
    result = conn.execute(
        sa.text(
            "SELECT column_name FROM information_schema.columns "
            "WHERE table_name = :table AND column_name = :column"
        ),
        {"table": table, "column": column},
    )
    return result.fetchone() is not None


def upgrade() -> None:
    conn = op.get_bind()

    if not _column_exists(conn, "users", "pending_email"):
        op.add_column(
            "users",
            sa.Column("pending_email", sa.String(length=254), nullable=True),
        )

    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_users_pending_email "
        "ON users (pending_email)"
    )


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS ix_users_pending_email")
    conn = op.get_bind()
    if _column_exists(conn, "users", "pending_email"):
        op.drop_column("users", "pending_email")
