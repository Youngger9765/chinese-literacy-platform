"""StoryPackRow — durable storage for `StoryPack` content (PRD §13.4,
generalized 2026-10-16 — was `league_themes`/`LeagueThemeRow`, renamed to a
mode-agnostic name per Young's direction so other game modes can bind to
the same table later without an "it says league but isn't" naming lie).

Young approved this migration 2026-10-16 (issue #3594 comment) — the exact
schema requested, just under the generic name:

    CREATE TABLE story_packs (
      id SERIAL PRIMARY KEY,
      key VARCHAR(48) UNIQUE NOT NULL,
      content JSONB NOT NULL,
      is_builtin BOOLEAN NOT NULL DEFAULT FALSE,
      created_by INTEGER REFERENCES users(id),
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

Both the shipped builtin packs (上古神話/唐/宋/武俠/偵探劇, `is_builtin=True`)
AND future system_admin-authored custom packs (`is_builtin=False`) live in
this one table. This is deliberate, not scope creep: `league_seasons.
story_pack_key` is a real FK to `story_packs.key`, and a season's
story_pack_key can legitimately be a builtin key — without a row for it
here, assigning a builtin pack to a season would violate the FK. The
migration seeds all five builtin rows (idempotent) for exactly this reason.

MVP scope (2026-10-16): this table is still only consumed by league
(`league_seasons.story_pack_key`). Other modes (PK, 迷城密室) binding to it
is explicitly deferred — Young's own correction cut "the adapter interface
for PK/迷城" from this PR. Nothing here blocks adding that later; this
table's shape doesn't need to change for it.

`is_active_default` — Young approved 2026-11-14 (issue #4052 follow-up,
alembic/versions/f6g7actvpack1_*.py): the platform-wide "which pack is the
default" pointer, which previously lived ONLY in a process-local module
dict (`story_pack_store._active_key_state`) and therefore disagreed across
Cloud Run replicas. A Postgres partial unique index
(`ix_story_packs_single_active_default`, WHERE is_active_default) enforces
at most one TRUE row at the DB level — see
`SqlAlchemyStoryPackStore.set_active_key` for how that invariant is upheld
on write (clear-then-set in one transaction).
"""
from datetime import datetime

from sqlalchemy import Boolean, DateTime, ForeignKey, Index, Integer, String, func, text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from .base import Base


class StoryPackRow(Base):
    __tablename__ = "story_packs"
    __table_args__ = (
        # Issue #4052: "at most one row can be the platform default" as a
        # DB-level constraint, not just application discipline in
        # SqlAlchemyStoryPackStore.set_active_key. `postgresql_where` is
        # what the real Postgres DB gets (migration f6g7actvpack1_*.py
        # creates the equivalent index via `op.create_index`, same
        # established pattern as a7b8c9d0e1f2_session_unique_inprogress.py
        # / b3c4d5e6f7g8_add_junyi_class_id_to_classrooms.py). `sqlite_where`
        # is ALSO needed here (unlike those two precedents) because this
        # table's tests include a negative control — "many FALSE rows is
        # fine" — which a non-partial unique index would wrongly reject;
        # without `sqlite_where`, `Base.metadata.create_all()` (what the
        # pytest suite actually builds schema from) would silently fall
        # back to a full unique index on SQLite, and that negative control
        # would fail for the wrong reason.
        Index(
            "ix_story_packs_single_active_default",
            "is_active_default",
            unique=True,
            postgresql_where=text("is_active_default"),
            sqlite_where=text("is_active_default"),
        ),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    key: Mapped[str] = mapped_column(String(48), unique=True, nullable=False, index=True)
    # Full validated StoryPack payload (schemas/story_pack.py model_dump()).
    # Validation happens at the service layer BEFORE a row is ever written —
    # never re-validated on read here (see story_pack_service.upsert_custom_pack).
    content: Mapped[dict] = mapped_column(JSONB, nullable=False)
    is_builtin: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    # Issue #4052: the platform-wide "active default" pointer — see class
    # docstring + __table_args__ above for the partial unique index that
    # enforces at most one TRUE row.
    is_active_default: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    created_by: Mapped[int | None] = mapped_column(
        ForeignKey("users.id"), nullable=True, index=True
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )
