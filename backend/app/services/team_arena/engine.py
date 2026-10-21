"""多人對抗賽遊戲引擎 (DB-aware) — v2, PRD docs/prd/2026-10-18-team-arena-
prd.md §0 "⭐ v2 改版", issue #3632.

v2 replaces v1's whole "老師開場、四條路線、一場含多個並行對戰" model with
a much simpler shape every room now follows:

  - Any STUDENT hosts a room (no classroom, no teacher) — rule A/B.
  - Exactly ONE match per room: two sides ("a"/"b"), 2-5 players each,
    both sides must be FULL before the host can start — rule C.
  - Every turn, EVERY member rotates through in join order; the question
    each turn may be ANY of the four source types mixed together — no
    lane assignment at all — rule D.
  - One shared track per side: 3 towers then a base (services/team_arena/
    towers.py) instead of v1's four-lane map — rule L.
  - Three one-time-per-game weapons (services/team_arena/weapons.py) —
    rule F/G/I/J. 呼叫隊友 additionally needs this module's own state
    (which teammate suggested what) — rule H.

Independent module (PRD §7 "依賴方向", unchanged by v2): reads
`live_quiz`'s question-source adapters, `round_types/choice.py
::generate_rounds`, and `live_quiz.reading_pace` one-way (explicitly
sanctioned reuse), and never imports `pk`/`league`/`escape_room`
internals.

Lazy, no-cron state machine (same "輪詢時順便檢查" principle PK/live_quiz
already established): the only two call sites that can move a turn
forward (`get_state` and `submit_answer`/`use_weapon`/`submit_suggestion`)
all run `_advance_if_needed` first.
"""
from __future__ import annotations

import random
import secrets
from datetime import datetime, timezone

from fastapi import HTTPException
from sqlalchemy.orm import Session
from sqlalchemy.orm.attributes import flag_modified

from ...models.school import Classroom, ClassroomStudent
from ...models.team_arena import TeamArenaAnswer, TeamArenaMember, TeamArenaSession
from ...models.user import User
from ...services.lesson_loader import get_available_grades, search_lessons
from ...services.lesson_uid_loader import load_lesson
from ..live_quiz import reading_pace
from ..live_quiz.round_types import choice as live_quiz_choice
from . import towers
from . import weapons as weapons_mod
from .story_adapter import resolve_story_for_session
from .teams import COLUMN_TO_SIDE, SIDE_KEYS, SIDE_TO_COLUMN, TEAM_SIZE_CHOICES
from .weapons import WEAPON_KEYS

TURNS_PER_PLAYER_CHOICES = (1, 2, 3)
ANSWER_SECONDS_CHOICES = (20, 30, 45)
# PRD §3.5 (unchanged by v2): "揭曉：4 秒".
REVEAL_SECONDS = 4
# Every v2 member row writes this fixed value into the now-unused `lane`
# column — see models/team_arena.py module docstring. Chosen because it is
# the one value among the existing CHECK constraint's five that never
# claimed to be a real question-type lane.
_FIXED_LANE = "support"
# PRD §0 v2 rule D: "每一題可能是任何題型...混出" — every member draws from
# ALL FOUR source modules combined, never a single lane.
_ALL_SOURCE_MODULES = ("zhuyin", "vocab_definitions", "vocab_application", "comprehension")

_CODE_LENGTH = 6
# Same confusable-avoiding alphabet pk/matchmaking.py uses for invite codes
# (excludes 0/O and 1/I).
_CODE_CHARS = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ"
_MAX_CODE_RETRIES = 10

_ERR_UNKNOWN_GRADE = "找不到這個年級的題庫，請聯絡老師確認年級設定"
_ERR_EMPTY_POOL = "這個年級目前還沒有題目，請改天再試"
_ERR_NO_GRADE = "找不到你的年級，請先加入班級或請老師設定年級後再開房"


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _aware(dt: datetime | None) -> datetime | None:
    """Same SQLite-naive-datetime guard every other engine in this repo
    uses — every write here only ever stores UTC via `_now()`."""
    if dt is not None and dt.tzinfo is None:
        return dt.replace(tzinfo=timezone.utc)
    return dt


def _bump_version(session: TeamArenaSession) -> None:
    session.state_version += 1


def _new_weapons_used() -> dict[str, bool]:
    return {k: False for k in WEAPON_KEYS}


def _new_side_cache() -> dict:
    return {
        "towers_destroyed": 0,
        "current_hp": towers.STRUCTURE_HP,
        "base_destroyed": False,
        "match_status": "active",
        "winner": None,
        "current_round": None,
    }


def _display_name(member: TeamArenaMember) -> str:
    """PRD §0 v2 rule M (unchanged from the pre-existing #3630 rule):
    other students only ever see a display name, never school/class/
    email — and a blank/missing name falls back to "學生N" (N = this
    member's 1-based rotation position), same fallback shape
    live_quiz.engine's own `anonymous_display_name` already uses."""
    student = member.student
    name = (student.name or "").strip() if student is not None else ""
    return name or f"學生{member.rotation_order + 1}"


def _name_for_viewer(member: TeamArenaMember, side_key: str, index: int, viewer_side: str | None) -> str:
    """Real display names only for the viewer's OWN team. Anyone with the
    6-char code can join from any school, so the other team (and anyone
    not seated) sees a neutral seat label instead of a minor's real name
    (security review 2026-10-21)."""
    if viewer_side == side_key:
        return _display_name(member)
    return f"{'甲' if side_key == 'a' else '乙'}隊 {index + 1} 號"


