"""Live Quiz (課堂搶答, shown in the UI as 班級經營) API — Issue #3551.
``/api/live-quiz/*``. 競賽 is a different, future, long-term league module —
see specs/modules/live-quiz/INTENT.md for the naming decision.

Deliberately its own router/prefix (PRD independence rule #4): no write
here ever touches ``learning_sessions``/``mcq_attempt``/XP tables, and
nothing outside this module imports it.
"""
from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Path, Query, Request
from sqlalchemy.orm import Session

from ..auth.dependencies import get_current_user, oauth2_scheme
from ..auth.jwt import decode_token
from ..auth.rate_limiter import InMemoryRateLimiter
from ..database import get_db
from ..models.user import User
from ..schemas.live_quiz import HostControlRequest, LiveQuizAnswerRequest, LiveQuizCreateRequest
from ..services.live_quiz import engine

router = APIRouter(prefix="/live-quiz", tags=["live-quiz"])

# Every game code is exactly 6 digits (services/live_quiz/codes.py). Constrain
# the path param itself so a malformed value (path-traversal segment, letters,
# wrong length) 422s at the routing layer before any handler body — the
# frontend client (liveQuizApi.ts) validates the same shape, but a path
# param is attacker-controlled input regardless of what any particular
# client sends, so the server must not trust it either (external security
# review on PR for #3551).
GameCode = Annotated[str, Path(pattern=r"^\d{6}$")]

# Strict PER-USER (not per-IP) limiter against code-guessing (external
# review #3): a classroom's 300/min per-IP budget is for legitimate
# traffic, but a single bad-faith account trying codes needs its own cap
# regardless of which IP it comes from. Approximate under multi-instance
# Cloud Run (in-process only) is an accepted tradeoff here — see
# auth/rate_limiter.py module docstring for the same tradeoff made
# elsewhere in this codebase.
_join_rate_limiter = InMemoryRateLimiter()
_JOIN_MAX_ATTEMPTS = 10
_JOIN_WINDOW_SECONDS = 60


@router.post("/games", status_code=201)
def create_game(
    payload: LiveQuizCreateRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    game = engine.create_game(
        db,
        current_user,
        lesson_uids=payload.lesson_uids,
        source_modules=payload.source_modules,
        round_type=payload.round_type,
        question_count_mode=payload.question_count_mode,
        seconds=payload.seconds,
        reading_seconds=payload.reading_seconds,
        classroom_id=payload.classroom_id,
        shuffle=payload.shuffle,
        show_leaderboard_after_each=payload.show_leaderboard_after_each,
        double_points_last=payload.double_points_last,
        streak_bonus_enabled=payload.streak_bonus,
        practice_mode=payload.practice_mode,
    )
    return {
        "code": game.code,
        "game_id": game.id,
        "status": game.status,
        "rounds_total": len(game.rounds_snapshot),
        "settings": game.settings,
        # UI/UX review #8: lets the host's setup screen show a notice when
        # fewer questions were available than requested.
        "question_count_fallback": game.settings.get("question_count_fallback", False),
        "expires_at": game.expires_at.isoformat(),
    }


@router.get("/games")
def list_my_games(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    games = engine.list_host_games(db, current_user)
    return {
        "games": [
            {
                "code": g.code,
                "status": g.status,
                "classroom_id": g.classroom_id,
                "created_at": g.created_at.isoformat(),
                "ended_at": g.ended_at.isoformat() if g.ended_at else None,
                "ended_reason": g.ended_reason,
                "rounds_total": len(g.rounds_snapshot),
                "players_count": len(g.players),
            }
            for g in games
        ]
    }


@router.get("/invites")
def get_open_invite(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Polled every 10-15s by student home while the page is open (PRD §9
    item 8) — NOT every second. The frontend owns that interval; this
    endpoint is just one indexed query."""
    invite = engine.find_open_invite_for_student(db, current_user)
    return {"invite": invite}


@router.post("/games/{code}/join", status_code=201)
def join_game(
    code: GameCode,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    key = f"live_quiz_join:user:{current_user.id}"
    if not _join_rate_limiter.check(key, _JOIN_MAX_ATTEMPTS, _JOIN_WINDOW_SECONDS):
        raise HTTPException(status_code=429, detail="Too many join attempts. Please wait before retrying.")
    player = engine.join_game(db, code, current_user)
    return {"player_id": player.id, "display_name": player.display_name, "game_code": player.game.code}


@router.delete("/games/{code}/players/{player_id}", status_code=204)
def remove_player(
    code: GameCode,
    player_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """UI/UX review #5: host can remove a player from the lobby (before
    start only — engine.remove_player enforces that)."""
    game = engine.get_game_by_code(db, code)
    engine.remove_player(db, game, current_user, player_id)


def _unchanged_from_memory(code: str, after_version: int | None, token: str | None) -> dict | None:
    """Steady-state fast path (see engine._FastPollCache): a verified JWT plus
    a recent full poll by the same player. Anything else falls through to the
    normal authenticated, DB-backed path below."""
    if after_version is None or not token:
        return None
    try:
        user_id = int(decode_token(token)["sub"])
    except Exception:
        return None
    return engine.fast_poll_cache.unchanged(code.upper(), user_id, after_version)


async def _state_user(
    request: Request,
    code: GameCode,
    after_version: int | None = Query(default=None),
    token: str | None = Depends(oauth2_scheme),
    db: Session = Depends(get_db),
):
    fast = _unchanged_from_memory(code, after_version, token)
    if fast is not None:
        return fast
    return await get_current_user(request, token, db)


@router.get("/games/{code}/state")
def get_state(
    code: GameCode,
    after_version: int | None = Query(default=None),
    resolved=Depends(_state_user),
    db: Session = Depends(get_db),
):
    if isinstance(resolved, dict):  # answered from memory, no DB touched
        return resolved
    game = engine.get_game_by_code(db, code)
    return engine.build_state(db, game, resolved, after_version=after_version)


@router.post("/games/{code}/answer")
def submit_answer(
    code: GameCode,
    payload: LiveQuizAnswerRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    game = engine.get_game_by_code(db, code)
    if current_user.id == game.host_teacher_id:
        raise HTTPException(status_code=403, detail="The host cannot answer their own game")
    player = engine.get_player_for_user(db, game, current_user)
    if player is None:
        raise HTTPException(status_code=403, detail="You have not joined this game")
    answer = engine.submit_answer(db, game, player, payload.submission)
    return {
        "round_index": answer.round_index,
        "is_correct": answer.is_correct,
        "points": answer.points,
    }


@router.post("/games/{code}/start")
def start_game(
    code: GameCode,
    payload: HostControlRequest = HostControlRequest(),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    game = engine.get_game_by_code(db, code)
    engine.start_game(
        db, game, current_user, device_id=payload.device_id, confirm_takeover=payload.confirm_takeover
    )
    return engine.build_state(db, game, current_user)


@router.post("/games/{code}/reveal")
def reveal_round(
    code: GameCode,
    payload: HostControlRequest = HostControlRequest(),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    game = engine.get_game_by_code(db, code)
    engine.reveal_round(
        db, game, current_user, device_id=payload.device_id, confirm_takeover=payload.confirm_takeover
    )
    return engine.build_state(db, game, current_user)


@router.post("/games/{code}/next")
def next_round(
    code: GameCode,
    payload: HostControlRequest = HostControlRequest(),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    game = engine.get_game_by_code(db, code)
    engine.next_round(
        db, game, current_user, device_id=payload.device_id, confirm_takeover=payload.confirm_takeover
    )
    return engine.build_state(db, game, current_user)


@router.post("/games/{code}/end")
def end_game(
    code: GameCode,
    payload: HostControlRequest = HostControlRequest(),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    game = engine.get_game_by_code(db, code)
    # Host hitting /end directly is always "host_ended" (UI/UX review #7) —
    # the "completed" reason is only ever set internally by next_round.
    engine.end_game(
        db, game, current_user, reason="host_ended",
        device_id=payload.device_id, confirm_takeover=payload.confirm_takeover,
    )
    return engine.build_state(db, game, current_user)


@router.get("/games/{code}/results")
def get_results(
    code: GameCode,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    game = engine.get_game_by_code(db, code)
    if current_user.id != game.host_teacher_id:
        raise HTTPException(status_code=403, detail="Only this game's host can view its results")
    return engine.get_game_results(db, game)
