"""五人對抗賽 (team_arena) — issue #3632, PRD docs/prd/2026-10-18-team-arena-prd.md.

⛔ 2026-10-18: Young has NOT yet approved creating these tables for real
(PRD §9 states this explicitly: "本 PRD 不建 migration...實作前要另外取得
Young 明確同意"). This model file exists so slice 1's pure-function engine
has something to test against via `Base.metadata.create_all()` in SQLite
(same pattern every other test module in this repo already uses — see
`backend/tests/conftest.py`). NO alembic revision has been created for
this. Do not run `alembic revision --autogenerate` against this model
until that approval is recorded (see git history / issue #3632 for when
it lands).

Three tables, matching PRD §9.1 verbatim (column names/types/purpose are
the PRD's own draft, not invented here):

- TeamArenaSession  — one teacher-hosted activity (code, lobby/playing/
  paused/ended, settings, turn clock, scoreboard cache).
- TeamArenaMember   — one student's seat within one session (which match,
  which side, which lane, locked rotation_order, optional per-student
  grade_pool_override that lives ONLY on this row — PRD §5: "只存在這一場
  的名單上，不建學生程度檔案").
- TeamArenaAnswer   — one submission (active or assist), unique per
  (session, member, turn) so a second submission in the same turn is
  rejected at the DB level, not just in application code (PRD §13 AC4:
  "同回合第二次作答回 409").

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
# PRD §3.1 canonical lane order; §3.1 also defines "support" as the 5th,
# floating lane — see services/team_arena/teams.py PRIMARY_LANES/LANES for
# the single source of truth this CheckConstraint must stay in sync with.
TEAM_ARENA_LANES = ("zhuyin", "vocab_definitions", "vocab_application", "comprehension", "support")
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
    classroom_id: Mapped[int] = mapped_column(ForeignKey("classrooms.id"), nullable=False, index=True)
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

    classroom: Mapped["Classroom"] = relationship("Classroom", foreign_keys=[classroom_id])  # type: ignore[name-defined]
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
    match_no: Mapped[int] = mapped_column(SmallInteger, nullable=False)
    side: Mapped[int] = mapped_column(SmallInteger, nullable=False)
    lane: Mapped[str] = mapped_column(String(20), nullable=False)
    rotation_order: Mapped[int] = mapped_column(SmallInteger, nullable=False)
    # PRD §5: "只存在這一場的名單上，不建學生程度檔案，學生自己與隊友看不到
    # 這個標記" — lives on THIS row only, never copied anywhere else.
    grade_pool_override: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    # Pre-generated, frozen question snapshot for this member's whole
    # match — PRD §7 "出題" row: same "frozen at creation" precedent as
    # `live_quiz_games.rounds_snapshot` / `pk_matches.rounds_snapshot`.
    question_queue: Mapped[list] = mapped_column(
        JSONB, nullable=False, server_default=text("'[]'::jsonb")
    )
    # PRD §3.3: "上場者斷線（超過 15 秒沒輪詢）：該回合直接記為『沒推進』並
    # 換下一位".
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