# ---------------------------------------------------------------------------
# Grade pool resolution (host's OWN grade — PRD rule K, no teacher choice)
# ---------------------------------------------------------------------------

def resolve_pool_grade(scope_ref: str) -> str:
    available = [str(g) for g in get_available_grades()]
    if scope_ref in available:
        return scope_ref
    try:
        wanted = int(scope_ref)
    except (TypeError, ValueError):
        raise HTTPException(status_code=400, detail=_ERR_UNKNOWN_GRADE)
    numeric = sorted(int(g) for g in available if g.isdigit())
    if not numeric:
        raise HTTPException(status_code=400, detail=_ERR_EMPTY_POOL)
    return str(min(numeric, key=lambda g: (abs(g - wanted), -g)))


def _resolve_host_grade(db: Session, user: User) -> str:
    """PRD §0 v2 rule K: "出題範圍：開房學生的年級題庫" — there is no
    teacher choosing a scope anymore, so the host's OWN grade is the only
    input. Grade lives on `StudentProfile.grade` (#3602 B1 precedent); a
    student who joined via a classroom code but has no StudentProfile row
    (or one with no grade set) falls back to any classroom they're
    enrolled in that itself has a grade — the common case for a
    self-registered or CSV-imported student. Raises 400 (not a guess) when
    neither resolves, rather than defaulting to an arbitrary grade."""
    profile = getattr(user, "student_profile", None)
    if profile is not None and profile.grade is not None:
        return str(profile.grade)
    row = (
        db.query(Classroom.grade)
        .join(ClassroomStudent, ClassroomStudent.classroom_id == Classroom.id)
        .filter(ClassroomStudent.student_id == user.id, Classroom.grade.isnot(None))
        .order_by(ClassroomStudent.enrolled_at.desc())
        .first()
    )
    if row is not None and row[0] is not None:
        return str(row[0])
    raise HTTPException(status_code=400, detail=_ERR_NO_GRADE)


def _load_lessons_for_grade(grade: str) -> list[dict]:
    results = search_lessons(grade=grade)
    lessons = []
    for entry in results:
        uid = entry.get("lesson_uid")
        if not uid:
            continue
        lesson = load_lesson(uid)
        if lesson is not None:
            lessons.append({"lesson_uid": uid, "lesson": lesson})
    if not lessons:
        raise HTTPException(status_code=400, detail=_ERR_EMPTY_POOL)
    return lessons


# ---------------------------------------------------------------------------
# Session code
# ---------------------------------------------------------------------------

def _generate_code(db: Session) -> str:
    for _ in range(_MAX_CODE_RETRIES):
        code = "".join(secrets.choice(_CODE_CHARS) for _ in range(_CODE_LENGTH))
        clash = (
            db.query(TeamArenaSession.id)
            .filter(
                TeamArenaSession.code == code,
                TeamArenaSession.status.in_(("lobby", "playing", "paused")),
            )
            .first()
        )
        if clash is None:
            return code
    raise RuntimeError("Failed to generate a unique team_arena code after multiple retries")


def _get_session_by_code(db: Session, code: str) -> TeamArenaSession:
    """No status filter — a code is only reused once the OLD session
    holding it has ended, so `order_by(id.desc()).first()` always resolves
    to whichever session is actually "live" for that code right now."""
    session = (
        db.query(TeamArenaSession)
        .filter(TeamArenaSession.code == code.upper())
        .order_by(TeamArenaSession.id.desc())
        .first()
    )
    if session is None:
        raise HTTPException(status_code=404, detail="Session not found")
    return session


def get_session_by_code(db: Session, code: str) -> TeamArenaSession:
    """Public entry point for the route layer — the one place a raw
    path-param string gets resolved into a real session or a clean 404."""
    return _get_session_by_code(db, code)


def is_authenticated_session_member(db: Session, code: str, user_id: int) -> bool:
    """Cheap, read-only membership check keyed by CODE —
    `GlobalRateLimitMiddleware` (app/main.py) calls this to decide whether
    to exempt a `/state` or `/answer` request from the per-IP rate limit.
    No write side effect on purpose."""
    session = (
        db.query(TeamArenaSession)
        .filter(TeamArenaSession.code == code.upper())
        .order_by(TeamArenaSession.id.desc())
        .first()
    )
    if session is None:
        return False
    if session.teacher_id == user_id:
        return True
    return (
        db.query(TeamArenaMember.id)
        .filter(TeamArenaMember.session_id == session.id, TeamArenaMember.student_id == user_id)
        .first()
        is not None
    )


# ---------------------------------------------------------------------------
# Creation + join (PRD §0 v2 rule A/B/C — any student, no classroom)
# ---------------------------------------------------------------------------

def _seat_member(db: Session, session: TeamArenaSession, user: User, *, side: str) -> TeamArenaMember:
    side_idx = SIDE_TO_COLUMN[side]
    team_size = session.settings["team_size"]
    count = (
        db.query(TeamArenaMember)
        .filter(TeamArenaMember.session_id == session.id, TeamArenaMember.side == side_idx)
        .count()
    )
    if count >= team_size:
        raise HTTPException(status_code=409, detail="這隊已經滿了，請選另一隊")
    member = TeamArenaMember(
        session_id=session.id,
        student_id=user.id,
        match_no=0,
        side=side_idx,
        lane=_FIXED_LANE,
        rotation_order=count,
        grade_pool_override=False,
        question_queue={"queue": [], "weapons_used": _new_weapons_used()},
    )
    db.add(member)
    db.flush()
    return member


