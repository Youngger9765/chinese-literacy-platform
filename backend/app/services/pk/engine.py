"""PK match lifecycle — PRD §4/§5/§6/§7/§9 (match half; see matchmaking.py
for the queue/invite half).

Lazy, no-cron state machine (PRD §9.2 "比照輪詢時順便檢查", same spirit as
`live_quiz.engine._maybe_expire`): every poll/answer call runs
`_advance_if_needed` first, which only moves the match forward based on
elapsed server time and what's already been answered — nothing here is
driven by a background job.
"""
from __future__ import annotations

import random
import secrets
from datetime import datetime, timedelta, timezone

from fastapi import HTTPException
from sqlalchemy.orm import Session

from ...models.pk import (
    ANSWER_SECONDS,
    PkMatch,
    PkQueue,
    PkRating,
    RATING_DEFAULT,
    REVEAL_SECONDS,
    ROUNDS_PER_MATCH,
)
from ...models.school import Classroom, ClassroomStudent
from ...models.user import User
from ..game_core.display_name import resolve_display_name
from ..game_core.scope import (
    load_lessons_for_scope as _load_lessons_for_scope,
    resolve_pool_grade,  # noqa: F401 — re-exported: tests call `engine.resolve_pool_grade(...)`
    validate_scope,  # noqa: F401 — re-exported: matchmaking.py calls `pk_engine.validate_scope(...)`
)
from . import ai_tiers
from . import classroom_features
from . import rating_service
from . import scoring
from .rounds import build_pk_rounds


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _aware(dt: datetime | None) -> datetime | None:
    """Same SQLite-naive-datetime guard as live_quiz.engine._aware — every
    write in this module only ever stores UTC via ``_now()``."""
    if dt is not None and dt.tzinfo is None:
        return dt.replace(tzinfo=timezone.utc)
    return dt


LIMIT_MS = ANSWER_SECONDS * 1000

# #3602 B5: this used to be served from frontend/public/pk/figures/, which
# collides with the SPA's own `/pk` route — nginx's `try_files $uri $uri/
# /index.html` sees a real directory named `pk` in the docroot and 301s
# `/pk` -> `/pk/`, then 403s on `/pk/` itself instead of ever falling
# through to index.html (autoindex is off, so an unlisted directory with no
# index file is a dead end). Moved the assets to frontend/public/pk-art/,
# a path with no matching client route, so it can never shadow `/pk`.
PK_FIGURE_ASSET_BASE = "/pk-art/figures"


# ---------------------------------------------------------------------------
# Rating
# ---------------------------------------------------------------------------

def get_or_create_rating(db: Session, student_id: int) -> PkRating:
    rating = db.query(PkRating).filter(PkRating.student_id == student_id).first()
    if rating is None:
        rating = PkRating(student_id=student_id, rating=RATING_DEFAULT)
        db.add(rating)
        db.commit()
        db.refresh(rating)
    return rating


# ---------------------------------------------------------------------------
# Scope / lessons
#
# `resolve_pool_grade`/`validate_scope`/`_load_lessons_for_scope` moved to
# `services/game_core/scope.py` (2026-10-21, issue #3663 round 1) — this
# module and 迷城密室's engine needed the exact same "scope_type/scope_ref
# -> concrete lesson list" resolution, down to byte-identical error
# strings. As of round 3 (#3673) `resolve_pool_grade` specifically is also
# reused by team_arena/engine.py (its own copy was missing the
# out-of-range guard this shared version has). Imported above so existing
# call sites in this file (and `engine.resolve_pool_grade(...)` from
# tests/monkeypatches) keep working unchanged.
# ---------------------------------------------------------------------------


def require_classroom_membership(db: Session, classroom_id: int, student_id: int) -> None:
    """Every id a caller supplies in a path/body/query must be bound to the
    caller — a student may only tag a PK queue/invite/match with a
    classroom_id they are actually enrolled in (prevents polluting another
    classroom's PRD §3.2 activity stats, and prevents bypassing the
    same-class matching restriction by lying about classroom_id)."""
    member = (
        db.query(ClassroomStudent.id)
        .filter(ClassroomStudent.classroom_id == classroom_id, ClassroomStudent.student_id == student_id)
        .first()
    )
    if member is None:
        raise HTTPException(status_code=403, detail="You are not a member of this classroom")


