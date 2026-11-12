"""多人對抗賽 (team_arena) — issue #3632, PRD docs/prd/2026-10-18-team-arena-prd.md
§0 "⭐ v2 改版".

✅ 2026-10-19: Young approved building these tables for real ("可以建表").
✅ 2026-10-20: Young approved the v2 rewrite's ONE schema change ("改表") —
`classroom_id` is now nullable (a v2 room belongs to no classroom at all;
rule B: 拿掉班級開關). See
`alembic/versions/59f448723e7f_create_team_arena_tables.py` (v1's CREATE)
and the newer migration that ALTERs `classroom_id` to nullable (v2).

Three tables, same shapes v1 shipped to staging — v2 reinterprets two
columns' MEANING rather than their type (PRD §0 v2 table "資料表變更",
explicitly scoped to avoid a second migration):

- TeamArenaSession  — one ROOM (not a teacher-hosted activity anymore).
  `classroom_id` is always NULL for a v2 room. `teacher_id` now stores the
  room HOST's user id (any student — the column still points at `users`,
  so no type change is needed; "teacher" is legacy naming, not a role
  claim). `settings` holds `team_size`/`turns_per_player`/`answer_seconds`/
  `scope_ref` (the host's own grade) /`story_pack_key`/`total_turns` once
  play starts.
- TeamArenaMember   — one student's seat (which side, locked
  `rotation_order` = join sequence within that side). `lane` is UNUSED in
  v2 (PRD §0: "保留欄位、寫入固定值，避免多一次 migration") — every row
  always writes the fixed value `"support"` (one of the five values the
  existing CHECK constraint already allows, chosen because it is the
  closest-to-meaningless label among the five). `grade_pool_override` is
  likewise unused (always False — v2 has no per-student difficulty
  override UI). `question_queue` now holds BOTH this member's own
  pre-drawn, TYPE-MIXED question queue AND their per-weapon usage quota
  (`{"queue": [...], "weapons_used": {"call_teammate": bool, "eliminate":
  bool, "hint": bool}}`) — PRD §0: "武器使用次數存在既有的 JSON 欄位，不加
  欄位".
- TeamArenaAnswer   — one submission. `role="active"` is the seated
  player's real, scored answer (unique per (session, member, turn) so a
  second submission in the same turn is rejected at the DB level).
  `role="assist"` is repurposed in v2 as a teammate's 呼叫隊友 SUGGESTION
  (never scored, never counted as "answering for them" — PRD §0 rule E:
  "不是當棒的隊友...只能回應隊友的『呼叫隊友』，不能代答") — the same
  unique constraint now means "one suggestion per teammate per turn"
  rather than "one assist answer per turn".

Independence (same four rules `live_quiz`/`pk`/`escape_room`/`league`
already established, PRD §7 table "依賴方向"): this module imports nothing
from those packages' models, and nothing in those packages imports this
one. Deleting `team_arena_*` tables would not break any other mode.
"""
from __future__ import annotations

from datetime import datetime

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    SmallInteger,
    String,
    UniqueConstraint,
    func,
    text,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .base import Base

TEAM_ARENA_SESSION_STATUSES = ("lobby", "playing", "paused", "ended")
# v1 leftover — kept ONLY because the DB CHECK constraint on `lane` (built
# by v1's migration, not reissued by v2's) already enforces one of these
# five values, and v2 was explicitly scoped to ONE schema change
# (classroom_id nullable). v2 never reads or assigns meaning to `lane` —
# every row's `lane` is always written as the fixed filler value
# `"support"` (services/team_arena/engine.py `_FIXED_LANE`), chosen because
# it is the one value among these five that never claimed to be a real
# question-type lane in the first place.
TEAM_ARENA_LANES = ("zhuyin", "vocab_definitions", "vocab_application", "comprehension", "support")
# "active"  — the seated player's real, scored answer for a turn.
# "assist"  — v2 repurposes this as a teammate's 呼叫隊友 SUGGESTION (never
#             scored, never an answer on the active player's behalf — PRD
#             §0 v2 rule E). v1 used "assist" for a scored bonus-answer
#             concept that v2 removes entirely.
TEAM_ARENA_ANSWER_ROLES = ("active", "assist")


