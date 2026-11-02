"""add status/accepted_at to classroom_teachers + backfill assistant->editor

Revision ID: co01te02viewer03
Revises: c3d4pwteach1
Create Date: 2026-11-02 00:00:00.000000

Rechained 2026-11-03 onto c3d4pwteach1 (the password-teacher migration,
#3818/#3822): both this migration and c3d4pwteach1 originally forked off
b2c3d4moe02 independently and landed as sibling alembic heads once
c3d4pwteach1 merged to staging first -- re-pointing down_revision here
collapses them back to a single head (this migration's own content is
unchanged).

Issue #3820: co-teachers gain a "viewer" (read-only) role alongside the
existing full-access role (renamed assistant -> editor), plus an invitation
accept/reject lifecycle tracked by the new ``status`` column.

Backfill rationale: every pre-existing classroom_teachers row was created
under a model with no invitation step (invite = instantly active), so all of
them are semantically "accepted" already -- marking them pending would lock
real teachers out of classrooms they already use. ``accepted_at`` is backfilled
from ``invited_at`` for the same reason (best available approximation, not a
new fact being invented).
"""
from typing import Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "co01te02viewer03"
down_revision: Union[str, None] = "c3d4pwteach1"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "classroom_teachers",
        sa.Column(
            "status", sa.String(length=20), nullable=False, server_default="accepted"
        ),
    )
    op.add_column(
        "classroom_teachers",
        sa.Column("accepted_at", sa.DateTime(timezone=True), nullable=True),
    )

    conn = op.get_bind()
    # Pre-existing co-teachers were never run through an invitation flow --
    # they were active the instant they were created. Preserve that behavior
    # (role vocabulary rename only; nobody's access changes).
    conn.execute(sa.text("UPDATE classroom_teachers SET role = 'editor' WHERE role = 'assistant'"))
    # Every row is already accepted (server_default above); backfill the
    # approximate acceptance timestamp from invited_at for audit purposes.
    conn.execute(
        sa.text(
            "UPDATE classroom_teachers SET accepted_at = invited_at WHERE status = 'accepted'"
        )
    )


def downgrade() -> None:
    conn = op.get_bind()
    conn.execute(sa.text("UPDATE classroom_teachers SET role = 'assistant' WHERE role IN ('editor', 'viewer')"))
    op.drop_column("classroom_teachers", "accepted_at")
    op.drop_column("classroom_teachers", "status")