def require_pk_human_enabled(db: Session, classroom_id: int) -> None:
    """PRD §7.4 (2026-10-16 revision): 真人 PK (classmate matching + invite
    codes) is gated per classroom, default OFF. Enforced on every human-PK
    entry path (matchmaking.create_queue_entry / create_invite /
    redeem_invite) — not just at creation time, so a teacher flipping the
    switch off mid-session also blocks a pending invite redemption.
    Deliberately does NOT gate AI PK (挑戰文學家) at all — Young 2026-10-16:
    "AI PK 跟班級無關"."""
    classroom = db.query(Classroom).filter(Classroom.id == classroom_id).first()
    if classroom is None:
        raise HTTPException(status_code=404, detail="Classroom not found")
    if not classroom_features.get_classroom_feature(classroom, "pk_human"):
        raise HTTPException(
            status_code=403,
            detail="老師還沒開放這個班級的真人 PK 對戰",
        )


def get_classroom_pk_activity(db: Session, classroom_id: int) -> dict:
    """PRD §3.2: "本週打了幾場、誰還沒打過、不看個別對戰內容" — aggregate
    counts only, never a match's rounds/answers."""
    students = (
        db.query(ClassroomStudent.student_id, User.name)
        .join(User, User.id == ClassroomStudent.student_id)
        .filter(ClassroomStudent.classroom_id == classroom_id)
        .all()
    )
    matches_count = db.query(PkMatch).filter(PkMatch.classroom_id == classroom_id).count()
    participants = {
        row[0]
        for row in db.query(PkMatch.side_a_user_id).filter(PkMatch.classroom_id == classroom_id).all()
    } | {
        row[0]
        for row in db.query(PkMatch.side_b_user_id)
        .filter(PkMatch.classroom_id == classroom_id, PkMatch.side_b_user_id.isnot(None))
        .all()
    }
    return {
        "classroom_id": classroom_id,
        "matches_count": matches_count,
        "students": [
            {"student_id": sid, "name": name, "has_participated": sid in participants}
            for sid, name in students
        ],
    }


# ---------------------------------------------------------------------------
# Match creation
# ---------------------------------------------------------------------------

def create_human_match(
    db: Session,
    side_a: User,
    side_b: User,
    *,
    scope_type: str,
    scope_ref: str,
    classroom_id: int | None,
) -> PkMatch:
    lessons = _load_lessons_for_scope(scope_type, scope_ref)
    seed = secrets.randbelow(2**31)
    rng = random.Random(seed)
    rounds = build_pk_rounds(lessons, rng, rounds_per_match=ROUNDS_PER_MATCH)

    rating_a = get_or_create_rating(db, side_a.id)
    rating_b = get_or_create_rating(db, side_b.id)

    match = PkMatch(
        side_a_user_id=side_a.id,
        side_b_user_id=side_b.id,
        side_b_bot_tier=None,
        classroom_id=classroom_id,
        scope_type=scope_type,
        scope_ref=scope_ref,
        rounds_snapshot=rounds,
        seed=seed,
        current_round_index=0,
        # Deliberately NOT _now(): PRD §10.1 "絕不卡住對戰...不算進 §4 的
        # 5 題約 2 分鐘預算" — the VS screen (and, for an AI opponent, the
        # figure intro) play BEFORE the student ever calls build_match_state
        # for real. Starting the clock here would burn into round 1's 20s
        # while they watch an un-skipped 10-15s intro. advance_if_needed()
        # lazily stamps this the first time the match is actually polled —
        # see its docstring.
        current_round_started_at=None,
        side_a_answers=[],
        side_b_answers=[],
        side_a_rating_before=rating_a.rating,
        side_b_rating_before=rating_b.rating,
        status="active",
        version=1,
    )
    db.add(match)
    db.commit()
    db.refresh(match)
    return match


