"""The live-quiz engine — the one place that owns a game's lifecycle.

Everything here is lesson-loader-in, DB-out. It never imports a round
type's internals directly except through the ROUND_TYPES registry, and it
never imports a source adapter at all (that is round_types/choice.py's job).
This is what PRD independence rule #1 means in code: delete this whole
``live_quiz/`` package and every other module in the app still imports
cleanly.
"""
from __future__ import annotations

import random
import secrets
from datetime import datetime, timedelta, timezone

from fastapi import HTTPException
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from ...models.live_quiz import (
    GAME_LIFETIME_HOURS,
    MAX_PLAYERS_PER_GAME,
    LiveQuizAnswer,
    LiveQuizGame,
    LiveQuizPlayer,
)
from ...models.school import Classroom, ClassroomStudent, ClassroomTeacher
from ...models.user import User
from ...services.lesson_uid_loader import load_lesson
from . import recompute
from .codes import generate_live_quiz_code
from .round_types import ROUND_TYPES
from .round_types.choice import DEFAULT_READING_SECONDS

DEFAULT_SOURCE_MODULES = ("comprehension", "vocab_definitions", "vocab_application")
VALID_QUESTION_COUNT_MODES = ("all", 10, 15, 20)
MAX_READING_SECONDS = 30
# Presence (UI/UX review #6): a player's last_seen_at within this window
# counts as "online" in the host's roster view.
ONLINE_WINDOW_SECONDS = 10


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _aware(dt: datetime | None) -> datetime | None:
    """SQLite has no native timezone-aware datetime type — a value stored
    through a ``DateTime(timezone=True)`` column can round-trip back as
    naive even though it was written as UTC-aware (this only bites in
    SQLite-backed tests; Postgres keeps the offset). Comparing a naive value
    against ``_now()`` (always aware) raises ``TypeError``, so every column
    value this module does Python-side datetime arithmetic on goes through
    here first. Assume UTC for anything that comes back naive — every write
    in this module only ever stores UTC via ``_now()``.
    """
    if dt is not None and dt.tzinfo is None:
        return dt.replace(tzinfo=timezone.utc)
    return dt


def _load_lessons(lesson_uids: list[str]) -> list[dict]:
    lessons = []
    for uid in lesson_uids:
        lesson = load_lesson(uid)
        if lesson is None:
            raise HTTPException(status_code=400, detail=f"Unknown lesson: {uid}")
        lessons.append({"lesson_uid": uid, "lesson": lesson})
    return lessons


def _require_classroom_owned_by(db: Session, classroom_id: int, teacher: User) -> Classroom:
    classroom = db.query(Classroom).filter(Classroom.id == classroom_id).first()
    if classroom is None:
        raise HTTPException(status_code=404, detail="Classroom not found")
    if classroom.teacher_id != teacher.id:
        is_co_teacher = (
            db.query(ClassroomTeacher)
            .filter(
                ClassroomTeacher.classroom_id == classroom_id,
                ClassroomTeacher.teacher_id == teacher.id,
            )
            .first()
        )
        if is_co_teacher is None:
            raise HTTPException(status_code=403, detail="Not your classroom")
    return classroom


# ---------------------------------------------------------------------------
# Creation
# ---------------------------------------------------------------------------

def create_game(
    db: Session,
    host: User,
    *,
    lesson_uids: list[str],
    source_modules: list[str] | None,
    round_type: str = "choice",
    question_count_mode="all",
    seconds: int = 30,
    reading_seconds: int = DEFAULT_READING_SECONDS,
    classroom_id: int | None = None,
    shuffle: bool = False,
    show_leaderboard_after_each: bool = True,
    double_points_last: bool = False,
    streak_bonus_enabled: bool = False,
    practice_mode: bool = False,
) -> LiveQuizGame:
    if not lesson_uids:
        raise HTTPException(status_code=400, detail="Pick at least one lesson")
    if round_type not in ROUND_TYPES:
        raise HTTPException(status_code=400, detail=f"Unknown round_type: {round_type}")
    source_modules = list(source_modules) if source_modules else list(DEFAULT_SOURCE_MODULES)
    if not source_modules:
        raise HTTPException(status_code=400, detail="Pick at least one question type")
    if question_count_mode not in VALID_QUESTION_COUNT_MODES and str(question_count_mode) not in {
        str(m) for m in VALID_QUESTION_COUNT_MODES
    }:
        raise HTTPException(status_code=400, detail=f"Invalid question_count_mode: {question_count_mode}")
    if not (0 <= reading_seconds <= MAX_READING_SECONDS):
        raise HTTPException(status_code=400, detail=f"reading_seconds must be 0-{MAX_READING_SECONDS}")

    if classroom_id is not None:
        _require_classroom_owned_by(db, classroom_id, host)

    lessons = _load_lessons(lesson_uids)

    seed = secrets.randbelow(2**31)
    rng = random.Random(seed)

    settings = {
        "seconds": int(seconds),
        "reading_seconds": int(reading_seconds),
        "question_count_mode": question_count_mode if question_count_mode == "all" else int(question_count_mode),
        "shuffle": bool(shuffle),
        "show_leaderboard_after_each": bool(show_leaderboard_after_each),
        "double_points_last": bool(double_points_last),
        "streak_bonus": bool(streak_bonus_enabled),
        "practice_mode": bool(practice_mode),
        "source_modules": source_modules,
        # Stored verbatim (not just reconstructed from rounds_snapshot) so
        # get_game_results() can report exactly which lessons/round-type a
        # game used (Young 2026-10-15: the read-only "game results" seam
        # needs "game settings/question-set id", not just final scores).
        # There is deliberately no "create a new game from this" function —
        # Young 2026-10-15 dropped that seam: the future 競賽 league scores
        # long-term learning completion, not live-quiz results, so nothing
        # needs to replay a saved live-quiz configuration.
        "lesson_uids": list(lesson_uids),
        "round_type": round_type,
    }

    round_module = ROUND_TYPES[round_type]
    rounds, question_count_fallback = round_module.generate_rounds(lessons, settings, rng)
    if not rounds:
        raise HTTPException(
            status_code=400,
            detail="No questions could be generated from the selected lessons/question types",
        )
    # UI/UX review #8: persisted (not just returned once) so a host revisiting
    # the game, or get_game_results() later, can still see the notice.
    settings["question_count_fallback"] = question_count_fallback

    now = _now()
    code = generate_live_quiz_code(db)
    game = LiveQuizGame(
        code=code,
        host_teacher_id=host.id,
        classroom_id=classroom_id,
        status="lobby",
        settings=settings,
        rounds_snapshot=rounds,
        seed=seed,
        current_round_index=-1,
        version=1,
        created_at=now,
        expires_at=now + timedelta(hours=GAME_LIFETIME_HOURS),
    )
    db.add(game)
    db.commit()
    db.refresh(game)
    return game


# ---------------------------------------------------------------------------
# Lookup + expiry
# ---------------------------------------------------------------------------

def get_game_by_code(db: Session, code: str) -> LiveQuizGame:
    game = (
        db.query(LiveQuizGame)
        .filter(LiveQuizGame.code == code.upper())
        .order_by(LiveQuizGame.id.desc())
        .first()
    )
    if game is None:
        raise HTTPException(status_code=404, detail="Game not found")
    _maybe_expire(db, game)
    return game


def get_game_by_id(db: Session, game_id: int) -> LiveQuizGame:
    game = db.query(LiveQuizGame).filter(LiveQuizGame.id == game_id).first()
    if game is None:
        raise HTTPException(status_code=404, detail="Game not found")
    _maybe_expire(db, game)
    return game


def _maybe_expire(db: Session, game: LiveQuizGame) -> None:
    if game.status != "ended" and _now() >= _aware(game.expires_at):
        game.status = "ended"
        game.ended_at = _now()
        game.cached_leaderboard = _compute_leaderboard(game)
        game.version += 1
        db.commit()
        db.refresh(game)


def get_player_for_user(db: Session, game: LiveQuizGame, user: User) -> LiveQuizPlayer | None:
    for p in game.players:
        if p.user_id == user.id:
            return p
    return None


def is_authenticated_member_by_code(db: Session, code: str, user_id: int) -> bool:
    """Cheap, read-only membership check keyed by CODE rather than a loaded
    ``LiveQuizGame`` — this is what ``GlobalRateLimitMiddleware`` (pure ASGI,
    no FastAPI ``Depends``) calls to decide whether to exempt a
    ``/state`` or ``/answer`` request from the per-IP limit (external review
    #3). No ``_maybe_expire`` side effect on purpose: middleware must never
    write to the DB on a hot polling path, and an expired-but-not-yet-marked
    game still correctly exempts its real members (the route itself will
    404/409 appropriately once it loads the game for real).
    """
    rows = (
        db.query(LiveQuizGame.id, LiveQuizGame.host_teacher_id)
        .filter(LiveQuizGame.code == code.upper())
        .all()
    )
    if not rows:
        return False
    if any(host_id == user_id for _gid, host_id in rows):
        return True
    game_ids = [gid for gid, _host_id in rows]
    return (
        db.query(LiveQuizPlayer.id)
        .filter(LiveQuizPlayer.game_id.in_(game_ids), LiveQuizPlayer.user_id == user_id)
        .first()
        is not None
    )


def is_member(db: Session, game: LiveQuizGame, user_id: int) -> bool:
    """Host or a joined player. Used both by routes (403 gate) and by the
    rate-limit middleware's membership check (external review #3) — a
    single indexed-FK-friendly query either way."""
    if user_id == game.host_teacher_id:
        return True
    return (
        db.query(LiveQuizPlayer.id)
        .filter(LiveQuizPlayer.game_id == game.id, LiveQuizPlayer.user_id == user_id)
        .first()
        is not None
    )


# ---------------------------------------------------------------------------
# Join
# ---------------------------------------------------------------------------

def join_game(db: Session, code: str, user: User) -> LiveQuizPlayer:
    """UI/UX review 2026-10-15 #3: late join is allowed up until the game
    ends (not just during the lobby) — the player's ``joined_at_round_index``
    is pinned to whatever round is current RIGHT NOW, so they start from the
    next question. Earlier rounds simply never get an answer row from them,
    which is what already excludes a player from a round's accuracy
    denominator (see get_game_results) — "not_participated" is the absence
    of a row, not a stored status.
    """
    game = get_game_by_code(db, code)
    if user.id == game.host_teacher_id:
        raise HTTPException(status_code=403, detail="The host cannot join their own game as a player")

    existing = get_player_for_user(db, game, user)
    if existing is not None:
        return existing

    if game.status == "ended":
        raise HTTPException(status_code=409, detail="This game has ended")
    if len(game.players) >= MAX_PLAYERS_PER_GAME:
        raise HTTPException(status_code=409, detail="This game is full")

    player = LiveQuizPlayer(
        game_id=game.id,
        user_id=user.id,
        display_name=user.name or user.email,
        joined_at_round_index=game.current_round_index,
    )
    db.add(player)
    game.version += 1
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        existing = get_player_for_user(db, game, user)
        if existing is not None:
            return existing
        raise HTTPException(status_code=409, detail="Could not join this game")
    db.refresh(player)
    db.refresh(game)
    return player


# ---------------------------------------------------------------------------
# Host controls
# ---------------------------------------------------------------------------

def _require_host(game: LiveQuizGame, user: User) -> None:
    if user.id != game.host_teacher_id:
        raise HTTPException(status_code=403, detail="Only this game's host can do that")


def _check_host_device(game: LiveQuizGame, device_id: str | None, confirm_takeover: bool) -> None:
    """UI/UX review 2026-10-15 #4: "host takeover on another device = explicit
    confirm, not automatic". ``device_id`` is a client-generated id (NOT the
    user id — the whole point is the SAME teacher controlling from a second
    tab/device). No device id supplied -> can't track, so allow (keeps every
    pre-existing caller, including every test above this change, working
    without modification).
    """
    if device_id is None:
        return
    if game.host_device_id is None or game.host_device_id == device_id:
        game.host_device_id = device_id
        return
    if not confirm_takeover:
        raise HTTPException(
            status_code=409,
            detail="Another device is currently hosting this game. Pass confirm_takeover=true to take over.",
        )
    game.host_device_id = device_id