def create_session(
    db: Session,
    host: User,
    *,
    team_size: int = 5,
    turns_per_player: int = 2,
    answer_seconds: int = 30,
    story_pack_key: str | None = None,
    side: str = "a",
) -> TeamArenaSession:
    if team_size not in TEAM_SIZE_CHOICES:
        raise HTTPException(status_code=400, detail=f"team_size must be one of {TEAM_SIZE_CHOICES}")
    if turns_per_player not in TURNS_PER_PLAYER_CHOICES:
        raise HTTPException(status_code=400, detail=f"turns_per_player must be one of {TURNS_PER_PLAYER_CHOICES}")
    if answer_seconds not in ANSWER_SECONDS_CHOICES:
        raise HTTPException(status_code=400, detail=f"answer_seconds must be one of {ANSWER_SECONDS_CHOICES}")
    if side not in SIDE_KEYS:
        raise HTTPException(status_code=400, detail=f"side must be one of {SIDE_KEYS}")

    grade = resolve_pool_grade(_resolve_host_grade(db, host))

    code = _generate_code(db)
    session = TeamArenaSession(
        classroom_id=None,
        teacher_id=host.id,
        code=code,
        status="lobby",
        settings={
            "team_size": team_size,
            "turns_per_player": turns_per_player,
            "answer_seconds": answer_seconds,
            "story_pack_key": story_pack_key,
            "scope_ref": grade,
        },
        scoreboard={},
    )
    db.add(session)
    db.commit()
    db.refresh(session)
    _seat_member(db, session, host, side=side)
    db.commit()
    db.refresh(session)
    return session


def join_session(db: Session, student: User, code: str, *, side: str) -> TeamArenaSession:
    session = _get_session_by_code(db, code)

    existing = (
        db.query(TeamArenaMember)
        .filter(TeamArenaMember.session_id == session.id, TeamArenaMember.student_id == student.id)
        .first()
    )
    if existing is not None:
        # Rejoin (refresh, tablet slept) — let them back in regardless of
        # status/side, same "already seated -> idempotent" precedent v1
        # established for its roster (#3632 staging QA fix, commit
        # 79532cade).
        return session

    if session.status != "lobby":
        raise HTTPException(status_code=409, detail="本房已經開始，無法加入")
    if side not in SIDE_KEYS:
        raise HTTPException(status_code=400, detail=f"side must be one of {SIDE_KEYS}")

    _seat_member(db, session, student, side=side)
    _bump_version(session)
    db.commit()
    db.refresh(session)
    return session


# ---------------------------------------------------------------------------
# Lookups
# ---------------------------------------------------------------------------

def _get_member_by_student(db: Session, session_id: int, student_id: int) -> TeamArenaMember:
    member = (
        db.query(TeamArenaMember)
        .filter(TeamArenaMember.session_id == session_id, TeamArenaMember.student_id == student_id)
        .first()
    )
    if member is None:
        raise HTTPException(status_code=404, detail="你不在這場的名單裡")
    return member


def _team_members_for_side(db: Session, session_id: int, side_column: int) -> list[TeamArenaMember]:
    return (
        db.query(TeamArenaMember)
        .filter(TeamArenaMember.session_id == session_id, TeamArenaMember.side == side_column)
        .order_by(TeamArenaMember.rotation_order)
        .all()
    )


def _members_by_side(db: Session, session_id: int) -> dict[str, list[TeamArenaMember]]:
    out: dict[str, list[TeamArenaMember]] = {"a": [], "b": []}
    members = (
        db.query(TeamArenaMember)
        .filter(TeamArenaMember.session_id == session_id)
        .order_by(TeamArenaMember.rotation_order)
        .all()
    )
    for m in members:
        out[COLUMN_TO_SIDE[m.side]].append(m)
    return out


# ---------------------------------------------------------------------------
# Control (host only — PRD rule C: host is simply the student who created
# the room)
# ---------------------------------------------------------------------------

def control(db: Session, session: TeamArenaSession, user: User, *, action: str) -> TeamArenaSession:
    if session.teacher_id != user.id:
        raise HTTPException(status_code=403, detail="只有開房的人能控制這場")
    if action == "start":
        return _start(db, session)
    if action == "pause":
        if session.status != "playing":
            raise HTTPException(status_code=409, detail="只有進行中才能暫停")
        session.status = "paused"
        _bump_version(session)
        db.commit()
        db.refresh(session)
        return session
    if action == "resume":
        if session.status != "paused":
            raise HTTPException(status_code=409, detail="只有暫停中才能恢復")
        session.status = "playing"
        session.turn_started_at = _now()
        _bump_version(session)
        db.commit()
        db.refresh(session)
        return session
    if action == "next":
        if session.status != "playing":
            raise HTTPException(status_code=409, detail="只有進行中才能跳下一回合")
        _advance_if_needed(db, session, force=True)
        return session
    if action == "end":
        _end_session(db, session)
        _bump_version(session)
        db.commit()
        db.refresh(session)
        return session
    raise HTTPException(status_code=400, detail=f"Unknown control action: {action!r}")


