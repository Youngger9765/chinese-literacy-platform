"""team_arena v2: classroom_id nullable

See docs/prd/2026-10-18-team-arena-prd.md §0 "⭐ v2 改版" — Young approved
this ONE schema change on 2026-10-20 ("改表"): a v2 room belongs to no
classroom at all (rule B, 拿掉班級開關), so
`team_arena_sessions.classroom_id` can no longer be NOT NULL. No other
column changes ship in this migration — `teacher_id` keeps its existing
type (it already pointed at `users.id`; v2 just reinterprets it as "the
room host", not a type change) and `team_arena_members.lane` keeps its
existing CHECK constraint (v2 always writes the fixed value `"support"`,
one of the values that constraint already allows).

Revision ID: 988d8bc90428
Revises: 59f448723e7f
Create Date: 2026-10-20 00:00:00.000000

"""
from typing import Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "988d8bc90428"
down_revision: Union[str, None] = "59f448723e7f"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.alter_column(
        "team_arena_sessions",
        "classroom_id",
        existing_type=sa.Integer(),
        nullable=True,
    )


def downgrade() -> None:
    # Any v2 room (classroom_id IS NULL) would violate NOT NULL on
    # downgrade — same documented, deliberate tradeoff every other
    # nullable-tightening downgrade in this repo accepts (a downgrade is a
    # schema rollback path, not a data-migration path); an operator
    # downgrading past this revision with live v2 rooms in the table must
    # delete or backfill them first.
    op.alter_column(
        "team_arena_sessions",
        "classroom_id",
        existing_type=sa.Integer(),
        nullable=False,
    )