def remove_player(db: Session, game: LiveQuizGame, user: User, player_id: int) -> None:
    """UI/UX review #5: host can remove a player from the lobby — before
    start only (once questions are flowing, a removed player's existing
    answers would orphan; simplest correct rule is "lobby only")."""
    _require_host(game, user)
    if game.status != "lobby":
        raise HTTPException(status_code=409, detail="Players can only be removed before the game starts")
    player = db.query(LiveQuizPlayer).filter(
        LiveQuizPlayer.id == player_id, LiveQuizPlayer.game_id == game.id
    ).first()
    if player is None:
        raise HTTPException(status_code=404, detail="Player not found in this game")
    db.delete(player)
    game.version += 1
    db.commit()


def start_game(
    db: Session, game: LiveQuizGame, user: User,
    *, device_id: str | None = None, confirm_takeover: bool = False,
) -> LiveQuizGame:
    _require_host(game, user)
    _check_host_device(game, device_id, confirm_takeover)
    if game.status == "ended":
        raise HTTPException(status_code=409, detail="This game has ended")
    if game.status != "lobby":
        raise HTTPException(status_code=409, detail="This game has already started")
    if not game.rounds_snapshot:
        raise HTTPException(status_code=400, detail="No rounds to start")
    game.status = "question"
    game.current_round_index = 0
    game.current_round_started_at = _now()
    game.version += 1
    db.commit()
    db.refresh(game)
    return game


def reveal_round(
    db: Session, game: LiveQuizGame, user: User,
    *, device_id: str | None = None, confirm_takeover: bool = False,
) -> LiveQuizGame:
    _require_host(game, user)
    _check_host_device(game, device_id, confirm_takeover)
    if game.status != "question":
        raise HTTPException(status_code=409, detail="Not currently showing a question")
    game.status = "reveal"
    game.cached_leaderboard = _compute_leaderboard(game)
    game.version += 1
    db.commit()
    db.refresh(game)
    return game


def next_round(
    db: Session, game: LiveQuizGame, user: User,
    *, device_id: str | None = None, confirm_takeover: bool = False,
) -> LiveQuizGame:
    _require_host(game, user)
    _check_host_device(game, device_id, confirm_takeover)
    if game.status != "reveal":
        raise HTTPException(status_code=409, detail="Reveal the current round before advancing")
    nxt = game.current_round_index + 1
    if nxt >= len(game.rounds_snapshot):
        return end_game(db, game, user, reason="completed")
    game.current_round_index = nxt
    game.current_round_started_at = _now()
    game.status = "question"
    game.version += 1
    db.commit()
    db.refresh(game)
    return game


def end_game(
    db: Session, game: LiveQuizGame, user: User, *, reason: str = "host_ended",
    device_id: str | None = None, confirm_takeover: bool = False,
) -> LiveQuizGame:
    """``reason``: "host_ended" when the host stops a game early (UI/UX
    review #7 — "players' state shows ended-by-host"), "completed" when
    ``next_round`` calls this internally because the last round just
    finished naturally. Only the public, host-facing /end route can produce
    "host_ended"; the internal call from next_round always passes
    "completed"."""
    _require_host(game, user)
    _check_host_device(game, device_id, confirm_takeover)
    if game.status == "ended":
        return game
    game.status = "ended"
    game.ended_at = _now()
    game.ended_reason = reason
    game.cached_leaderboard = _compute_leaderboard(game)
    game.version += 1
    db.commit()
    db.refresh(game)
    return game


def _compute_leaderboard(game: LiveQuizGame, limit: int | None = None) -> list[dict]:
    ranked = sorted(game.players, key=lambda p: (-p.total_score, p.joined_at, p.id))
    entries = [
        {
            "player_id": p.id,
            "display_name": p.display_name,
            "total_score": p.total_score,
            "rank": i + 1,
        }
        for i, p in enumerate(ranked)
    ]
    return entries[:limit] if limit else entries


# ---------------------------------------------------------------------------
# Answering
# ---------------------------------------------------------------------------