def create_ai_match(
    db: Session,
    student: User,
    *,
    scope_type: str,
    scope_ref: str,
    bot_tier: int,
    classroom_id: int | None = None,
) -> PkMatch:
    tier = ai_tiers.get_tier(bot_tier)  # raises ValueError -> caller 422s
    lessons = _load_lessons_for_scope(scope_type, scope_ref)
    seed = secrets.randbelow(2**31)
    rng = random.Random(seed)
    rounds = build_pk_rounds(lessons, rng, rounds_per_match=ROUNDS_PER_MATCH)

    # PRD §5.1: AI answers are a SOURCE, scored by the exact same rule real
    # players use (scoring.score_pk_answer) — precomputed in full up front
    # since the AI never "waits" to be polled (it isn't a second live party).
    side_b_answers = []
    side_b_score = 0
    for round_def in rounds:
        sample = ai_tiers.sample_ai_answer(bot_tier, round_def["payload"], rng)
        is_correct, points = scoring.score_pk_answer(round_def["payload"], sample["choice_key"])
        side_b_score += points
        side_b_answers.append(
            {
                "round_index": round_def["round_index"],
                "choice_key": sample["choice_key"],
                "is_correct": is_correct,
                "points": points,
                "elapsed_ms": sample["elapsed_ms"],
            }
        )

    rating_a = get_or_create_rating(db, student.id)

    match = PkMatch(
        side_a_user_id=student.id,
        side_b_user_id=None,
        side_b_bot_tier=bot_tier,
        classroom_id=classroom_id,
        scope_type=scope_type,
        scope_ref=scope_ref,
        rounds_snapshot=rounds,
        seed=seed,
        current_round_index=0,
        current_round_started_at=None,  # see create_human_match's comment above
        side_a_answers=[],
        side_b_answers=side_b_answers,
        side_b_score=side_b_score,
        side_a_rating_before=rating_a.rating,
        side_b_rating_before=tier.virtual_rating,
        status="active",
        version=1,
    )
    db.add(match)
    db.commit()
    db.refresh(match)
    return match


# ---------------------------------------------------------------------------
# Lookup / authz
# ---------------------------------------------------------------------------

def get_match_for_user(db: Session, match_id: int, user: User) -> PkMatch:
    match = db.query(PkMatch).filter(PkMatch.id == match_id).first()
    if match is None:
        raise HTTPException(status_code=404, detail="Match not found")
    if user.id not in (match.side_a_user_id, match.side_b_user_id):
        raise HTTPException(status_code=403, detail="You are not a participant in this match")
    return match


def is_authenticated_match_participant(db: Session, match_id: int, user_id: int) -> bool:
    """Cheap, read-only check keyed by raw id — what
    ``GlobalRateLimitMiddleware`` (pure ASGI, no FastAPI ``Depends``) calls
    to decide whether to exempt a ``/state``/``/answer`` poll from the
    per-IP limit (same shape as live_quiz.engine.is_authenticated_member_by_code).
    No side effects (no ``advance_if_needed``) on purpose: middleware must
    never write to the DB on a hot polling path."""
    from sqlalchemy import or_

    return (
        db.query(PkMatch.id)
        .filter(
            PkMatch.id == match_id,
            or_(PkMatch.side_a_user_id == user_id, PkMatch.side_b_user_id == user_id),
        )
        .first()
        is not None
    )


def _side_for_user(match: PkMatch, user_id: int) -> str:
    if user_id == match.side_a_user_id:
        return "a"
    if user_id == match.side_b_user_id:
        return "b"
    raise HTTPException(status_code=403, detail="You are not a participant in this match")


# ---------------------------------------------------------------------------
# Lazy round-advance state machine
# ---------------------------------------------------------------------------

def _answers_for(match: PkMatch, side: str) -> list[dict]:
    return match.side_a_answers if side == "a" else match.side_b_answers


def _has_answered(match: PkMatch, side: str, round_index: int) -> bool:
    return any(a["round_index"] == round_index for a in _answers_for(match, side))


def _is_ai_match(match: PkMatch) -> bool:
    return match.side_b_bot_tier is not None


