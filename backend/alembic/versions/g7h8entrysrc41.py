"""add learning_sessions.entry_source (AI 派發 marker)

Issue #4161: the learning history could only tell "self practice" from "teacher
assignment" (derived at read time, no column), so a lesson started from an AI 派發
card looked exactly like one the student picked on their own. Young approved adding
the column 2026-11-27.

`entry_source` is nullable with no default and no backfill: NULL means "not started
from an AI 派發 card", which is true of every row that exists today. The value is
written once at creation and never updated. It is a new column rather than a third
`session_mode` value because `session_mode` already drives assignment-vs-self logic
and a new value there would change what existing filters match.

Idempotent (Rule 6, sqlalchemy-model-safety): guarded by an inspector check so a
preview/staging DB that sees this twice does not fail.

Revision ID: g7h8entrysrc41
Revises: f6g7actvpack1
Create Date: 2026-11-27 00:00:00.000000
"""
from typing import Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "g7h8entrysrc41"
down_revision: Union[str, None] = "f6g7actvpack1"
branch_labels = None
depends_on = None


def upgrade() -> None:
    insp = sa.inspect(op.get_bind())
    columns = {c["name"] for c in insp.get_columns("learning_sessions")}
    if "entry_source" not in columns:
        op.add_column(
            "learning_sessions",
            sa.Column("entry_source", sa.String(length=20), nullable=True),
        )


def downgrade() -> None:
    insp = sa.inspect(op.get_bind())
    columns = {c["name"] for c in insp.get_columns("learning_sessions")}
    if "entry_source" in columns:
        op.drop_column("learning_sessions", "entry_source")