def _start(db: Session, session: TeamArenaSession) -> TeamArenaSession:
    if session.status != "lobby":
        raise HTTPException(status_code=409, detail="只能在等待室開始")

    team_size = session.settings["team_size"]
    by_side = _members_by_side(db, session.id)
    # PRD §0 v2 rule C: "兩隊都滿額開房的人才能按開始".
    if len(by_side["a"]) != team_size or len(by_side["b"]) != team_size:
        raise HTTPException(status_code=409, detail="兩隊都滿額才能開始")

    turns_per_player = session.settings["turns_per_player"]
    answer_seconds = session.settings["answer_seconds"]
    total_turns = turns_per_player * team_size
    session.settings = {**session.settings, "total_turns": total_turns}
    flag_modified(session, "settings")

    lessons = _load_lessons_for_grade(session.settings["scope_ref"])

    all_members = by_side["a"] + by_side["b"]
    for member in all_members:
        rng = random.Random(f"{session.id}:{member.id}")
        gen_settings = {
            "source_modules": list(_ALL_SOURCE_MODULES),
            "question_count_mode": "all",
            "shuffle": True,
            "seconds": answer_seconds,
            "reading_pace": "standard",
        }
        rounds, _fallback = live_quiz_choice.generate_rounds(lessons, gen_settings, rng)
        if not rounds:
            raise HTTPException(status_code=400, detail=_ERR_EMPTY_POOL)
        take = [rounds[i % len(rounds)] for i in range(turns_per_player)]
        weapons_used = member.question_queue.get("weapons_used") or _new_weapons_used()
        member.question_queue = {"queue": take, "weapons_used": weapons_used}
        flag_modified(member, "question_queue")

    session.status = "playing"
    session.turn_no = 0
    session.turn_started_at = _now()
    session.scoreboard = {"sides": {"a": _new_side_cache(), "b": _new_side_cache()}}
    flag_modified(session, "scoreboard")
    _bump_version(session)
    db.commit()
    db.refresh(session)
    return session


# ---------------------------------------------------------------------------
# Turn resolution (lazy, no-cron)
# ---------------------------------------------------------------------------

def _ensure_current_round(
    db: Session, session: TeamArenaSession, side_key: str, team_members: list[TeamArenaMember]
) -> dict:
    side_cache = session.scoreboard["sides"][side_key]
    current = side_cache.get("current_round")
    if current is not None and current.get("turn_no") == session.turn_no:
        return current

    team_size = len(team_members)
    active = team_members[session.turn_no % team_size]
    lap = session.turn_no // team_size
    queue = active.question_queue.get("queue") or []
    entry = queue[lap % len(queue)] if queue else None
    if entry is None:
        # Defensive only — `_start` guarantees every member's queue has
        # exactly `turns_per_player` entries and `lap < turns_per_player`
        # always holds while `turn_no < total_turns`.
        raise HTTPException(status_code=500, detail="這位玩家沒有題目可以出，請聯絡老師")
    payload = entry["payload"]
    reading_seconds = reading_pace.compute_reading_seconds(payload.get("stem", ""), "standard")

    current = {
        "turn_no": session.turn_no,
        "active_member_id": active.id,
        "active_student_id": active.student_id,
        "payload": payload,
        "reading_seconds": reading_seconds,
        "answer_seconds": session.settings["answer_seconds"],
        "revealed": False,
        "weapon_used": None,
        "eliminated_options": None,
        "hint_text": None,
        # Computed once per round so the page can grey 看提示 out up front
        # (PRD rule J) instead of letting the student click into a 409
        # 「這題沒有提示」 (staging QA 2026-10-21).
        "hint_available": weapons_mod.build_hint(payload) is not None,
        "call_teammate_active": False,
    }
    side_cache["current_round"] = current
    flag_modified(session, "scoreboard")
    return current


def _match_over(session: TeamArenaSession) -> bool:
    sides = session.scoreboard.get("sides") or {}
    return bool(sides) and any(v.get("base_destroyed") for v in sides.values())


def _end_session(db: Session, session: TeamArenaSession) -> None:
    if session.status == "ended":
        return
    sides = session.scoreboard.get("sides", {})
    a, b = sides.get("a"), sides.get("b")
    if a is not None and b is not None and a.get("match_status") != "ended":
        state_a = towers.PathState(
            towers_destroyed=a["towers_destroyed"], current_hp=a["current_hp"], base_destroyed=a["base_destroyed"]
        )
        state_b = towers.PathState(
            towers_destroyed=b["towers_destroyed"], current_hp=b["current_hp"], base_destroyed=b["base_destroyed"]
        )
        winner = towers.decide_winner(state_a, state_b)
        a["match_status"] = "ended"
        b["match_status"] = "ended"
        a["winner"] = winner
        b["winner"] = winner
        flag_modified(session, "scoreboard")
    session.status = "ended"
    session.ended_at = _now()


def _advance_if_needed(db: Session, session: TeamArenaSession, *, force: bool = False) -> None:
    if session.status != "playing":
        return
    by_side = _members_by_side(db, session.id)
    total_turns = session.settings.get("total_turns")
    if not total_turns or not by_side["a"] or not by_side["b"]:
        return

    advanced = False
    while session.status == "playing":
        if _match_over(session):
            _end_session(db, session)
            break

        max_reading = reading_pace.MIN_READING_SECONDS
        for side_key, team_members in by_side.items():
            round_state = _ensure_current_round(db, session, side_key, team_members)
            max_reading = max(max_reading, round_state["reading_seconds"])

        answer_seconds = session.settings["answer_seconds"]
        reveal_start = max_reading + answer_seconds
        turn_end = reveal_start + REVEAL_SECONDS
        elapsed = (_now() - _aware(session.turn_started_at)).total_seconds()

        if not force and elapsed < reveal_start:
            break  # still reading or answering

        for side_key in by_side:
            round_state = session.scoreboard["sides"][side_key].get("current_round")
            if round_state is not None:
                round_state["revealed"] = True
        flag_modified(session, "scoreboard")
        advanced = True

        if not force and elapsed < turn_end:
            break  # in reveal phase, not yet time for the next turn

        session.turn_no += 1
        if session.turn_no >= total_turns or _match_over(session):
            _end_session(db, session)
            break
        session.turn_started_at = _now()
        if force:
            break  # "next" control only forces ONE turn forward

    if advanced:
        _bump_version(session)
        db.commit()
        db.refresh(session)


def _show_options_now(session: TeamArenaSession, round_state: dict) -> bool:
    elapsed = (_now() - _aware(session.turn_started_at)).total_seconds()
    return elapsed >= round_state["reading_seconds"]


# ---------------------------------------------------------------------------
# Answer submission — ONLY the active player (PRD §0 v2 rule E: 支援
# "不能代答")
# ---------------------------------------------------------------------------

def submit_answer(db: Session, session: TeamArenaSession, student: User, *, choice_key: str | None) -> dict:
    _advance_if_needed(db, session)
    if session.status != "playing":
        raise HTTPException(status_code=409, detail="這場現在無法作答")

    member = _get_member_by_student(db, session.id, student.id)
    side_key = COLUMN_TO_SIDE[member.side]
    side_cache = session.scoreboard["sides"][side_key]
    if side_cache["match_status"] == "ended":
        raise HTTPException(status_code=409, detail="這場已經結束")

    team_members = _team_members_for_side(db, session.id, member.side)
    round_state = _ensure_current_round(db, session, side_key, team_members)

    if member.id != round_state["active_member_id"]:
        raise HTTPException(status_code=403, detail="這不是你的回合，只能用「呼叫隊友」幫忙建議")

    answer_seconds = session.settings["answer_seconds"]
    elapsed_since_turn_start = (_now() - _aware(session.turn_started_at)).total_seconds()
    elapsed_since_options_opened = elapsed_since_turn_start - round_state["reading_seconds"]

    if elapsed_since_options_opened < 0:
        raise HTTPException(status_code=409, detail="選項還沒出現，無法作答")
    if elapsed_since_options_opened > answer_seconds:
        raise HTTPException(status_code=409, detail="這回合的作答時間已經結束")

    correct_key = round_state["payload"].get("correct_key")
    is_correct = bool(choice_key) and choice_key == correct_key
    elapsed_ms = max(0, int(elapsed_since_options_opened * 1000))
    weapon_used_this_turn = round_state.get("weapon_used") is not None
    showdown = towers.is_showdown_turn(
        session.turn_no, session.settings.get("total_turns", 0), session.settings["team_size"]
    )

    damage = 0
    if is_correct:
        damage = towers.compute_damage(
            elapsed_ms=elapsed_ms, limit_ms=answer_seconds * 1000,
            weapon_used=weapon_used_this_turn, showdown=showdown,
        )

    answer = TeamArenaAnswer(
        session_id=session.id,
        member_id=member.id,
        turn_no=session.turn_no,
        role="active",
        choice=choice_key,
        correct=is_correct,
        elapsed_ms=elapsed_ms,
        # Repurposed (no new column — see models/team_arena.py docstring):
        # the actual damage this answer dealt, 0 for a wrong/timeout
        # answer. Still a useful audit trail for get_result's "me" stats.
        speed_bonus=damage,
    )
    db.add(answer)
    try:
        db.flush()
    except Exception as exc:  # IntegrityError from the unique constraint
        db.rollback()
        raise HTTPException(status_code=409, detail="這回合已經作答過了") from exc

    event = None
    if is_correct:
        opponent_key = "b" if side_key == "a" else "a"
        opponent_cache = session.scoreboard["sides"][opponent_key]
        state = towers.PathState(
            towers_destroyed=opponent_cache["towers_destroyed"],
            current_hp=opponent_cache["current_hp"],
            base_destroyed=opponent_cache["base_destroyed"],
        )
        new_state, event = towers.apply_damage(state, damage, showdown=showdown)
        opponent_cache["towers_destroyed"] = new_state.towers_destroyed
        opponent_cache["current_hp"] = new_state.current_hp
        opponent_cache["base_destroyed"] = new_state.base_destroyed
        if event == "base_destroyed":
            _end_session(db, session)

    # PRD v2 rule Q: the end screen needs a REAL, never-invented highlight
    # per player — appended here (existing `scoreboard` JSONB, no new
    # column) is the only record of WHICH correct answers actually felled
    # a structure or used a weapon, since `TeamArenaAnswer` itself has no
    # spare column for that. See `_compute_highlights`.
    events_log = session.scoreboard.setdefault("events", [])
    events_log.append({
        "turn_no": session.turn_no,
        "student_id": member.student_id,
        "side": side_key,
        "correct": is_correct,
        "event": event,
        "elapsed_ms": elapsed_ms,
        "weapon": round_state.get("weapon_used"),
    })
    flag_modified(session, "scoreboard")

    _bump_version(session)
    db.commit()
    db.refresh(session)
    # Correctness is never revealed in the submit ack itself — only via
    # get_state once the round's reveal phase opens (PRD §3.4, unchanged).
    return {"turn_no": session.turn_no}