class TeamArenaSession(Base):
    __tablename__ = "team_arena_sessions"
    __table_args__ = (
        CheckConstraint(
            "status IN (" + ",".join(f"'{s}'" for s in TEAM_ARENA_SESSION_STATUSES) + ")",
            name="ck_team_arena_sessions_status",
        ),
        # PRD §9.1: "索引：(code, status)，code 只在進行中的 session 之間唯一
        # （同 live_quiz）" — deliberately NOT a unique index; uniqueness
        # among active sessions is enforced at the service layer with a
        # generate-and-retry loop, exactly like
        # `services/live_quiz/codes.py` does for `live_quiz_games.code`
        # (see `models/live_quiz.py`'s own `ix_live_quiz_games_code_status`
        # for the precedent this mirrors).
        Index("ix_team_arena_sessions_code_status", "code", "status"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    # v2 (PRD §0 "資料表變更"): nullable now — a v2 room belongs to no
    # classroom at all. Always NULL for every v2-created row; kept
    # nullable (not dropped) only because a second migration to drop it
    # entirely was explicitly out of scope for this approval.
    classroom_id: Mapped[int | None] = mapped_column(ForeignKey("classrooms.id"), nullable=True, index=True)
    # v2: stores the room HOST's user id (any student, not a teacher).
    teacher_id: Mapped[int] = mapped_column(ForeignKey("users.id"), nullable=False, index=True)
    code: Mapped[str] = mapped_column(String(6), nullable=False, index=True)
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="lobby", index=True)
    # scope_type/scope_ref, turns_per_player, answer_seconds, reading_speed,
    # story_pack_key — PRD §9.1 "settings JSONB".
    settings: Mapped[dict] = mapped_column(JSONB, nullable=False, server_default=text("'{}'::jsonb"))
    turn_no: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    turn_started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    # Bumped on every state change — lets a poller's `after_version` short-
    # circuit (same "版本沒變就不查 DB" principle as PkQueue.version /
    # LiveQuizGame's polling cache).
    state_version: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    # Per-match-per-team towers/base/score cache — PRD §9.1: "各場各隊的塔／
    # 主堡／分數（答題寫入時同一交易更新，輪詢直接讀）". The authoritative
    # history is still TeamArenaAnswer; this is a read-optimization cache
    # recomputable from that history, same spirit as
    # `live_quiz_games.cached_leaderboard`.
    scoreboard: Mapped[dict] = mapped_column(JSONB, nullable=False, server_default=text("'{}'::jsonb"))
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    ended_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    classroom: Mapped["Classroom | None"] = relationship("Classroom", foreign_keys=[classroom_id])  # type: ignore[name-defined]
    teacher: Mapped["User"] = relationship("User", foreign_keys=[teacher_id])  # type: ignore[name-defined]


class TeamArenaMember(Base):
    """One student's seat within one session — PRD §9.1."""

    __tablename__ = "team_arena_members"
    __table_args__ = (
        # PRD §9.1: "唯一：(session_id, student_id)" — a student occupies
        # exactly one seat (one match, one side, one lane) per session.
        UniqueConstraint(
            "session_id", "student_id", name="uq_team_arena_members_session_student"
        ),
        CheckConstraint(
            "lane IN (" + ",".join(f"'{s}'" for s in TEAM_ARENA_LANES) + ")",
            name="ck_team_arena_members_lane",
        ),
        CheckConstraint("side IN (0, 1)", name="ck_team_arena_members_side"),
        Index("ix_team_arena_members_session_match", "session_id", "match_no"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    session_id: Mapped[int] = mapped_column(
        ForeignKey("team_arena_sessions.id"), nullable=False, index=True
    )
    student_id: Mapped[int] = mapped_column(ForeignKey("users.id"), nullable=False, index=True)
    # v2: always 0 — one room is exactly one match, no multi-match fan-out
    # (v1 let one teacher-hosted session contain several concurrent
    # matches; v2 rooms are 1 room = 1 host = 1 match).
    match_no: Mapped[int] = mapped_column(SmallInteger, nullable=False)
    side: Mapped[int] = mapped_column(SmallInteger, nullable=False)
    # v2: UNUSED (always the fixed value "support" — see module docstring
    # and the TEAM_ARENA_LANES comment above). Kept non-null/constrained
    # only because its CHECK constraint predates this rewrite.
    lane: Mapped[str] = mapped_column(String(20), nullable=False)
    # Locked at join time = join ORDER within this side (0, 1, 2, ... —
    # the first student to pick a side is rotation_order 0 on that side).
    # This IS the turn rotation: turn N's active player on a side is
    # whoever has rotation_order == N % team_size.
    rotation_order: Mapped[int] = mapped_column(SmallInteger, nullable=False)
    # v2: UNUSED (always False — no per-student difficulty override UI in
    # v2). Kept because dropping it would be a second schema change.
    grade_pool_override: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    # v2 (PRD §0 "資料表變更": "武器使用次數存在既有的 JSON 欄位，不加欄位")
    # — this ONE column now carries two things for this member's whole
    # match: `{"queue": [<frozen round entry>, ...turns_per_player of
    # them>], "weapons_used": {"call_teammate": bool, "eliminate": bool,
    # "hint": bool}}`. Each entry in `queue` is the same frozen
    # `{round_index, round_type, payload}` shape
    # `live_quiz_choice.generate_rounds` already produces — this member's
    # questions may be ANY of the four source modules mixed together (PRD
    # §0 rule D: "每一題可能是任何題型...混出"), never grouped by a single
    # lane the way v1's per-lane pools were.
    question_queue: Mapped[dict] = mapped_column(
        JSONB, nullable=False, server_default=text("'{}'::jsonb")
    )
    # PRD §3.3: "上場者斷線（超過 15 秒沒輪詢）：該回合直接記為『沒推進』並
    # 換下一位". ⚠️ Modeled but NOT YET WRITTEN anywhere (critic review,
    # slice 2): the engine's turn clock is purely time-based (every turn
    # ends on `answer_seconds` elapsing regardless of who polled), which
    # already satisfies "沒推進" for a silent/disconnected active player
    # without needing a separate presence signal — `answer_seconds` is
    # always >= the PRD's 15s disconnect threshold, so the dedicated
    # per-member staleness check this column implies is redundant for v1.
    # Left in the model (not removed) so a future "show a disconnect icon"
    # UI feature has a place to write without a schema change.
    last_seen_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    session: Mapped["TeamArenaSession"] = relationship("TeamArenaSession", foreign_keys=[session_id])
    student: Mapped["User"] = relationship("User", foreign_keys=[student_id])  # type: ignore[name-defined]


class TeamArenaAnswer(Base):
    """One submission (active turn or assist) — PRD §9.1."""

    __tablename__ = "team_arena_answers"
    __table_args__ = (
        # PRD §9.1: "唯一：(session_id, member_id, turn_no) — 每回合只收
        # 第一次" — this IS the §13 AC4 "同回合第二次作答回 409" enforcement
        # at the DB layer; the route (slice 2) catches the IntegrityError
        # and turns it into a 409, it does not re-implement the uniqueness
        # check itself.
        UniqueConstraint(
            "session_id", "member_id", "turn_no", name="uq_team_arena_answers_session_member_turn"
        ),
        CheckConstraint(
            "role IN (" + ",".join(f"'{s}'" for s in TEAM_ARENA_ANSWER_ROLES) + ")",
            name="ck_team_arena_answers_role",
        ),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    session_id: Mapped[int] = mapped_column(
        ForeignKey("team_arena_sessions.id"), nullable=False, index=True
    )
    member_id: Mapped[int] = mapped_column(
        ForeignKey("team_arena_members.id"), nullable=False, index=True
    )
    turn_no: Mapped[int] = mapped_column(Integer, nullable=False)
    role: Mapped[str] = mapped_column(String(10), nullable=False)
    choice: Mapped[str | None] = mapped_column(String(1), nullable=True)
    correct: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    elapsed_ms: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    speed_bonus: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    session: Mapped["TeamArenaSession"] = relationship("TeamArenaSession", foreign_keys=[session_id])
    member: Mapped["TeamArenaMember"] = relationship("TeamArenaMember", foreign_keys=[member_id])