def submit_answer(db: Session, game: LiveQuizGame, player: LiveQuizPlayer, submission: dict) -> LiveQuizAnswer:
    _maybe_expire(db, game)
    if game.status != "question":
        raise HTTPException(status_code=409, detail="Not currently accepting answers")

    idx = game.current_round_index

    # UI/UX review #3: late join — this player wasn't here yet when this
    # round (or an earlier one) started.
    if idx <= player.joined_at_round_index:
        raise HTTPException(
            status_code=409,
            detail="You joined after this question started — wait for the next one",
        )

    rounds_total = len(game.rounds_snapshot)
    round_def = game.rounds_snapshot[idx]
    payload = round_def["payload"]
    seconds = payload.get("seconds", 30)
    reading_seconds = payload.get("reading_seconds", 0)
    question_shown_at = _aware(game.current_round_started_at)
    now = _now()

    # UI/UX review #2: the answer window opens `reading_seconds` after the
    # question is shown — elapsed time (and therefore the speed bonus) counts
    # from THAT point, not from when the stem first appeared.
    answer_open_at = (
        question_shown_at + timedelta(seconds=reading_seconds) if question_shown_at else None
    )
    if answer_open_at is not None and now < answer_open_at:
        raise HTTPException(status_code=409, detail="Too early — the answer window hasn't opened yet")
    elapsed_ms = int((now - answer_open_at).total_seconds() * 1000) if answer_open_at else 0

    limit_ms = seconds * 1000
    grace_ms = 1000  # "reject after limit+1s grace" (PRD §9 architecture table)
    if elapsed_ms > limit_ms + grace_ms:
        raise HTTPException(status_code=409, detail="Too late — this round's time is up")

    existing = (
        db.query(LiveQuizAnswer)
        .filter(LiveQuizAnswer.player_id == player.id, LiveQuizAnswer.round_index == idx)
        .first()
    )
    if existing is not None:
        raise HTTPException(status_code=409, detail="You already answered this round")

    tentative_streak = player.current_streak + 1
    is_last_round = idx == rounds_total - 1
    is_correct, points = recompute.compute_round_result(
        round_def=round_def,
        settings=game.settings,
        submission=submission or {},
        elapsed_ms=elapsed_ms,
        new_streak=tentative_streak,
        is_last_round=is_last_round,
    )
    new_streak = tentative_streak if is_correct else 0

    answer = LiveQuizAnswer(
        game_id=game.id,
        player_id=player.id,
        round_index=idx,
        submission=submission or {},
        is_correct=is_correct,
        points=points,
        elapsed_ms=min(max(elapsed_ms, 0), limit_ms),
        round_started_at=question_shown_at or now,
        answered_at=now,
    )
    db.add(answer)
    player.current_streak = new_streak
    player.total_score += points
    game.version += 1
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=409, detail="You already answered this round")
    db.refresh(answer)
    return answer


# ---------------------------------------------------------------------------
# Role-aware state (polling)
# ---------------------------------------------------------------------------