# ---------------------------------------------------------------------------
# Weapons (PRD §0 v2 rule F/G/I/J) — active player only, once per game each
# ---------------------------------------------------------------------------

def use_weapon(db: Session, session: TeamArenaSession, student: User, *, weapon: str) -> dict:
    if weapon not in WEAPON_KEYS:
        raise HTTPException(status_code=400, detail=f"weapon must be one of {WEAPON_KEYS}")

    _advance_if_needed(db, session)
    if session.status != "playing":
        raise HTTPException(status_code=409, detail="這場現在無法使用武器")

    member = _get_member_by_student(db, session.id, student.id)
    side_key = COLUMN_TO_SIDE[member.side]
    side_cache = session.scoreboard["sides"][side_key]
    if side_cache["match_status"] == "ended":
        raise HTTPException(status_code=409, detail="這場已經結束")

    team_members = _team_members_for_side(db, session.id, member.side)
    round_state = _ensure_current_round(db, session, side_key, team_members)

    if member.id != round_state["active_member_id"]:
        raise HTTPException(status_code=403, detail="只有當棒的人能使用武器")
    if round_state.get("revealed"):
        raise HTTPException(status_code=409, detail="這回合已經結束")
    if not _show_options_now(session, round_state):
        raise HTTPException(status_code=409, detail="選項還沒出現")

    weapons_used = dict(member.question_queue.get("weapons_used") or {})
    if weapons_used.get(weapon):
        raise HTTPException(status_code=409, detail="這個武器這場已經用過了")

    payload = round_state["payload"]
    extra: dict = {}

    if weapon == "eliminate":
        current_options = round_state.get("eliminated_options") or payload.get("options") or []
        if not weapons_mod.can_eliminate(current_options):
            raise HTTPException(status_code=409, detail="這題選項太少，不能用刪減法")
        rng = random.Random(f"{session.id}:{member.id}:{session.turn_no}:eliminate")
        new_options = weapons_mod.apply_eliminate(current_options, payload.get("correct_key"), rng)
        round_state["eliminated_options"] = new_options
        extra["options"] = new_options
    elif weapon == "hint":
        hint = weapons_mod.build_hint(payload)
        if hint is None:
            raise HTTPException(status_code=409, detail="這題沒有提示")
        round_state["hint_text"] = hint
        extra["hint_text"] = hint
    elif weapon == "call_teammate":
        round_state["call_teammate_active"] = True

    round_state["weapon_used"] = weapon
    weapons_used[weapon] = True
    member.question_queue = {**member.question_queue, "weapons_used": weapons_used}
    flag_modified(member, "question_queue")
    flag_modified(session, "scoreboard")
    _bump_version(session)
    db.commit()
    db.refresh(session)
    return {"status": "ok", "weapon": weapon, **extra}


def _collect_suggestions(db: Session, round_state: dict, active_member: TeamArenaMember) -> list[dict]:
    """PRD rule H: "當棒的人看到誰建議哪個" — only ever called for the
    ACTIVE member's own view (see `_public_round_view`)."""
    rows = (
        db.query(TeamArenaAnswer, TeamArenaMember)
        .join(TeamArenaMember, TeamArenaAnswer.member_id == TeamArenaMember.id)
        .filter(
            TeamArenaAnswer.session_id == active_member.session_id,
            TeamArenaAnswer.turn_no == round_state["turn_no"],
            TeamArenaAnswer.role == "assist",
            TeamArenaMember.match_no == active_member.match_no,
            TeamArenaMember.side == active_member.side,
        )
        .all()
    )
    return [
        {"student_id": m.student_id, "display_name": _display_name(m), "choice_key": a.choice}
        for a, m in rows
    ]


def submit_suggestion(db: Session, session: TeamArenaSession, student: User, *, choice_key: str) -> dict:
    """A non-active teammate's 呼叫隊友 suggestion — PRD rule E: never a
    scored answer, never usable unless 呼叫隊友 is currently active for
    this side's round."""
    _advance_if_needed(db, session)
    if session.status != "playing":
        raise HTTPException(status_code=409, detail="這場現在無法建議")

    member = _get_member_by_student(db, session.id, student.id)
    side_key = COLUMN_TO_SIDE[member.side]
    team_members = _team_members_for_side(db, session.id, member.side)
    round_state = _ensure_current_round(db, session, side_key, team_members)

    if member.id == round_state["active_member_id"]:
        raise HTTPException(status_code=403, detail="當棒的人不能建議自己，請直接作答")
    if not round_state.get("call_teammate_active"):
        raise HTTPException(status_code=409, detail="目前沒有人呼叫隊友")
    if round_state.get("revealed"):
        raise HTTPException(status_code=409, detail="這回合已經結束")

    options = round_state["payload"].get("options") or []
    valid_keys = {o.get("key") for o in options}
    if choice_key not in valid_keys:
        raise HTTPException(status_code=400, detail="不是有效的選項")

    correct_key = round_state["payload"].get("correct_key")
    answer = TeamArenaAnswer(
        session_id=session.id,
        member_id=member.id,
        turn_no=session.turn_no,
        role="assist",
        choice=choice_key,
        correct=(choice_key == correct_key),
        elapsed_ms=0,
        speed_bonus=0,
    )
    db.add(answer)
    try:
        db.flush()
    except Exception as exc:  # IntegrityError from the unique constraint
        db.rollback()
        raise HTTPException(status_code=409, detail="這回合已經建議過了") from exc

    _bump_version(session)
    db.commit()
    db.refresh(session)
    return {"status": "ok"}


# ---------------------------------------------------------------------------
# State polling (role-aware, answer-safe)
# ---------------------------------------------------------------------------

def _public_round_view(round_state: dict, *, db: Session, viewer: TeamArenaMember, is_active: bool, show_options: bool) -> dict:
    """Answer-safe projection of a side's current_round cache.

    Non-active teammates see NOTHING about the question by default (PRD
    rule H's own phrasing — "呼叫隊友：隊友的畫面跳出同一題" — implies there
    is otherwise nothing to show them; rule E: they cannot answer at all)
    until 呼叫隊友 is invoked, at which point they get the stem + full
    (never eliminated) options so they can submit a suggestion.

    The active player sees their OWN view of the question, including any
    weapon effects they themselves triggered (eliminated options, a hint)
    — opponents and teammates never see those.
    """
    payload = round_state["payload"]
    revealed = bool(round_state.get("revealed"))
    turn_no = round_state["turn_no"]
    call_teammate_active = bool(round_state.get("call_teammate_active"))

    if not is_active:
        if not call_teammate_active:
            return {"turn_no": turn_no, "called_for_help": False}
        return {
            "turn_no": turn_no,
            "called_for_help": True,
            "stem": payload.get("stem"),
            "extra": payload.get("extra"),
            "options": payload.get("options") if show_options else None,
            "reading_seconds": round_state["reading_seconds"],
            "revealed": revealed,
        }

    options = round_state.get("eliminated_options") or payload.get("options")
    view: dict = {
        "turn_no": turn_no,
        "stem": payload.get("stem"),
        "extra": payload.get("extra"),
        "options": options if show_options else None,
        "reading_seconds": round_state["reading_seconds"],
        "answer_seconds": round_state["answer_seconds"],
        "revealed": revealed,
        "hint_text": round_state.get("hint_text"),
        "hint_available": round_state.get("hint_available", True),
        "call_teammate_active": call_teammate_active,
    }
    if revealed:
        view["correct_key"] = payload.get("correct_key")
    if call_teammate_active:
        view["suggestions"] = _collect_suggestions(db, round_state, viewer)
    return view


def get_state(db: Session, session: TeamArenaSession, user: User) -> dict:
    _advance_if_needed(db, session)

    is_host = session.teacher_id == user.id
    member = (
        db.query(TeamArenaMember)
        .filter(TeamArenaMember.session_id == session.id, TeamArenaMember.student_id == user.id)
        .first()
    )
    if not is_host and member is None:
        raise HTTPException(status_code=403, detail="You are not a member of this session")

    base: dict = {
        "code": session.code,
        "status": session.status,
        "turn_no": session.turn_no,
        "state_version": session.state_version,
        "story": resolve_story_for_session(session.settings.get("story_pack_key")),
        "team_size": session.settings.get("team_size"),
        "is_host": is_host,
        # PRD v2 rule P: 決戰時刻 — both student and host screens must show
        # a clear banner once the final lap starts. Computed the same way
        # submit_answer does (shared turn clock, same inputs).
        "showdown": towers.is_showdown_turn(
            session.turn_no, session.settings.get("total_turns", 0), session.settings.get("team_size", 0)
        ),
    }

    by_side = _members_by_side(db, session.id)
    viewer_side = COLUMN_TO_SIDE[member.side] if member is not None else None
    sides_public: dict[str, dict] = {}
    for side_key in ("a", "b"):
        team_members = by_side.get(side_key, [])
        cache = session.scoreboard.get("sides", {}).get(side_key, {})
        sides_public[side_key] = {
            "seated": len(team_members),
            "team_size": session.settings.get("team_size"),
            "towers_destroyed": cache.get("towers_destroyed", 0),
            "current_hp": cache.get("current_hp", towers.STRUCTURE_HP),
            "base_destroyed": cache.get("base_destroyed", False),
            "match_status": cache.get("match_status", "active"),
            "winner": cache.get("winner"),
            "members": [
                {
                    # Real account id only for the viewer's own team: an id
                    # lets anyone recognise the same student across matches.
                    "student_id": m.student_id if viewer_side == side_key else None,
                    "display_name": _name_for_viewer(m, side_key, i, viewer_side),
                }
                for i, m in enumerate(team_members)
            ],
        }
    base["sides"] = sides_public

    if member is None:
        return {**base, "own_match": None}

    side_key = COLUMN_TO_SIDE[member.side]
    team_members = by_side.get(side_key, [])
    cache = session.scoreboard.get("sides", {}).get(side_key, {})
    own_match: dict = {
        "my_side": side_key,
        "match_status": cache.get("match_status", "active"),
        "winner": cache.get("winner"),
        "am_i_active": False,
        "current_round": None,
    }

    round_state = cache.get("current_round") if cache else None
    if (
        round_state
        and round_state.get("turn_no") == session.turn_no
        and cache.get("match_status") != "ended"
        and session.status == "playing"
    ):
        is_active = member.id == round_state["active_member_id"]
        own_match["am_i_active"] = is_active
        show_options = _show_options_now(session, round_state)
        own_match["current_round"] = _public_round_view(
            round_state, db=db, viewer=member, is_active=is_active, show_options=show_options
        )

    weapons_used = member.question_queue.get("weapons_used") or {}
    own_match["weapons_used"] = {k: bool(weapons_used.get(k)) for k in WEAPON_KEYS}

    return {**base, "own_match": own_match}


