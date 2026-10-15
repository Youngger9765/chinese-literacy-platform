"""Live Quiz (課堂搶答, UI label 班級經營) — in-class, live-paced quiz game.
Issue #3551. Not to be confused with 競賽, a separate future league module.

Three tables, deliberately generic so a second round type (字盤找詞回合,
word search — next PR) can plug in without a schema change:

- LiveQuizGame    — one play session. rounds_snapshot is a frozen JSON
  list of {round_index, round_type, payload} built once at creation time
  (independence rule #3 in the PRD: a later curriculum edit must never affect
  a game already in flight). settings is the live-paced options the host
  picked (seconds, shuffle, show_leaderboard_after_each, double_points_last,
  streak_bonus, practice_mode, question_count_mode) — see
  specs/modules/live-quiz/INTENT.md for what each one does.
- LiveQuizPlayer  — one student in one game. current_streak is the
  running count of consecutive correct answers, used by the streak-bonus
  setting; it is NOT part of a round's scoring rule (cross-cutting, applied
  by the engine, not by the round type).
- LiveQuizAnswer  — one submission. submission is a round-type-owned
  JSON blob ({"choice_key": "A"} for the choice round type today;
  a future word-search round type would store {"found_words": [...]}
  here without any migration). is_correct / points are what the
  engine derived from it — the generic shape the PRD's architecture review
  (#9) asked for: "not only a single choice". round_started_at is copied
  from the game at answer time so every row is independently replayable
  (external review #2: "scoring must be recomputable from stored data
  alone") without having to reconstruct it from a column on LiveQuizGame
  that gets overwritten by the next round.

PRD independence rules this module owns:
  1. Depends only on the lesson loader (one-way) — nothing else may import
     this package.
  2. Each question source is its own adapter under services/live_quiz/sources/.
  3. rounds_snapshot is the frozen copy described above.
  4. Its own tables, its own /api/live-quiz/* routes.
"""
from datetime import datetime

