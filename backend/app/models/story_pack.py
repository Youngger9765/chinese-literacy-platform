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
"""
from datetime import datetime

from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, String, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from .base import Base


class StoryPackRow(Base):
    __tablename__ = "story_packs"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    key: Mapped[str] = mapped_column(String(48), unique=True, nullable=False, index=True)
    # Full validated StoryPack payload (schemas/story_pack.py model_dump()).
    # Validation happens at the service layer BEFORE a row is ever written —
    # never re-validated on read here (see story_pack_service.upsert_custom_pack).
    content: Mapped[dict] = mapped_column(JSONB, nullable=False)
    is_builtin: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    created_by: Mapped[int | None] = mapped_column(
        ForeignKey("users.id"), nullable=True, index=True
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )
