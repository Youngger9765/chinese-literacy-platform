"""add classroom_students.seat_number, per-classroom unique (#3826)

Revision ID: d4e5seatnum1
Revises: c3d4pwteach1
Create Date: 2026-11-03 00:00:00.000000

Why this migration exists: teachers have no way to assign/edit a student's
seat number today. The "座號" column shown in the roster is just the array
index of the row (frontend-only, not persisted). Separately, a "seat number"
string IS collected when teachers batch-create student accounts, but it gets
baked permanently into the generated login username (classroom_batch.py /
classroom_csv.py: `{join_code}{seat_number}`) -- it's never stored as its
own editable field and is never surfaced back to the teacher. See
docs/prd/2026-11-03-rename-seat-prd.md for the full current-state writeup.

This adds a genuinely persisted, nullable seat_number on classroom_students
(the enrollment join row) -- scoped per classroom-enrollment, NOT per user,
so a student who is (briefly) enrolled in two classrooms, or who moves
classrooms via #3819, gets independent seat numbers per classroom rather
than one global number that would collide or carry over unexpectedly.

Idempotent DDL: checks information_schema.columns before ADD COLUMN and
guards the constraint add with a pg_constraint lookup -- safe to re-run on
a shared preview/staging DB (see sqlalchemy-model-safety skill Rule 6).

Adds:
  seat_number  INTEGER NULL
    NULL means "no seat assigned yet" -- the default for every pre-#3826
    row, and for every new enrollment created by #3819 move-classroom or
    re-joining after #3821 batch-remove. The frontend falls back to
    displaying the row's array index when this is NULL, so existing rosters
    look unchanged until a teacher explicitly sets a seat number.

  uq_classroom_students_seat  UNIQUE (classroom_id, seat_number)
    Standard SQL unique-constraint semantics: NULL is never considered
    equal to another NULL, so any number of not-yet-seated students can
    coexist in the same classroom. Only two students in the SAME classroom
    with the SAME non-null seat_number would violate this -- which the
    application layer already rejects with a 409 before it would ever
    reach the DB, but the DB constraint is the actual source of truth
    (belt-and-suspenders against a future code path that forgets to check).

No backfill needed: NULL is the correct, zero-data-loss default for every
existing row (see "frontend falls back" above) -- there is nothing to
reconstruct from historical data, since no column holding true seat numbers
ever existed before this migration.
"""
from typing import Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "d4e5seatnum1"
down_revision: Union[str, None] = "c3d4pwteach1"
branch_labels = None
depends_on = None

_CONSTRAINT_NAME = "uq_classroom_students_seat"


def _column_exists(conn, table: str, column: str) -> bool:
    result = conn.execute(
        sa.text(
            "SELECT column_name FROM information_schema.columns "
            "WHERE table_name = :table AND column_name = :column"
        ),
        {"table": table, "column": column},
    )
    return result.fetchone() is not None


def _constraint_exists(conn, constraint_name: str) -> bool:
    result = conn.execute(
        sa.text("SELECT 1 FROM pg_constraint WHERE conname = :name"),
        {"name": constraint_name},
    )
    return result.fetchone() is not None


def upgrade() -> None:
    conn = op.get_bind()

    if not _column_exists(conn, "classroom_students", "seat_number"):
        op.add_column(
            "classroom_students",
            sa.Column("seat_number", sa.Integer(), nullable=True),
        )

    if not _constraint_exists(conn, _CONSTRAINT_NAME):
        op.create_unique_constraint(
            _CONSTRAINT_NAME, "classroom_students", ["classroom_id", "seat_number"]
        )


def downgrade() -> None:
    conn = op.get_bind()
    if _constraint_exists(conn, _CONSTRAINT_NAME):
        op.drop_constraint(_CONSTRAINT_NAME, "classroom_students", type_="unique")
    if _column_exists(conn, "classroom_students", "seat_number"):
        op.drop_column("classroom_students", "seat_number")
