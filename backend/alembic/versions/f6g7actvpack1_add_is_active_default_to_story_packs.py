"""add story_packs.is_active_default (platform-wide default pack pointer)

Issue #4052: "設為平台預設" (set as platform default) only ever lived in a
process-local module dict (`story_pack_store._active_key_state`). Cloud Run
can run multiple replicas (staging up to 8, prod up to 12) — each had its
own copy of that dict, so which pack a student saw depended on which
replica happened to answer their request (staging repro: 18/30 vs 12/30
queries disagreed). Young approved this exact schema 2026-11-14 (relayed
via the #4056 PR follow-up thread) after the STOP report in that PR found
no existing settings/config table to reuse.

`is_active_default` lives on `story_packs` itself (not a new table) because
the "active default" is inherently a property of exactly one row in this
table — the same table that already seeds/FK-anchors every builtin pack
(see 7e0ca622e3d8_create_story_packs_table.py). The partial unique index
below enforces "at most one TRUE row at a time" at the DB level, not just
via application discipline in SqlAlchemyStoryPackStore.set_active_key —
closing the race the in-memory dict had no equivalent for.

No backfill: there is no persisted value today (the old pointer was pure
process memory, gone on every restart/redeploy), so every row's
`is_active_default` stays its default FALSE after this migration — nobody
is currently relying on a specific "platform default" being preserved
across this change. `get_active_key()` will return None until an admin
explicitly calls "設為平台預設" again post-deploy, exactly like it did on a
fresh process boot under the old (buggy) in-memory implementation.

Idempotent (Rule 6, sqlalchemy-model-safety skill): preview/staging DBs can
see this migration applied more than once across parallel branch deploys —
`add_column` and the partial unique index are both guarded by an
`inspect()` check of current state before acting, matching the pattern
7e0ca622e3d8 already established for this same table.

Revision ID: f6g7actvpack1
Revises: d4e5clmemail
Create Date: 2026-11-14 00:00:00.000000
"""
from typing import Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "f6g7actvpack1"
down_revision: Union[str, None] = "d4e5clmemail"
branch_labels = None
depends_on = None

_INDEX_NAME = "ix_story_packs_single_active_default"


def upgrade() -> None:
    bind = op.get_bind()
    insp = sa.inspect(bind)

    columns = {c["name"] for c in insp.get_columns("story_packs")}
    if "is_active_default" not in columns:
        op.add_column(
            "story_packs",
            sa.Column("is_active_default", sa.Boolean(), nullable=False, server_default=sa.false()),
        )

    # Partial unique index — "at most one TRUE row at a time" is a DB-level
    # constraint, not just application discipline in
    # SqlAlchemyStoryPackStore.set_active_key. `op.create_index(...,
    # postgresql_where=...)` is this repo's established pattern for partial
    # unique indexes (see a7b8c9d0e1f2_session_unique_inprogress.py /
    # b3c4d5e6f7g8_add_junyi_class_id_to_classrooms.py) — matched here
    # rather than raw `op.execute` for consistency. The corresponding model
    # declaration (`app/models/story_pack.py` __table_args__) adds
    # `sqlite_where` too so `Base.metadata.create_all()` (used by the
    # pytest suite, not this migration) produces an equivalent partial
    # index on SQLite — this migration itself only targets Postgres.
    insp = sa.inspect(bind)  # re-inspect: add_column above may have just run
    existing_indexes = {ix["name"] for ix in insp.get_indexes("story_packs")}
    if _INDEX_NAME not in existing_indexes:
        op.create_index(
            _INDEX_NAME,
            "story_packs",
            ["is_active_default"],
            unique=True,
            postgresql_where=sa.text("is_active_default"),
        )


def downgrade() -> None:
    bind = op.get_bind()
    insp = sa.inspect(bind)
    existing_indexes = {ix["name"] for ix in insp.get_indexes("story_packs")}
    if _INDEX_NAME in existing_indexes:
        op.drop_index(_INDEX_NAME, table_name="story_packs")

    columns = {c["name"] for c in insp.get_columns("story_packs")}
    if "is_active_default" in columns:
        op.drop_column("story_packs", "is_active_default")
