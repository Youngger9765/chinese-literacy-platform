"""PK 對戰 (雙人 PK 模式) — Issue #3586. Student-initiated 1v1 quick battles,
distinct from `live_quiz` (teacher-hosted, whole-class) and `league` (season-long,
cross-class). See docs/prd/2026-10-16-pk-mode-prd.md.

Three tables (Young approved exactly these three, 2026-10-16 — no fourth table,
no `classrooms.pk_enabled` column yet; that teacher-toggle column is deferred
pending separate approval, see PRD §7.4 and the issue thread):

- PkQueue   — one student's matchmaking/invite slot. An invite is just a queue
  row with `invite_code` set; redeeming it matches directly (PRD §9.1) instead
  of going through the generic `FOR UPDATE SKIP LOCKED` scan (services/pk/
  matchmaking.py `attempt_match` deliberately excludes invite rows from that
  scan — an invite is "wait for THIS specific friend", not "match me with
  anyone of the same scope").
- PkMatch   — one 1v1 battle (real opponent or AI tier). `rounds_snapshot` is
  a frozen JSON list built once at match creation (same "frozen snapshot"
  spirit as `live_quiz_games.rounds_snapshot` / `league_seasons.weights_snapshot`
  — a later curriculum edit must never change an in-flight or finished match).
  `side_a_answers`/`side_b_answers` are JSONB arrays rather than a fourth
  answers table — PRD §7.2 explicitly documents this as a scoped-down
  technical debt (Young capped new tables at 3), not an oversight: each entry
  is `{round_index, choice_key, is_correct, points, elapsed_ms}`.
  `current_round_index`/`current_round_started_at`/`reveal_started_at`/
  `version` are NOT in the PRD's draft column list (PRD §7 is explicitly "a
  draft for implementation reference, this PRD does not write code") — they
  are the server-authoritative state-machine fields the lazy, no-cron
  round-advance needs (PRD §9.2's "輪詢時順便檢查" principle, mirrored from
  `live_quiz.engine._maybe_expire`), same precedent as `LiveQuizGame` having
  implementation columns (`host_device_id`, `cached_leaderboard`,
  `ended_reason`) beyond its own PRD's bullet list.
- PkRating  — one global Elo-style rating per student (not shown to the
  student — PRD §5.2 "積分對學生永遠是隱藏的數字"), floored at 800 (§7.3).

Independence (same four rules `live_quiz`/`league` already established,
PRD §6): (1) PK reads `live_quiz`'s question-source adapters and
`round_types/choice.py` one-way — neither of those packages imports PK, so
deleting `services/pk/` leaves `live_quiz`/`league` working unchanged.
(2) Its own three tables, its own `/api/pk/*` routes — no write here ever
touches `live_quiz_*`/`league_*` tables. (3) `rounds_snapshot` is frozen at
creation. (4) `league` does not read any PK table (PRD §8.3 — PK's scoring
is "臨場反應快", exactly what `league` was designed to NOT reward).
"""
from datetime import datetime

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    String,
    UniqueConstraint,
    func,
    text,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .base import Base

PK_QUEUE_STATUSES = ("waiting", "matched", "expired", "cancelled")
PK_MATCH_STATUSES = ("active", "completed", "abandoned")
PK_SCOPE_TYPES = ("lesson", "grade_pool")

ROUNDS_PER_MATCH = 5
ANSWER_SECONDS = 20
# PRD §4: "題目間 reveal 停留 2–3 秒" — picks the middle of that range.
REVEAL_SECONDS = 2.5
# PRD §7.1: "invite_expires_at = created_at + 5 分鐘".
INVITE_LIFETIME_MINUTES = 5
# PRD §9.1 band-widths and the 10s "suggest AI" threshold (§9.2).
BAND_WIDTH_TIGHT = 150
BAND_WIDTH_WIDEN_AFTER_SECONDS = 5
SUGGEST_AI_AFTER_SECONDS = 10
# PRD §7.3: "積分下限 800".
RATING_FLOOR = 800
RATING_DEFAULT = 1000
RATING_K = 24


