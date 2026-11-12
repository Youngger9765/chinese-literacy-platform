"""add users.password_changed_at, token invalidation on password change (find_016vZk1d3wRKkhjQMTUbGU6Y)

Revision ID: e5f6tokeninv1
Revises: c3d4pwteach1m
Create Date: 2026-11-05 00:00:00.000000

Retargeted 2026-11-06 for the hotfix-to-prod cherry-pick: this migration
was originally chained onto `d4e5clmemail` (#3824 claim-account's
pending_email column) on staging. #3824 is staging-only (Hans-pending,
not shipped to main) and is deliberately excluded from this prod hotfix
batch, so `d4e5clmemail` does not exist on main's migration chain.
`down_revision` is retargeted to `c3d4pwteach1m` (main's actual head at
cherry-pick time) -- this column has no functional dependency on
pending_email; the chain link was purely sequential ordering on staging.

Why this migration exists: Claude Security finding find_016vZk1d3wRKkhjQMTUbGU6Y
(low, CWE-613) -- an attacker holding a stolen bearer token keeps full
access for up to 8 hours after the victim changes their password or a
teacher resets it, because get_current_user only checks signature, expiry
and is_active, never comparing the token against the account's credential
history. This column lets it do that: change_password, apply_password_reset
and the teacher-reset path all set it to now() whenever they touch
password_hash; get_current_user then rejects (401) any token whose `iat`
predates it.

Idempotent DDL: checks information_schema.columns before ADD COLUMN --
safe to re-run on a shared preview/staging DB (sqlalchemy-model-safety
skill Rule 6). No FK, no index (never queried by this column's value --
only ever compared against the single row it's already been fetched for),
no backfill (NULL means "no password change recorded yet", which is
correctly treated as "accept any token" -- every token issued before this
migration keeps working exactly as before; only a password change AFTER
this migration starts invalidating that account's older tokens).

Adds:
  password_changed_at  TIMESTAMP WITH TIME ZONE NULL
"""
from typing import Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "e5f6tokeninv1"
down_revision: Union[str, None] = "c3d4pwteach1m"
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

    if not _column_exists(conn, "users", "password_changed_at"):
        op.add_column(
            "users",
            sa.Column("password_changed_at", sa.DateTime(timezone=True), nullable=True),
        )


def downgrade() -> None:
    conn = op.get_bind()
    if _column_exists(conn, "users", "password_changed_at"):
        op.drop_column("users", "password_changed_at")