def _outcome_side(match: PkMatch) -> str:
    """"a" | "b" | "draw" — recomputed from the match's own stored
    scores/answer-timing rather than trusted from ``winner_user_id``.

    #3602 B3: ``winner_user_id`` cannot represent "side b won" when side b
    is an AI opponent — ``_finalize_match`` sets it to ``side_b_user_id``,
    which is always None for an AI match (there is no user to point at).
    That makes "AI won" and "true draw" both read back as
    ``winner_user_id is None``, so any caller that branches on
    ``winner_user_id`` alone (the old ``get_match_result`` /
    ``build_match_state`` / ``list_history`` all did) reports the student's
    loss-to-the-AI as a draw.

    ``decide_winner`` is a pure function of scores + total time, both of
    which are already persisted on the row — recomputing it here needs no
    migration and is guaranteed consistent with what ``_finalize_match``
    decided originally (same inputs, same function)."""
    rounds_total = len(match.rounds_snapshot)
    side_a_time = scoring.total_time_ms(match.side_a_answers, rounds_total=rounds_total, limit_ms=LIMIT_MS)
    side_b_time = scoring.total_time_ms(match.side_b_answers, rounds_total=rounds_total, limit_ms=LIMIT_MS)
    return scoring.decide_winner(
        side_a_score=match.side_a_score,
        side_b_score=match.side_b_score,
        side_a_total_time_ms=side_a_time,
        side_b_total_time_ms=side_b_time,
    )


def _outcome_for_user(match: PkMatch, user_id: int) -> str:
    """"win" | "loss" | "draw" from ``user_id``'s perspective — see
    ``_outcome_side`` for why this does not read ``winner_user_id``."""
    side_outcome = _outcome_side(match)
    if side_outcome == "draw":
        return "draw"
    my_side = "a" if user_id == match.side_a_user_id else "b"
    return "win" if side_outcome == my_side else "loss"


def _revealed_score(match: PkMatch, side: str) -> int:
    """Sum of ``side``'s points for rounds that have actually been revealed
    (strictly-earlier rounds, plus the current round once it is revealing)
    — never the raw running total.

    #3602 B2: an AI opponent's full 5-round score is computed and stored on
    ``side_b_score`` at match CREATION time (it never "waits" to be
    polled), so reading that column directly for ``opponent_score`` leaked
    the AI's final total from round 1. This closes the same narrow leak on
    the human side too: ``submit_match_answer`` bumps the running score the
    instant a side submits, which can be before the round has actually
    entered its reveal phase for the OTHER side that hasn't answered yet."""
    idx = match.current_round_index
    revealed_through = idx if match.reveal_started_at is not None else idx - 1
    return sum(a["points"] for a in _answers_for(match, side) if a["round_index"] <= revealed_through)


def _ai_expression(match: PkMatch, round_view: dict | None, revealing: bool) -> str | None:
    """PRD §10.5.3 event -> expression table. None for a human match (no
    figure to react, §8.2). Priority when a round reveals with both sides'
    results known (table doesn't define this overlap explicitly): the AI's
    own result wins (it reacts to itself first) over being impressed by the
    opponent, which only shows when the AI itself got it wrong."""
    if not _is_ai_match(match):
        return None
    if match.status == "completed":
        side_outcome = _outcome_side(match)
        if side_outcome == "b":
            return "victory"
        if side_outcome == "a":
            return "defeat"
        return "idle"  # draw has no dedicated expression in §10.5.3
    if round_view is None:
        return "idle"
    if not revealing:
        return "thinking"
    ai_correct = bool(round_view.get("opponent_is_correct"))
    my_choice = round_view.get("my_choice_key")
    my_correct = my_choice is not None and my_choice == round_view.get("correct_key")
    if ai_correct:
        return "happy"
    if my_correct:
        return "impressed"
    return "frustrated"


def _finalize_match(db: Session, match: PkMatch) -> None:
    rounds_total = len(match.rounds_snapshot)
    side_a_time = scoring.total_time_ms(match.side_a_answers, rounds_total=rounds_total, limit_ms=LIMIT_MS)
    side_b_time = scoring.total_time_ms(match.side_b_answers, rounds_total=rounds_total, limit_ms=LIMIT_MS)
    outcome = scoring.decide_winner(
        side_a_score=match.side_a_score,
        side_b_score=match.side_b_score,
        side_a_total_time_ms=side_a_time,
        side_b_total_time_ms=side_b_time,
    )
    match.winner_user_id = {
        "a": match.side_a_user_id,
        "b": match.side_b_user_id,  # None for an AI match -- correct: AI can't "win" a user id
        "draw": None,
    }[outcome]

    # PRD §4: "平手對積分的影響：不調整積分" — only update ratings on a decisive result.
    if outcome != "draw":
        rating_a_row = get_or_create_rating(db, match.side_a_user_id)
        score_a = 1.0 if outcome == "a" else 0.0
        match.side_a_rating_after = rating_service.update_rating(
            match.side_a_rating_before, match.side_b_rating_before, score=score_a
        )
        rating_a_row.rating = match.side_a_rating_after
        rating_a_row.matches_played += 1
        if outcome == "a":
            rating_a_row.wins += 1
        else:
            rating_a_row.losses += 1

        if not _is_ai_match(match):
            rating_b_row = get_or_create_rating(db, match.side_b_user_id)
            score_b = 1.0 - score_a
            match.side_b_rating_after = rating_service.update_rating(
                match.side_b_rating_before, match.side_a_rating_before, score=score_b
            )
            rating_b_row.rating = match.side_b_rating_after
            rating_b_row.matches_played += 1
            if outcome == "b":
                rating_b_row.wins += 1
            else:
                rating_b_row.losses += 1
        else:
            # AI "rating" is just the tier's virtual rating snapshot (PRD
            # §7.2) — it is never written to any PkRating row.
            match.side_b_rating_after = match.side_b_rating_before
    else:
        match.side_a_rating_after = match.side_a_rating_before
        match.side_b_rating_after = match.side_b_rating_before
        rating_a_row = get_or_create_rating(db, match.side_a_user_id)
        rating_a_row.matches_played += 1
        rating_a_row.draws += 1
        if not _is_ai_match(match):
            rating_b_row = get_or_create_rating(db, match.side_b_user_id)
            rating_b_row.matches_played += 1
            rating_b_row.draws += 1

    match.status = "completed"
    match.completed_at = _now()


def advance_if_needed(db: Session, match: PkMatch) -> None:
    if match.status != "active":
        return
    now = _now()
    rounds_total = len(match.rounds_snapshot)
    idx = match.current_round_index
    started_at = _aware(match.current_round_started_at)
    reveal_started_at = _aware(match.reveal_started_at)
    changed = False

    # Lazy round-1 start ONLY (PRD §10.1/§9.2 "絕不卡住對戰"): create_human_match/
    # create_ai_match leave current_round_started_at as None so the VS
    # screen -- and, for an AI opponent, the figure intro -- can run before
    # round 1 without eating into its 20s window. The clock starts the
    # first time this match is actually touched for real (a poll or an
    # answer) after creation. Rounds 2-5 are different: the transition
    # further down in this function sets current_round_started_at to `now`
    # directly (never back to None), because by then the student is already
    # continuously polling inside the battle screen -- there is no second
    # intro screen between rounds to wait out.
    if match.current_round_started_at is None:
        match.current_round_started_at = now
        match.version += 1
        changed = True
        started_at = now

    while match.status == "active":
        idx = match.current_round_index
        started_at = _aware(match.current_round_started_at)
        reveal_started_at = _aware(match.reveal_started_at)

        if reveal_started_at is None:
            both_answered = _has_answered(match, "a", idx) and _has_answered(match, "b", idx)
            window_elapsed = started_at is not None and now >= started_at + timedelta(
                milliseconds=LIMIT_MS
            )
            if not (both_answered or window_elapsed):
                break  # still within the live answer window — nothing to do

            # Window closed (or both answered) — backfill a 0-point "no
            # answer" entry for whichever side never submitted, so every
            # completed match has a full, displayable per-round record
            # (PRD §3.1 step 7 "每題對錯").
            round_def = match.rounds_snapshot[idx]
            for side in ("a", "b"):
                if not _has_answered(match, side, idx):
                    entry = {
                        "round_index": idx,
                        "choice_key": None,
                        "is_correct": False,
                        "points": 0,
                        "elapsed_ms": LIMIT_MS,
                    }
                    if side == "a":
                        match.side_a_answers = [*match.side_a_answers, entry]
                    else:
                        match.side_b_answers = [*match.side_b_answers, entry]
            match.reveal_started_at = now
            match.version += 1
            changed = True
            continue  # loop again to check if reveal has also already elapsed

        if now < reveal_started_at + timedelta(seconds=REVEAL_SECONDS):
            break  # still showing the reveal for this round

        if idx >= rounds_total - 1:
            _finalize_match(db, match)
            match.version += 1
            changed = True
            break

        match.current_round_index = idx + 1
        match.current_round_started_at = now
        match.reveal_started_at = None
        match.version += 1
        changed = True

    if changed:
        db.commit()
        db.refresh(match)