def build_state(db: Session, game: LiveQuizGame, user: User, after_version: int | None = None) -> dict:
    """Role-aware poll response — see also UI/UX review 2026-10-15 items
    #2 (reading phase), #4 (resume with server-side timing — every timestamp
    a client needs to recompute its own countdown after a refresh is in
    here), #6 (presence) and #7 (ended_reason)."""
    _maybe_expire(db, game)
    is_host = user.id == game.host_teacher_id
    player = None if is_host else get_player_for_user(db, game, user)
    if not is_host and player is None:
        raise HTTPException(status_code=403, detail="You have not joined this game")

    now = _now()

    # Presence (#6): bumped on EVERY poll, even the cheap "unchanged" path
    # below — that's the one signal that must never be skipped, since it's
    # the only thing that changes almost every call.
    if player is not None:
        player.last_seen_at = now
        db.commit()

    if after_version is not None and after_version == game.version:
        return {
            "code": game.code,
            "status": game.status,
            "version": game.version,
            "server_now": now.isoformat(),
            "unchanged": True,
        }

    rounds_total = len(game.rounds_snapshot)
    idx = game.current_round_index
    question_shown_at = _aware(game.current_round_started_at)
    answer_open_at = None
    reading_seconds = 0
    round_view = None
    answered_count = None
    correct_count = None
    if 0 <= idx < rounds_total:
        round_def = game.rounds_snapshot[idx]
        payload = round_def["payload"]
        round_module = ROUND_TYPES[round_def["round_type"]]
        revealed = game.status in ("reveal", "ended")
        reading_seconds = payload.get("reading_seconds", 0)
        if question_shown_at is not None:
            answer_open_at = question_shown_at + timedelta(seconds=reading_seconds)
        in_reading_phase = (
            game.status == "question" and answer_open_at is not None and now < answer_open_at
        )
        round_view = round_module.player_view(payload, revealed, show_options=not in_reading_phase)
        if game.status in ("question", "reveal"):
            round_answers = (
                db.query(LiveQuizAnswer)
                .filter(LiveQuizAnswer.game_id == game.id, LiveQuizAnswer.round_index == idx)
                .all()
            )
            answered_count = len(round_answers)
            correct_count = sum(1 for a in round_answers if a.is_correct)  # host-only, see below

    practice_mode = bool(game.settings.get("practice_mode"))
    leaderboard = None
    if game.status in ("reveal", "ended") and not (practice_mode and not is_host):
        is_last = idx == rounds_total - 1
        if game.status == "ended" or game.settings.get("show_leaderboard_after_each") or is_last:
            leaderboard = game.cached_leaderboard

    your_player = None
    if player is not None:
        eligible = idx > player.joined_at_round_index
        your_player = {"player_id": player.id, "display_name": player.display_name, "eligible": eligible}
        if not practice_mode:
            rank_entry = next(
                (e for e in (game.cached_leaderboard or []) if e["player_id"] == player.id), None
            )
            your_player["total_score"] = player.total_score
            your_player["rank"] = rank_entry["rank"] if rank_entry else None
        if game.status in ("reveal", "ended") and 0 <= idx < rounds_total:
            my_answer = (
                db.query(LiveQuizAnswer)
                .filter(LiveQuizAnswer.player_id == player.id, LiveQuizAnswer.round_index == idx)
                .first()
            )
            # None (not False!) when there is no answer row — UI/UX review
            # #3: "recorded as not_participated (not wrong)". `eligible`
            # above tells the caller WHY there's no row (joined late vs.
            # simply didn't answer in time); both cases share this None.
            your_player["last_answer_correct"] = my_answer.is_correct if my_answer else None
            if not practice_mode:
                your_player["last_answer_points"] = my_answer.points if my_answer else 0

    state = {
        "code": game.code,
        "status": game.status,
        "version": game.version,
        "server_now": now.isoformat(),
        "round_index": idx,
        "rounds_total": rounds_total,
        "question_started_at": question_shown_at.isoformat() if question_shown_at else None,
        "answer_open_at": answer_open_at.isoformat() if answer_open_at else None,
        "reading_seconds": reading_seconds,
        "round": round_view,
        "answered_count": answered_count,
        "players_count": len(game.players),
        "is_host": is_host,
        "classroom_id": game.classroom_id,
        "settings": game.settings,
        "ended_reason": game.ended_reason,
        "ended_by_host": game.ended_reason == "host_ended",
    }
    if is_host:
        online_cutoff = now - timedelta(seconds=ONLINE_WINDOW_SECONDS)
        state["players"] = [
            {
                "player_id": p.id,
                "display_name": p.display_name,
                "total_score": p.total_score,
                "online": _aware(p.last_seen_at) >= online_cutoff if p.last_seen_at else False,
            }
            for p in sorted(game.players, key=lambda p: p.joined_at)
        ]
        state["online_count"] = sum(1 for p in state["players"] if p["online"])
        # Per-question accuracy-so-far (#9) is host-only — a player seeing
        # the live correct-count would imply knowing how many others got it
        # right before their own answer is revealed.
        if correct_count is not None:
            state["correct_count"] = correct_count
    if leaderboard is not None:
        state["leaderboard"] = leaderboard
    if your_player is not None:
        state["your_player"] = your_player
    return state


# ---------------------------------------------------------------------------
# Class invite (student home banner)
# ---------------------------------------------------------------------------

