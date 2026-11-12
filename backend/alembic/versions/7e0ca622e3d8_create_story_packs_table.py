"""create story_packs table + league_seasons.story_pack_key FK

See docs/prd/2026-10-14-chinese-star-league-prd.md §13.4/§14 and PR #3598's
description — Young approved this exact schema (issue #3594 comment,
2026-10-16: "同意建主題表"), generalized the same day from a league-only
`league_themes` name to the mode-agnostic `story_packs` per Young's
direction ("same shape Young approved, just generic").

Revision ID: 7e0ca622e3d8
Revises: 8101b84f0160
Create Date: 2026-10-16 00:00:00.000000

Idempotent (Rule 6, sqlalchemy-model-safety skill): preview/staging DBs can
see this migration applied more than once across parallel branch deploys, so
every DDL step checks current state via `inspect()` before acting, and the
builtin-pack seed uses INSERT ... ON CONFLICT DO NOTHING keyed on the
`key` unique constraint rather than an unconditional INSERT.

Why builtin packs get DB rows too (not just custom ones): `league_seasons.
story_pack_key` is a real FK to `story_packs.key`. A season's
story_pack_key can legitimately be a builtin key (e.g. "myth") — without a
row for it here, assigning a builtin pack to a season would violate the FK.
The five rows below exist ONLY to satisfy that constraint; they are NOT the
read path for builtin pack content (that stays `app/services/
story_pack_defaults.py` — see `resolve_pack()` in `story_pack_store.py`,
which short-circuits a builtin key to the in-code dict before ever querying
this table). This migration therefore does not need to reproduce the full
production copy/SVG art here — a frozen, independently-valid StoryPack-
shaped snapshot is enough, and keeps this migration file decoupled from
application code (no `from app...` imports — see the rest of this
directory; migrations are frozen snapshots, not coupled to code that can
change after the fact).
"""
from typing import Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = "7e0ca622e3d8"
down_revision: Union[str, None] = "8101b84f0160"
branch_labels = None
depends_on = None


def _builtin_pack_json(key: str, era: str, title: str, energy_label: str) -> str:
    """A minimal, independently-schema-valid StoryPack payload — see module
    docstring for why this does not need to match the production content."""
    import json

    return json.dumps(
        {
            "schema_version": 1,
            "key": key,
            "era": era,
            "title": title,
            "intro": [f"{title}，兩班讀家展開較量。"],
            "faction_labels": ["甲隊", "乙隊"],
            "energy_bar_label": energy_label,
            "milestones": [{"ratio": 1.0, "message": "進度全滿"}],
            "background_art": None,
            "chest": {
                "name": "寶箱",
                "description": "全班過半同學都上路了，寶箱就在等著開啟",
                "art": {"kind": "emoji", "value": "🎁"},
            },
            "badges": [
                {
                    "key": "individual_badge",
                    "name": "個人勳章",
                    "description": "個人達標",
                    "art": {"kind": "emoji", "value": "🎖️"},
                },
                {
                    "key": "class_badge",
                    "name": "班級勳章",
                    "description": "全班平均達標",
                    "art": {"kind": "emoji", "value": "🏅"},
                },
            ],
            "result_copy": {"win": "勝利", "lose": "再接再厲", "draw": "平手"},
        },
        ensure_ascii=False,
    )


BUILTIN_SEED_ROWS = [
    ("myth", "上古", "上古神話歷險記", "書頁亮度"),
    ("tang-dynasty", "唐", "大唐風雲賽", "軍糧"),
    ("song-dynasty", "宋", "汴京風華賽", "墨量"),
    ("wuxia", "武林", "武林修練記", "內力"),
    ("detective", "校園", "少年偵探社事件簿", "線索"),
]


def upgrade() -> None:
    bind = op.get_bind()
    insp = sa.inspect(bind)

    if not insp.has_table("story_packs"):
        op.create_table(
            "story_packs",
            sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
            sa.Column("key", sa.String(48), nullable=False),
            sa.Column("content", postgresql.JSONB(), nullable=False),
            sa.Column("is_builtin", sa.Boolean(), nullable=False, server_default=sa.false()),
            sa.Column("created_by", sa.Integer(), nullable=True),
            sa.Column(
                "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
            ),
            sa.Column(
                "updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
            ),
            sa.ForeignKeyConstraint(["created_by"], ["users.id"]),
            sa.PrimaryKeyConstraint("id"),
            sa.UniqueConstraint("key", name="uq_story_packs_key"),
        )
        op.create_index("ix_story_packs_key", "story_packs", ["key"])
        op.create_index("ix_story_packs_created_by", "story_packs", ["created_by"])

    # Re-inspect — the table above may have just been created in this same run.
    insp = sa.inspect(bind)
    season_columns = {c["name"] for c in insp.get_columns("league_seasons")}
    if "story_pack_key" not in season_columns:
        op.add_column("league_seasons", sa.Column("story_pack_key", sa.String(48), nullable=True))
        op.create_index("ix_league_seasons_story_pack_key", "league_seasons", ["story_pack_key"])
        op.create_foreign_key(
            "fk_league_seasons_story_pack_key_story_packs",
            "league_seasons",
            "story_packs",
            ["story_pack_key"],
            ["key"],
        )

    # Seed the five builtin rows — idempotent via ON CONFLICT DO NOTHING on
    # the `key` unique constraint (safe to re-run; a second deploy that
    # races this migration on a shared preview DB will not error or
    # duplicate rows).
    story_packs = sa.table(
        "story_packs",
        sa.column("key", sa.String),
        sa.column("content", sa.JSON),
        sa.column("is_builtin", sa.Boolean),
    )
    for key, era, title, energy_label in BUILTIN_SEED_ROWS:
        content = _builtin_pack_json(key, era, title, energy_label)
        if bind.dialect.name == "postgresql":
            op.execute(
                sa.text(
                    "INSERT INTO story_packs (key, content, is_builtin) "
                    "VALUES (:key, CAST(:content AS JSONB), TRUE) "
                    "ON CONFLICT (key) DO NOTHING"
                ).bindparams(key=key, content=content)
            )
        else:
            # Non-Postgres (e.g. a local sqlite smoke run) — no ON CONFLICT
            # support without specifying the constraint target the same way;
            # check-then-insert is equivalent here since this path never runs
            # against a shared/concurrent DB.
            existing = bind.execute(
                sa.text("SELECT 1 FROM story_packs WHERE key = :key").bindparams(key=key)
            ).first()
            if existing is None:
                bind.execute(
                    story_packs.insert().values(key=key, content=content, is_builtin=True)
                )


def downgrade() -> None:
    bind = op.get_bind()
    insp = sa.inspect(bind)

    season_columns = {c["name"] for c in insp.get_columns("league_seasons")}
    if "story_pack_key" in season_columns:
        op.drop_constraint("fk_league_seasons_story_pack_key_story_packs", "league_seasons", type_="foreignkey")
        op.drop_index("ix_league_seasons_story_pack_key", table_name="league_seasons")
        op.drop_column("league_seasons", "story_pack_key")

    if insp.has_table("story_packs"):
        op.drop_table("story_packs")