# ---------------------------------------------------------------------------
# Answering
# ---------------------------------------------------------------------------

def submit_match_answer(db: Session, match: PkMatch, user: User, choice_key: str | None) -> dict:
    advance_if_needed(db, match)
    if match.status != "active":
        raise HTTPException(status_code=409, detail="This match has already ended")

    side = _side_for_user(match, user.id)
    if side == "b" and _is_ai_match(match):
        raise HTTPException(status_code=403, detail="The AI opponent answers on its own")

    idx = match.current_round_index
    if match.reveal_started_at is not None:
        raise HTTPException(status_code=409, detail="This round is already being revealed")
    if _has_answered(match, side, idx):
        raise HTTPException(status_code=409, detail="You already answered this round")

    started_at = _aware(match.current_round_started_at)
    now = _now()
    # CTO review #1 (PRD §17): elapsed_ms is ALWAYS server-computed —
    # the request body carries no timing field at all (see schemas/pk.py).
    elapsed_ms = int((now - started_at).total_seconds() * 1000) if started_at else 0
    elapsed_ms = max(0, min(elapsed_ms, LIMIT_MS))

    round_def = match.rounds_snapshot[idx]
    is_correct, points = scoring.score_pk_answer(round_def["payload"], choice_key)
    entry = {
        "round_index": idx,
        "choice_key": choice_key,
        "is_correct": is_correct,
        "points": points,
        "elapsed_ms": elapsed_ms,
    }
    if side == "a":
        match.side_a_answers = [*match.side_a_answers, entry]
        match.side_a_score += points
    else:
        match.side_b_answers = [*match.side_b_answers, entry]
        match.side_b_score += points
    match.version += 1
    db.commit()
    db.refresh(match)

    advance_if_needed(db, match)  # may immediately reveal if the other side already answered
    return {"round_index": idx, "is_correct": is_correct, "points": points}


# ---------------------------------------------------------------------------
# Role-aware state (polling)
# ---------------------------------------------------------------------------

def build_match_state(db: Session, match: PkMatch, user: User) -> dict:
    advance_if_needed(db, match)
    side = _side_for_user(match, user.id)
    my_answers = _answers_for(match, side)
    opp_answers = match.side_b_answers if side == "a" else match.side_a_answers
    rounds_total = len(match.rounds_snapshot)
    idx = match.current_round_index
    revealing = match.reveal_started_at is not None

    round_view = None
    if 0 <= idx < rounds_total:
        payload = dict(match.rounds_snapshot[idx]["payload"])
        # Answer stripping (PRD §6.1, reusing player_view's posture): never
        # ship the correct key, and never ship the OPPONENT's choice, before
        # this round is actually in its reveal phase.
        view = {
            "item_id": payload.get("item_id"),
            "source_module": payload.get("source_module"),
            "lesson_title": payload.get("lesson_title"),
            "stem": payload.get("stem"),
            "options": payload.get("options"),
            "seconds": payload.get("seconds"),
            "extra": payload.get("extra"),
        }
        my_entry = next((a for a in my_answers if a["round_index"] == idx), None)
        if revealing:
            view["correct_key"] = payload.get("correct_key")
            opp_entry = next((a for a in opp_answers if a["round_index"] == idx), None)
            view["opponent_choice_key"] = opp_entry["choice_key"] if opp_entry else None
            view["opponent_is_correct"] = opp_entry["is_correct"] if opp_entry else False
        view["my_choice_key"] = my_entry["choice_key"] if my_entry else None
        view["my_answered"] = my_entry is not None
        round_view = view

    opponent_label = (
        "AI" if _is_ai_match(match) else "player"
    )

    my_user = match.side_a_user if side == "a" else match.side_b_user
    opponent_user = None if _is_ai_match(match) else (match.side_b_user if side == "a" else match.side_a_user)
    # issue #3663 round 3 (#3672): PK previously had NO "學生N" fallback at
    # all here (`my_user.name if my_user else None` showed a blank/None
    # name for a student with no profile name set, unlike live_quiz/
    # team_arena). PK has no join-order counter to reuse (it's always
    # exactly two sides) — side 'a' is a fixed seat 1, side 'b' seat 2,
    # same shared `game_core.display_name` policy as the other two modes.
    my_seat = 1 if side == "a" else 2
    opponent_seat = 2 if side == "a" else 1

    state = {
        "match_id": match.id,
        "status": match.status,
        "version": match.version,
        "server_now": _now().isoformat(),
        "round_index": idx,
        "rounds_total": rounds_total,
        "revealing": revealing,
        "round_started_at": _aware(match.current_round_started_at).isoformat()
        if match.current_round_started_at
        else None,
        "seconds": ANSWER_SECONDS,
        "round": round_view,
        "my_name": resolve_display_name(my_user.name, my_seat) if my_user else None,
        "opponent_name": resolve_display_name(opponent_user.name, opponent_seat) if opponent_user else None,
        "my_score": match.side_a_score if side == "a" else match.side_b_score,
        # #3602 B2: never the raw running total — an AI opponent's is fully
        # precomputed at creation (see create_ai_match), so reading
        # side_b_score directly would show the AI's final 5-round score
        # from round 1. _revealed_score only counts rounds that have
        # actually revealed, which also happens to close a narrower version
        # of the same leak on the human side (see its docstring).
        "opponent_score": _revealed_score(match, "b" if side == "a" else "a"),
        "opponent_type": opponent_label,
        "bot_tier": match.side_b_bot_tier if (_is_ai_match(match)) else None,
        "suggest_ai": False,
        # #3602 B6 / PRD §11 "AI 對戰時附帶當前應顯示的人物表情": None for a
        # human match.
        "ai_expression": _ai_expression(match, round_view, revealing),
    }
    if match.status == "completed":
        # #3602 B3: recomputed from scores/time, not match.winner_user_id
        # (which is None both for a true draw AND for an AI win — see
        # _outcome_side's docstring).
        side_outcome = _outcome_side(match)
        if side_outcome == "draw":
            state["winner_side"] = "draw"
        else:
            state["winner_side"] = "me" if side_outcome == side else "opponent"
    return state


def get_match_result(db: Session, match: PkMatch, user: User) -> dict:
    side = _side_for_user(match, user.id)
    advance_if_needed(db, match)
    if match.status != "completed":
        raise HTTPException(status_code=409, detail="This match has not finished yet")

    my_answers = match.side_a_answers if side == "a" else match.side_b_answers
    opp_answers = match.side_b_answers if side == "a" else match.side_a_answers
    my_score = match.side_a_score if side == "a" else match.side_b_score
    opp_score = match.side_b_score if side == "a" else match.side_a_score
    my_rating_before = match.side_a_rating_before if side == "a" else match.side_b_rating_before
    my_rating_after = match.side_a_rating_after if side == "a" else match.side_b_rating_after

    # #3602 B3: recomputed, not read off match.winner_user_id — see
    # _outcome_side's docstring for why that column alone conflates an AI
    # win with a true draw.
    outcome = _outcome_for_user(match, user.id)

    rounds = []
    for i, round_def in enumerate(match.rounds_snapshot):
        payload = round_def["payload"]
        my_entry = next((a for a in my_answers if a["round_index"] == i), None)
        opp_entry = next((a for a in opp_answers if a["round_index"] == i), None)
        rounds.append(
            {
                "round_index": i,
                "stem": payload.get("stem"),
                "options": payload.get("options"),
                "correct_key": payload.get("correct_key"),
                "my_choice_key": my_entry["choice_key"] if my_entry else None,
                "my_is_correct": my_entry["is_correct"] if my_entry else False,
                "opponent_choice_key": opp_entry["choice_key"] if opp_entry else None,
                "opponent_is_correct": opp_entry["is_correct"] if opp_entry else False,
            }
        )

    newly_unlocked = None
    if _is_ai_match(match) and outcome == "win":
        already_won_before = _unlocked_tiers_excluding(db, user.id, exclude_match_id=match.id)
        if match.side_b_bot_tier not in already_won_before:
            newly_unlocked = match.side_b_bot_tier

    return {
        "match_id": match.id,
        "outcome": outcome,
        "my_score": my_score,
        "opponent_score": opp_score,
        "opponent_type": "AI" if _is_ai_match(match) else "player",
        "bot_tier": match.side_b_bot_tier,
        "rating_before": my_rating_before,
        "rating_after": my_rating_after,
        "rounds": rounds,
        "newly_unlocked_tier": newly_unlocked,
    }


# ---------------------------------------------------------------------------
# History / opponents (PRD §7.2 "贏過的人物是查詢，不是新表")
# ---------------------------------------------------------------------------

def _unlocked_tiers_excluding(db: Session, student_id: int, *, exclude_match_id: int | None = None) -> set[int]:
    q = db.query(PkMatch.side_b_bot_tier).filter(
        PkMatch.winner_user_id == student_id, PkMatch.side_b_bot_tier.isnot(None)
    )
    if exclude_match_id is not None:
        q = q.filter(PkMatch.id != exclude_match_id)
    return {row[0] for row in q.all()}


def get_unlocked_tiers(db: Session, student_id: int) -> set[int]:
    return _unlocked_tiers_excluding(db, student_id)


def get_played_tiers(db: Session, student_id: int) -> set[int]:
    """PRD §10.2: "第一次遇到某個人物...查 pk_matches 歷史有沒有這個
    side_b_bot_tier" — ANY completed match against that tier, regardless of
    win/loss (distinct from get_unlocked_tiers, which is win-only and drives
    the figure-card unlock, not the intro-animation length)."""
    rows = (
        db.query(PkMatch.side_b_bot_tier)
        .filter(
            PkMatch.side_b_bot_tier.isnot(None),
            PkMatch.side_a_user_id == student_id,
            PkMatch.status == "completed",
        )
        .all()
    )
    return {row[0] for row in rows}


def get_opponents_view(db: Session, user: User) -> dict:
    rating = get_or_create_rating(db, user.id)
    recommended = ai_tiers.recommend_tier(rating.rating)
    unlocked = get_unlocked_tiers(db, user.id)
    played = get_played_tiers(db, user.id)
    return {
        "opponents": [
            {
                "tier": t.tier,
                "slug": t.slug,
                "name": t.name,
                "speed_label": t.speed_label,
                "icon_url": f"{PK_FIGURE_ASSET_BASE}/{t.tier}-{t.slug}/icon.svg",
                "portrait_url": f"{PK_FIGURE_ASSET_BASE}/{t.tier}-{t.slug}/portrait-idle.svg",
                "recommended": t.tier == recommended.tier,
                "unlocked": t.tier in unlocked,
                "previously_played": t.tier in played,
            }
            for t in ai_tiers.TIERS
        ]
    }


def get_rating_view(db: Session, user: User) -> dict:
    rating = get_or_create_rating(db, user.id)
    return {
        "rating": rating.rating,
        "matches_played": rating.matches_played,
        "wins": rating.wins,
        "losses": rating.losses,
        "draws": rating.draws,
    }


def list_history(db: Session, user: User) -> list[dict]:
    matches = (
        db.query(PkMatch)
        .filter((PkMatch.side_a_user_id == user.id) | (PkMatch.side_b_user_id == user.id))
        .order_by(PkMatch.started_at.desc())
        .all()
    )
    out = []
    for m in matches:
        side = "a" if m.side_a_user_id == user.id else "b"
        my_score = m.side_a_score if side == "a" else m.side_b_score
        opp_score = m.side_b_score if side == "a" else m.side_a_score
        # #3602 B3: same recomputation as get_match_result — see
        # _outcome_side's docstring.
        outcome = None if m.status != "completed" else _outcome_for_user(m, user.id)
        out.append(
            {
                "match_id": m.id,
                "status": m.status,
                "opponent_type": "AI" if m.side_b_bot_tier is not None else "player",
                "bot_tier": m.side_b_bot_tier,
                "my_score": my_score,
                "opponent_score": opp_score,
                "outcome": outcome,
                "started_at": m.started_at.isoformat(),
                "completed_at": m.completed_at.isoformat() if m.completed_at else None,
            }
        )
    return out
