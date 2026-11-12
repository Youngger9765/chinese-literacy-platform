"""create escape_room_runs table

《迷城密室》(escape_room) v1 MVP — see docs/prd/2026-10-16-escape-room-prd.md
§9.1. Young approved this exact single-table schema (issue #3599 thread,
2026-10-17: "可以建表") after live_quiz/#3551, league+story_pack/#3554+#3594,
pk/#3586+#3602+#3609+#3610, and the classroom feature-toggle/#3607 all
shipped to staging — this is the only new table this PR adds.

Independence (PRD §7): no FK to pk_*/league_*/live_quiz_* tables — only a
FK to `users.id` (same ownership pattern every other game mode uses) and a
plain string `story_pack_key` (not an FK to `story_packs.key` — unlike
`league_seasons.story_pack_key`, a run's pack reference is allowed to point
at nothing/a since-deleted custom pack without failing the whole run; the
story_adapter's fallback path, not a DB constraint, is what makes that safe,
per PRD §8.2).

Idempotent (Rule 6, sqlalchemy-model-safety skill): preview/staging DBs can
see this migration applied more than once across parallel branch deploys —
`create_table` is guarded by `insp.has_table()` the same way
7e0ca622e3d8_create_story_packs_table.py guards its own table.

Revision ID: 2756eda93b27
Revises: 7e0ca622e3d8
Create Date: 2026-10-17 00:00:00.000000
"""
from typing import Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = "2756eda93b27"
down_revision: Union[str, None] = "7e0ca622e3d8"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    insp = sa.inspect(bind)

    if not insp.has_table("escape_room_runs"):
        op.create_table(
            "escape_room_runs",
            sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
            sa.Column("student_id", sa.Integer(), nullable=False),
            sa.Column("scope_type", sa.String(20), nullable=False),
            sa.Column("scope_ref", sa.String(50), nullable=False),
            sa.Column("story_pack_key", sa.String(48), nullable=True),
            sa.Column("chapter_key", sa.String(48), nullable=True, server_default="default"),
            sa.Column("chambers_snapshot", postgresql.JSONB(), nullable=False),
            sa.Column("gate_snapshot", postgresql.JSONB(), nullable=False),
            sa.Column("mist_distance", sa.Integer(), nullable=False, server_default="50"),
            sa.Column("teammates_state", postgresql.JSONB(), nullable=False),
            sa.Column("abilities_used", postgresql.JSONB(), nullable=False),
            sa.Column("result", sa.String(20), nullable=False, server_default="in_progress"),
            sa.Column(
                "started_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
            ),
            sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
            sa.ForeignKeyConstraint(["student_id"], ["users.id"]),
            sa.PrimaryKeyConstraint("id"),
            sa.CheckConstraint(
                "scope_type IN ('lesson','grade_pool')", name="ck_escape_room_scope_type"
            ),
            sa.CheckConstraint(
                "result IN ('in_progress','escaped','not_this_time','abandoned')",
                name="ck_escape_room_result",
            ),
        )
        # Rule 1 (sqlalchemy-model-safety): every FK needs an index — this is
        # the lookup path for a student's own run history / skin-unlock query
        # (PRD §6: `SELECT DISTINCT story_pack_key, chapter_key ... WHERE
        # student_id = :id AND result = 'escaped'`).
        op.create_index("ix_escape_room_runs_student_id", "escape_room_runs", ["student_id"])


def downgrade() -> None:
    bind = op.get_bind()
    insp = sa.inspect(bind)

    if insp.has_table("escape_room_runs"):
        op.drop_table("escape_room_runs")