class PkQueue(Base):
    __tablename__ = "pk_queue"
    __table_args__ = (
        # PRD §7.1 main lookup path: "找同班、選了相同範圍、正在等待的其他學生".
        Index("ix_pk_queue_matching", "status", "scope_type", "scope_ref", "classroom_id"),
        # PRD §7.1: "invite_code 局部唯一索引只在 waiting 狀態生效" — once
        # matched/cancelled/expired, the same 6-char code can be reused
        # (same precedent as live_quiz_games.code being unique only among
        # active games).
        Index(
            "ix_pk_queue_invite_code_waiting",
            "invite_code",
            unique=True,
            postgresql_where=text("status = 'waiting' AND invite_code IS NOT NULL"),
        ),
        CheckConstraint("scope_type IN ('lesson','grade_pool')", name="ck_pk_queue_scope_type"),
        CheckConstraint(
            "status IN ('waiting','matched','expired','cancelled')", name="ck_pk_queue_status"
        ),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    student_id: Mapped[int] = mapped_column(ForeignKey("users.id"), nullable=False, index=True)
    classroom_id: Mapped[int | None] = mapped_column(
        ForeignKey("classrooms.id", ondelete="SET NULL"), nullable=True, index=True
    )
    scope_type: Mapped[str] = mapped_column(String(20), nullable=False)
    scope_ref: Mapped[str] = mapped_column(String(50), nullable=False)
    # Set only on the invite-creator's own row (PRD §9.1 "邀請碼路徑" — the
    # redeemer never gets their own queue row; they match directly into the
    # creator's row via services/pk/matchmaking.py redeem_invite()).
    invite_code: Mapped[str | None] = mapped_column(String(6), nullable=True)
    invite_expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="waiting", index=True)
    match_id: Mapped[int | None] = mapped_column(
        ForeignKey("pk_matches.id", ondelete="SET NULL"), nullable=True
    )
    # Bumped on every status transition — lets a poller's `after_version`
    # short-circuit to a light "unchanged" response (PRD §12's "版本沒變就
    #不查 DB" principle, scaled down: PK's queue poll has no N+1 relationship
    # load to avoid, so this only saves response-building work, not a DB
    # round trip — see services/pk/matchmaking.py poll_queue docstring for
    # why the full `_FastPollCache` machinery was deliberately NOT ported).
    version: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )

    student: Mapped["User"] = relationship("User", foreign_keys=[student_id])  # type: ignore[name-defined]
    classroom: Mapped["Classroom | None"] = relationship("Classroom", foreign_keys=[classroom_id])  # type: ignore[name-defined]
    match: Mapped["PkMatch | None"] = relationship("PkMatch", foreign_keys=[match_id])


class PkMatch(Base):
    __tablename__ = "pk_matches"
    __table_args__ = (
        CheckConstraint(
            "(side_b_user_id IS NULL) != (side_b_bot_tier IS NULL)",
            name="ck_pk_matches_side_b_exclusive",
        ),
        CheckConstraint(
            "side_b_bot_tier IS NULL OR (side_b_bot_tier >= 1 AND side_b_bot_tier <= 7)",
            name="ck_pk_matches_bot_tier_range",
        ),
        CheckConstraint("scope_type IN ('lesson','grade_pool')", name="ck_pk_matches_scope_type"),
        CheckConstraint(
            "status IN ('active','completed','abandoned')", name="ck_pk_matches_status"
        ),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    side_a_user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), nullable=False, index=True)
    side_b_user_id: Mapped[int | None] = mapped_column(
        ForeignKey("users.id"), nullable=True, index=True
    )
    # PRD §7.2: "跟真人對戰時為 null；兩個 nullable 互斥" — enforced by the
    # CheckConstraint above, not just a comment.
    side_b_bot_tier: Mapped[int | None] = mapped_column(Integer, nullable=True)
    classroom_id: Mapped[int | None] = mapped_column(
        ForeignKey("classrooms.id", ondelete="SET NULL"), nullable=True, index=True
    )
    scope_type: Mapped[str] = mapped_column(String(20), nullable=False)
    scope_ref: Mapped[str] = mapped_column(String(50), nullable=False)
    rounds_snapshot: Mapped[list] = mapped_column(
        JSONB, nullable=False, server_default=text("'[]'::jsonb")
    )
    seed: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    current_round_index: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    current_round_started_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    # Set once a round is "due" (both sides answered, or the window elapsed)
    # — the lazy advance only moves to the next round after
    # `REVEAL_SECONDS` past this timestamp. Cleared when the next round opens.
    reveal_started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    side_a_answers: Mapped[list] = mapped_column(JSONB, nullable=False, server_default=text("'[]'::jsonb"))
    side_b_answers: Mapped[list] = mapped_column(JSONB, nullable=False, server_default=text("'[]'::jsonb"))
    side_a_score: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    side_b_score: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    winner_user_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    side_a_rating_before: Mapped[int | None] = mapped_column(Integer, nullable=True)
    side_a_rating_after: Mapped[int | None] = mapped_column(Integer, nullable=True)
    side_b_rating_before: Mapped[int | None] = mapped_column(Integer, nullable=True)
    side_b_rating_after: Mapped[int | None] = mapped_column(Integer, nullable=True)
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="active", index=True)
    version: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    started_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    side_a_user: Mapped["User"] = relationship("User", foreign_keys=[side_a_user_id])  # type: ignore[name-defined]
    side_b_user: Mapped["User | None"] = relationship("User", foreign_keys=[side_b_user_id])  # type: ignore[name-defined]
    winner: Mapped["User | None"] = relationship("User", foreign_keys=[winner_user_id])  # type: ignore[name-defined]
    classroom: Mapped["Classroom | None"] = relationship("Classroom", foreign_keys=[classroom_id])  # type: ignore[name-defined]


class PkRating(Base):
    """PRD §7.3: one global rating per student — "MVP 只有一個全域積分"."""

    __tablename__ = "pk_ratings"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    student_id: Mapped[int] = mapped_column(
        ForeignKey("users.id"), nullable=False, unique=True, index=True
    )
    rating: Mapped[int] = mapped_column(Integer, nullable=False, default=RATING_DEFAULT)
    matches_played: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    wins: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    losses: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    draws: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )

    student: Mapped["User"] = relationship("User", foreign_keys=[student_id])  # type: ignore[name-defined]