from sqlalchemy import (
    Boolean,
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

# Game lifecycle. "question" = a round is live and counting down; "reveal" =
# the round just ended and the correct answer / distribution is showing;
# "ended" is terminal (also reached via 3h auto-expiry, see live_quiz/engine.py).
GAME_STATUSES = ("lobby", "question", "reveal", "ended")

MAX_PLAYERS_PER_GAME = 60
GAME_LIFETIME_HOURS = 3


class LiveQuizGame(Base):
    __tablename__ = "live_quiz_games"
    __table_args__ = (
        # Looked up on every join / state poll by code; status is included
        # because "is there an ACTIVE game with this code" is the actual query
        # (#3551 CTO review: code is unique only among active games, so an
        # expired game's code can be reused).
        Index("ix_live_quiz_games_code_status", "code", "status"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    code: Mapped[str] = mapped_column(String(10), nullable=False, index=True)
    host_teacher_id: Mapped[int] = mapped_column(
        ForeignKey("users.id"), nullable=False, index=True
    )
    # "開給本班" (PRD決定記錄 #2) — nullable because a host can also run a
    # code/QR-only game with no classroom attached.
    classroom_id: Mapped[int | None] = mapped_column(
        ForeignKey("classrooms.id", ondelete="SET NULL"), nullable=True, index=True
    )
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="lobby", index=True)

    # Live-paced settings the host picked at setup. Frozen at creation —
    # changing a teacher's "defaults" later must never reach a running game.
    settings: Mapped[dict] = mapped_column(
        JSONB, nullable=False, server_default=text("'{}'::jsonb")
    )
    # Frozen question/round list — see module docstring. One list entry per
    # round: {round_index, round_type, payload}.
    rounds_snapshot: Mapped[list] = mapped_column(
        JSONB, nullable=False, server_default=text("'[]'::jsonb")
    )
    # Deterministic seed for this game — round-order shuffle (settings.shuffle)
    # and the per-item display-position shuffle both derive from this, so
    # every player in the same game sees the same arrangement.
    seed: Mapped[int] = mapped_column(Integer, nullable=False, default=0)

    current_round_index: Mapped[int] = mapped_column(Integer, nullable=False, default=-1)
    current_round_started_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    # Bumped on every state-changing action (join/start/answer/reveal/next/end).
    # Poll clients send after_version and the server can reply "unchanged"
    # cheaply — see PRD #9 item 1 (rate-limit) and item 8 (invite polling).
    version: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    # Written ONCE at reveal/end (engine.py), never recomputed on a poll.
    # External review #4: "never compute the full leaderboard on every
    # poll" — a /state call on an unchanged version is a single indexed
    # row read, full stop.
    cached_leaderboard: Mapped[list] = mapped_column(
        JSONB, nullable=False, server_default=text("'[]'::jsonb")
    )
    # UI/UX review 2026-10-15 #4: "host takeover on another device = explicit
    # confirm, not automatic". A client-generated id (not a user id — the
    # SAME teacher controlling from two tabs/devices is exactly the case
    # this guards). Null until the first host control action sets it.
    host_device_id: Mapped[str | None] = mapped_column(String(100), nullable=True)
    # UI/UX review #7: "players' state shows ended-by-host" — distinguishes
    # a host hitting /end mid-game from the natural "ran out of rounds"
    # completion (set by next_round's internal end_game call).
    ended_reason: Mapped[str | None] = mapped_column(String(20), nullable=True)

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, index=True)
    ended_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    host_teacher: Mapped["User"] = relationship("User", foreign_keys=[host_teacher_id])  # type: ignore[name-defined]
    classroom: Mapped["Classroom | None"] = relationship(  # type: ignore[name-defined]
        "Classroom", foreign_keys=[classroom_id]
    )
    players: Mapped[list["LiveQuizPlayer"]] = relationship(
        "LiveQuizPlayer", back_populates="game", cascade="all, delete-orphan", lazy="selectin"
    )
    answers: Mapped[list["LiveQuizAnswer"]] = relationship(
        "LiveQuizAnswer", back_populates="game", cascade="all, delete-orphan"
    )


class LiveQuizPlayer(Base):
    __tablename__ = "live_quiz_players"
    __table_args__ = (
        UniqueConstraint("game_id", "user_id", name="uq_live_quiz_players_game_user"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    game_id: Mapped[int] = mapped_column(
        ForeignKey("live_quiz_games.id", ondelete="CASCADE"), nullable=False, index=True
    )
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), nullable=False, index=True)
    # Frozen at join time from users.name — "不用取暱稱" (PRD §4): the
    # student's own account name, not re-read live so a mid-game profile
    # edit can't change what's already shown on the leaderboard.
    display_name: Mapped[str] = mapped_column(String(100), nullable=False)
    total_score: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    current_streak: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    joined_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    # UI/UX review 2026-10-15 #3: late join — the round index that was
    # CURRENT at join time (-1 if joined during lobby, meaning every round
    # is playable). A player may only answer round_index >
    # joined_at_round_index: "starts from the next question", and rounds
    # before it are never answered by them at all, so the per-round
    # accuracy denominator (count of actual submissions) naturally excludes
    # them — see engine.get_game_results.
    joined_at_round_index: Mapped[int] = mapped_column(Integer, nullable=False, default=-1)
    # UI/UX review #6: bumped on every /state poll from this player. Host's
    # roster view derives "online" as last_seen_at within the last 10s.
    last_seen_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    game: Mapped["LiveQuizGame"] = relationship("LiveQuizGame", back_populates="players")
    user: Mapped["User"] = relationship("User", foreign_keys=[user_id])  # type: ignore[name-defined]
    answers: Mapped[list["LiveQuizAnswer"]] = relationship(
        "LiveQuizAnswer", back_populates="player", cascade="all, delete-orphan"
    )


class LiveQuizAnswer(Base):
    """One player's submission for one round.

    submission is intentionally opaque to the engine — only the round
    type that owns round_index (looked up via the game's
    rounds_snapshot) knows how to read it. is_correct / points are
    what the engine already derived, so the leaderboard never has to re-run
    scoring.
    """
    __tablename__ = "live_quiz_answers"
    __table_args__ = (
        UniqueConstraint("player_id", "round_index", name="uq_live_quiz_answers_player_round"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    game_id: Mapped[int] = mapped_column(
        ForeignKey("live_quiz_games.id", ondelete="CASCADE"), nullable=False, index=True
    )
    player_id: Mapped[int] = mapped_column(
        ForeignKey("live_quiz_players.id", ondelete="CASCADE"), nullable=False, index=True
    )
    round_index: Mapped[int] = mapped_column(Integer, nullable=False)
    submission: Mapped[dict] = mapped_column(
        JSONB, nullable=False, server_default=text("'{}'::jsonb")
    )
    is_correct: Mapped[bool | None] = mapped_column(Boolean, nullable=True)
    points: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    elapsed_ms: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    # Copied from game.current_round_started_at at the moment of submission
    # (external review #2: a self-contained audit record — this row alone,
    # plus the frozen rounds_snapshot payload, is enough to recompute
    # is_correct/points without touching LiveQuizGame's live, overwritten
    # current_round_started_at column).
    round_started_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    answered_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    game: Mapped["LiveQuizGame"] = relationship("LiveQuizGame", back_populates="answers")
    player: Mapped["LiveQuizPlayer"] = relationship("LiveQuizPlayer", back_populates="answers")