# ---------------------------------------------------------------------------
# Result (only after ended) — PRD v2 rule Q: NO individual ranking or
# per-player score anywhere in this payload. Team result (win/lose/draw,
# towers down) plus one REAL, never-invented highlight sentence per
# player, built only from events `submit_answer` actually logged.
# ---------------------------------------------------------------------------

_HIGHLIGHT_BASE_DESTROYED = "幫隊伍攻破了對方主堡！"
_HIGHLIGHT_TOWER_FALLEN = "打倒了一座塔"
_HIGHLIGHT_FASTEST = "全場答得最快的一次"
_HIGHLIGHT_CALL_TEAMMATE = "用呼叫隊友幫隊伍答對"
_HIGHLIGHT_STREAK = "連續答對，手感超穩"
# PRD rule Q: "沒有亮點事件的人給一句中性的參與感謝，不能是負面描述" — this
# is the only fallback, and it is used verbatim, never softened into
# something that reads as an excuse for a weak performance.
_HIGHLIGHT_NEUTRAL = "完整參與了這場比賽"


def _compute_highlights(session: TeamArenaSession, members: list[TeamArenaMember]) -> dict[int, str]:
    """Returns {student_id: one Chinese sentence}. Every non-neutral
    sentence traces back to a specific logged event in
    `session.scoreboard["events"]` (appended by `submit_answer`) — nothing
    here is inferred or guessed. Priority (most impressive wins when a
    player qualifies for more than one): base destroyed > tower felled >
    fastest correct answer of the match > a correct answer made using 呼叫
    隊友 > a 2+ correct-answer streak > neutral participation line.
    """
    events: list[dict] = session.scoreboard.get("events", [])
    highlights: dict[int, str] = {}

    for e in events:
        if not e.get("correct"):
            continue
        sid = e["student_id"]
        if e.get("event") == "base_destroyed":
            highlights[sid] = _HIGHLIGHT_BASE_DESTROYED
        elif e.get("event") in ("tower_fallen", "tower_fallen_to_base"):
            highlights.setdefault(sid, _HIGHLIGHT_TOWER_FALLEN)

    correct_events = [e for e in events if e.get("correct")]
    if correct_events:
        fastest = min(correct_events, key=lambda e: e.get("elapsed_ms", 0))
        highlights.setdefault(fastest["student_id"], _HIGHLIGHT_FASTEST)

    for e in events:
        if e.get("correct") and e.get("weapon") == "call_teammate":
            highlights.setdefault(e["student_id"], _HIGHLIGHT_CALL_TEAMMATE)

    by_student: dict[int, list[dict]] = {}
    for e in events:
        by_student.setdefault(e["student_id"], []).append(e)
    for sid, evs in by_student.items():
        evs.sort(key=lambda e: e["turn_no"])
        run = best = 0
        for e in evs:
            run = run + 1 if e.get("correct") else 0
            best = max(best, run)
        if best >= 2:
            highlights.setdefault(sid, _HIGHLIGHT_STREAK)

    for m in members:
        highlights.setdefault(m.student_id, _HIGHLIGHT_NEUTRAL)

    return highlights


def get_result(db: Session, session: TeamArenaSession, user: User) -> dict:
    is_host = session.teacher_id == user.id
    member = (
        db.query(TeamArenaMember)
        .filter(TeamArenaMember.session_id == session.id, TeamArenaMember.student_id == user.id)
        .first()
    )
    if not is_host and member is None:
        raise HTTPException(status_code=403, detail="You are not a participant of this session")
    if session.status != "ended":
        raise HTTPException(status_code=409, detail="這場比賽還沒結束")

    sides: dict[str, dict] = {}
    for side_key in ("a", "b"):
        cache = session.scoreboard.get("sides", {}).get(side_key, {})
        sides[side_key] = {
            "towers_destroyed": cache.get("towers_destroyed", 0),
            "base_destroyed": cache.get("base_destroyed", False),
            "match_status": cache.get("match_status", "ended"),
            "winner": cache.get("winner"),
        }

    by_side = _members_by_side(db, session.id)
    all_members = by_side.get("a", []) + by_side.get("b", [])
    highlights = _compute_highlights(session, all_members)
    viewer_side = COLUMN_TO_SIDE[member.side] if member is not None else None

    # PRD rule Q: "每人一句" — the whole roster's highlights are shown on
    # the shared end screen (not a private "only you see this" stat, the
    # way v1's per-player numbers were) — deliberately NO numeric field
    # anywhere in here that could be read as a score or used to rank.
    players: dict[str, list[dict]] = {
        side_key: [
            {
                "student_id": m.student_id if viewer_side == side_key else None,
                "display_name": _name_for_viewer(m, side_key, i, viewer_side),
                "highlight": highlights[m.student_id],
            }
            for i, m in enumerate(by_side.get(side_key, []))
        ]
        for side_key in ("a", "b")
    }

    me = None
    if member is not None:
        me = {"my_side": COLUMN_TO_SIDE[member.side], "highlight": highlights.get(member.student_id, _HIGHLIGHT_NEUTRAL)}

    return {"sides": sides, "players": players, "me": me}