def find_open_invite_for_student(db: Session, user: User) -> dict | None:
    classroom_ids = [
        row[0]
        for row in db.query(ClassroomStudent.classroom_id)
        .filter(ClassroomStudent.student_id == user.id)
        .all()
    ]
    if not classroom_ids:
        return None
    now = _now()
    game = (
        db.query(LiveQuizGame)
        .filter(
            LiveQuizGame.classroom_id.in_(classroom_ids),
            # UI/UX review #3: late join works at any point before the game
            # ends, so the invite banner should keep inviting stragglers
            # through "question"/"reveal", not just "lobby".
            LiveQuizGame.status != "ended",
            LiveQuizGame.expires_at > now,
        )
        .order_by(LiveQuizGame.created_at.desc())
        .first()
    )
    if game is None:
        return None
    return {"code": game.code, "status": game.status, "classroom_id": game.classroom_id}


# ---------------------------------------------------------------------------
# History ("歷次課堂挑戰")
# ---------------------------------------------------------------------------

def list_host_games(db: Session, host: User) -> list[LiveQuizGame]:
    return (
        db.query(LiveQuizGame)
        .filter(LiveQuizGame.host_teacher_id == host.id)
        .order_by(LiveQuizGame.created_at.desc())
        .all()
    )


def get_game_results(db: Session, game: LiveQuizGame) -> dict:
    """Read-only "game results" seam (Young, 2026-10-15): final per-player
    points, correctness per round, the settings/question-set used, and
    timestamps. Nothing here mutates the game — this is the one place a
    FUTURE cross-class league module is meant to read from instead of
    querying ``live_quiz_answers`` itself, so a league can be built without
    this module needing to change again.

    Used today by the host-facing "歷次課堂挑戰" detail view
    (``GET /api/live-quiz/games/{code}/results``); the shape is intentionally
    role-agnostic (no hidden/omitted fields) since only the host can reach
    it — see routes/live_quiz.py.
    """
    all_answers = db.query(LiveQuizAnswer).filter(LiveQuizAnswer.game_id == game.id).all()
    answers_by_round: dict[int, list[LiveQuizAnswer]] = {}
    answers_by_player: dict[int, list[LiveQuizAnswer]] = {}
    for a in all_answers:
        answers_by_round.setdefault(a.round_index, []).append(a)
        answers_by_player.setdefault(a.player_id, []).append(a)

    rounds = []
    for i, round_def in enumerate(game.rounds_snapshot):
        ans = answers_by_round.get(i, [])
        correct_n = sum(1 for a in ans if a.is_correct)
        total_n = len(ans)
        payload = round_def["payload"]
        rounds.append(
            {
                "round_index": i,
                "item_id": payload.get("item_id"),
                "source_module": payload.get("source_module"),
                "lesson_title": payload.get("lesson_title"),
                "stem": payload.get("stem"),
                "correct_key": payload.get("correct_key"),
                "answered": total_n,
                "correct": correct_n,
                "accuracy": (correct_n / total_n) if total_n else None,
            }
        )

    ranking = game.cached_leaderboard or _compute_leaderboard(game)
    players = []
    for p in sorted(game.players, key=lambda p: p.joined_at):
        rank_entry = next((e for e in ranking if e["player_id"] == p.id), None)
        players.append(
            {
                "player_id": p.id,
                "display_name": p.display_name,
                "total_score": p.total_score,
                "rank": rank_entry["rank"] if rank_entry else None,
                "answers": [
                    {"round_index": a.round_index, "is_correct": a.is_correct, "points": a.points}
                    for a in sorted(answers_by_player.get(p.id, []), key=lambda a: a.round_index)
                ],
            }
        )

    return {
        "code": game.code,
        "status": game.status,
        "round_type": game.settings.get("round_type", "choice"),
        "settings": game.settings,
        "created_at": game.created_at.isoformat(),
        "ended_at": game.ended_at.isoformat() if game.ended_at else None,
        "ended_reason": game.ended_reason,
        "classroom_id": game.classroom_id,
        "rounds_total": len(game.rounds_snapshot),
        "players_count": len(game.players),
        "ranking": ranking,
        "rounds": rounds,
        "players": players,
    }


# Kept as an alias: existing callers/tests that pre-date the Young 2026-10-15
# "game results" naming still resolve.
game_history_detail = get_game_results

