"""五人對抗賽遊戲引擎 (DB-aware) — PRD docs/prd/2026-10-18-team-arena-prd.md,
issue #3632.

Independent module (PRD §7 "依賴方向"): reads `live_quiz`'s question-source
adapters and `round_types/choice.py::generate_rounds` one-way (explicitly
sanctioned reuse — PRD §7's own architecture diagram), and never imports
`pk`/`league`/`escape_room` internals — each of those modes already
duplicates its own thin classroom-ownership/membership/scope-validation
helpers rather than sharing them (see `pk/engine.py` and
`escape_room/engine.py`); this module follows the same precedent rather
than reaching into a sibling mode's package. The ONE exception is
`services/pk/classroom_features.py`, which documents itself as the
general, mode-agnostic accessor for every `classrooms.feature_settings`
key (not PK-specific despite its path) — importing that is using shared
infrastructure, not reaching into PK's own logic.

⛔ No alembic migration exists for the three tables this reads/writes (see
`models/team_arena.py` module docstring) — Young has not approved building
them for real yet. Every test here exercises `Base.metadata.create_all()`
against SQLite, same as every other model/engine test in this repo.

Lazy, no-cron state machine (same "輪詢時順便檢查" principle PK/live_quiz
already established): the only two call sites that can move a turn forward
(`get_state` and `submit_answer`) both run `_advance_if_needed` first.

Known follow-up (critic review, slice 2, flagged non-blocking): every
concurrent match in a session shares ONE `TeamArenaSession.scoreboard`
JSONB column, read-modify-written per request with no row lock / optimistic
version check on that column specifically (only the whole-session
`state_version` counter exists, and it is informational for pollers, not a
write guard). Under PRD §13 AC12's "30 人同時每秒輪詢" load, two answer
submissions landing in different matches of the SAME session at the same
instant could race and lose one update. Same risk shape already exists in
sibling `pk`/`live_quiz` engines for their own per-row JSON fields; flagged
here because this mode fans out to more matches per session row than
those do. Not fixed in this slice — would need `with_for_update()` or a
per-match sub-row, deferred as a load-test-driven follow-up rather than
speculative hardening now (dev-doctrine: don't over-engineer against a
risk that hasn't been measured yet).
"""
from __future__ import annotations

import math
import random
import secrets
from collections import defaultdict
from datetime import datetime, timezone

from fastapi import HTTPException
from sqlalchemy.orm import Session
from sqlalchemy.orm.attributes import flag_modified

from ...models.school import Classroom, ClassroomStudent, ClassroomTeacher
from ...models.team_arena import TeamArenaAnswer, TeamArenaMember, TeamArenaSession
from ...models.user import User
from ...services.lesson_loader import get_available_grades, search_lessons
from ...services.lesson_uid_loader import load_lesson
from ..live_quiz.round_types import choice as live_quiz_choice
from ..pk.classroom_features import get_classroom_feature
from .reading_time import MIN_READING_SECONDS, SPEED_PRESETS, reading_seconds_for_stem
from .scoring import (
    ASSIST_BONUS_PER_CORRECT,
    ASSIST_ROUND_CAP,
    decide_match_winner,
    score_active_answer,
    score_assist_answer,
)
from .story_adapter import resolve_story_for_session
from .teams import (
    LANES,
    PRIMARY_LANES,
    SUPPORT_LANE,
    TooFewPlayersError,
    assign_lanes,
    build_matches,
    form_teams,
)
from .towers import BASE_HITS_TO_WIN, PathState, apply_correct_answer

TURNS_PER_PLAYER_CHOICES = (1, 2, 3)
ANSWER_SECONDS_CHOICES = (20, 30, 45)
# PRD §3.5: "揭曉：4 秒".
REVEAL_SECONDS = 4

_CODE_LENGTH = 6
# Same confusable-avoiding alphabet pk/matchmaking.py uses for invite codes
# (excludes 0/O and 1/I) — independently duplicated here rather than
# imported, same reasoning as every other helper in this module.
_CODE_CHARS = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ"
_MAX_CODE_RETRIES = 10

_ERR_UNKNOWN_LESSON = "找不到這一課的題目，請回上一頁重新選擇"
_ERR_UNKNOWN_GRADE = "找不到這個年級的題庫，請回上一頁重新選擇"
_ERR_UNKNOWN_SCOPE = "不支援這種題目範圍，請回上一頁重新選擇"
_ERR_EMPTY_POOL = "這個年級目前還沒有題目，請改選其他範圍"


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _aware(dt: datetime | None) -> datetime | None:
    """Same SQLite-naive-datetime guard as live_quiz.engine._aware /
    pk.engine._aware — every write here only ever stores UTC via `_now()`."""
    if dt is not None and dt.tzinfo is None:
        return dt.replace(tzinfo=timezone.utc)
    return dt


def _bump_version(session: TeamArenaSession) -> None:
    """Critic review (slice 2): state_version was modeled but never
    written anywhere — every mutating path below calls this immediately
    before its own `db.commit()`, so a poller's `after_version` short-
    circuit (PRD §7 "回應帶版本號，沒變就只回版本") actually reflects real
    progress instead of being permanently stuck at 0."""
    session.state_version += 1


# ---------------------------------------------------------------------------
# Scope validation — own copy, same reasoning as pk.engine/escape_room.engine
# ---------------------------------------------------------------------------

def resolve_pool_grade(scope_ref: str) -> str:
    available = [str(g) for g in get_available_grades()]
    if scope_ref in available:
        return scope_ref
    try:
        wanted = int(scope_ref)
    except (TypeError, ValueError):
        raise HTTPException(status_code=400, detail=_ERR_UNKNOWN_GRADE)
    if wanted not in range(1, 13):
        raise HTTPException(status_code=400, detail=_ERR_UNKNOWN_GRADE)
    numeric = sorted(int(g) for g in available if g.isdigit())
    if not numeric:
        raise HTTPException(status_code=400, detail=_ERR_EMPTY_POOL)
    return str(min(numeric, key=lambda g: (abs(g - wanted), -g)))


def validate_scope(scope_type: str, scope_ref: str) -> None:
    if scope_type == "lesson":
        if load_lesson(scope_ref) is None:
            raise HTTPException(status_code=400, detail=_ERR_UNKNOWN_LESSON)
    elif scope_type == "grade_pool":
        resolve_pool_grade(scope_ref)
    else:
        raise HTTPException(status_code=400, detail=_ERR_UNKNOWN_SCOPE)


def _load_lessons_for_scope(scope_type: str, scope_ref: str) -> list[dict]:
    if scope_type == "lesson":
        lesson = load_lesson(scope_ref)
        if lesson is None:
            raise HTTPException(status_code=400, detail=_ERR_UNKNOWN_LESSON)
        return [{"lesson_uid": scope_ref, "lesson": lesson}]
    if scope_type != "grade_pool":
        raise HTTPException(status_code=400, detail=_ERR_UNKNOWN_SCOPE)
    results = search_lessons(grade=resolve_pool_grade(scope_ref))
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
# Authz helpers — own copies, same reasoning as above
# ---------------------------------------------------------------------------

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


def _require_team_arena_enabled(db: Session, classroom: Classroom) -> None:
    if not get_classroom_feature(classroom, "team_arena", db=db):
        raise HTTPException(status_code=403, detail="老師還沒開放五人對抗賽")


def _require_classroom_membership(db: Session, classroom_id: int, student_id: int) -> None:
    member = (
        db.query(ClassroomStudent)
        .filter(
            ClassroomStudent.classroom_id == classroom_id,
            ClassroomStudent.student_id == student_id,
        )
        .first()
    )
    if member is None:
        raise HTTPException(status_code=403, detail="You are not a member of this classroom")


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
    """No status filter — same precedent as live_quiz.engine.get_game_by_code:
    a code is only reused once the OLD session holding it has ended (the
    generator in `_generate_code` only checks uniqueness among
    lobby/playing/paused codes), so `order_by(id.desc()).first()` always
    resolves to whichever session is actually "live" for that code right
    now — the newest row, active or already ended. Filtering out `ended`
    here would 404 every poll/result lookup the instant a session finishes
    (caught by test_team_arena_routes.py's happy-path test: the student's
    own `/result` call right after the teacher's `/control end` used to
    404 before this fix)."""
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
    """Public entry point for the route layer (same precedent as
    pk.engine.get_match_for_user / get_queue_for_user) — the one place a
    raw path-param string gets resolved into a real session or a clean
    404. Every route handler calls this instead of touching
    `_get_session_by_code` directly."""
    return _get_session_by_code(db, code)


# ---------------------------------------------------------------------------
# Creation + join
# ---------------------------------------------------------------------------

def create_session(
    db: Session,
    teacher: User,
    *,
    classroom_id: int,
    scope_type: str,
    scope_ref: str,
    turns_per_player: int = 2,
    answer_seconds: int = 30,
    reading_speed: str = "standard",
    story_pack_key: str | None = None,
) -> TeamArenaSession:
    classroom = _require_classroom_owned_by(db, classroom_id, teacher)
    _require_team_arena_enabled(db, classroom)
    validate_scope(scope_type, scope_ref)
    if turns_per_player not in TURNS_PER_PLAYER_CHOICES:
        raise HTTPException(status_code=400, detail=f"turns_per_player must be one of {TURNS_PER_PLAYER_CHOICES}")
    if answer_seconds not in ANSWER_SECONDS_CHOICES:
        raise HTTPException(status_code=400, detail=f"answer_seconds must be one of {ANSWER_SECONDS_CHOICES}")
    if reading_speed not in SPEED_PRESETS:
        raise HTTPException(status_code=400, detail=f"reading_speed must be one of {SPEED_PRESETS}")

    code = _generate_code(db)
    session = TeamArenaSession(
        classroom_id=classroom_id,
        teacher_id=teacher.id,
        code=code,
        status="lobby",
        settings={
            "scope_type": scope_type,
            "scope_ref": scope_ref,
            "turns_per_player": turns_per_player,
            "answer_seconds": answer_seconds,
            "reading_speed": reading_speed,
            "story_pack_key": story_pack_key,
        },
        scoreboard={"roster": []},
    )
    db.add(session)
    db.commit()
    db.refresh(session)
    return session


def join_session(db: Session, student: User, code: str) -> TeamArenaSession:
    session = _get_session_by_code(db, code)
    _require_classroom_membership(db, session.classroom_id, student.id)
    if session.status != "lobby":
        raise HTTPException(status_code=409, detail="本場已經開始，無法加入")
    roster = list(session.scoreboard.get("roster", []))
    if student.id not in roster:
        roster.append(student.id)
        session.scoreboard = {**session.scoreboard, "roster": roster}
        flag_modified(session, "scoreboard")
        _bump_version(session)
        db.commit()
        db.refresh(session)
    return session


# ---------------------------------------------------------------------------
# Team formation + lane self-service (PRD §4/§6)
# ---------------------------------------------------------------------------

def _get_member_by_student(db: Session, session_id: int, student_id: int) -> TeamArenaMember:
    member = (
        db.query(TeamArenaMember)
        .filter(TeamArenaMember.session_id == session_id, TeamArenaMember.student_id == student_id)
        .first()
    )
    if member is None:
        raise HTTPException(status_code=404, detail="這位學生不在這場的分隊名單裡")
    return member


def _recompute_rotation_order(members: list[TeamArenaMember]) -> None:
    """Locked rotation order follows canonical lane order for the 4 primary
    lanes (PRD §3.3), then support members in a stable secondary order (by
    student_id — arbitrary but deterministic, documented design choice,
    same as `teams.assign_lanes`'s own initial assignment)."""
    primary = sorted(
        (m for m in members if m.lane != SUPPORT_LANE), key=lambda m: PRIMARY_LANES.index(m.lane)
    )
    support = sorted((m for m in members if m.lane == SUPPORT_LANE), key=lambda m: m.student_id)
    for order, m in enumerate(primary + support):
        m.rotation_order = order


def assign_teams(
    db: Session,
    session: TeamArenaSession,
    teacher: User,
    *,
    action: str,
    student_a_id: int | None = None,
    student_b_id: int | None = None,
    student_id: int | None = None,
    grade_pool_override: bool | None = None,
) -> TeamArenaSession:
    _require_classroom_owned_by(db, session.classroom_id, teacher)
    if session.status != "lobby":
        raise HTTPException(status_code=409, detail="分隊只能在開始前進行")

    if action == "auto":
        roster = list(session.scoreboard.get("roster", []))
        try:
            teams = form_teams(roster, random.Random(session.id))
        except TooFewPlayersError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        matches = build_matches(teams)

        # Re-rolling teams (teacher can call "auto" again before starting)
        # must not leave orphaned rows from a previous roll.
        db.query(TeamArenaMember).filter(TeamArenaMember.session_id == session.id).delete()
        db.flush()

        for match_no, (team_a_idx, team_b_idx) in enumerate(matches):
            for side, team_idx in enumerate((team_a_idx, team_b_idx)):
                member_ids = teams[team_idx]
                assignment = assign_lanes(member_ids, random.Random(session.id * 10_000 + team_idx))
                for sid, info in assignment.items():
                    db.add(
                        TeamArenaMember(
                            session_id=session.id,
                            student_id=sid,
                            match_no=match_no,
                            side=side,
                            lane=info["lane"],
                            rotation_order=info["rotation_order"],
                        )
                    )
        _bump_version(session)
        db.commit()
        db.refresh(session)
        return session

    if action == "swap":
        if student_a_id is None or student_b_id is None:
            raise HTTPException(status_code=422, detail="swap needs student_a_id and student_b_id")
        member_a = _get_member_by_student(db, session.id, student_a_id)
        member_b = _get_member_by_student(db, session.id, student_b_id)
        a_seat = (member_a.match_no, member_a.side, member_a.lane, member_a.rotation_order)
        b_seat = (member_b.match_no, member_b.side, member_b.lane, member_b.rotation_order)
        (member_a.match_no, member_a.side, member_a.lane, member_a.rotation_order) = b_seat
        (member_b.match_no, member_b.side, member_b.lane, member_b.rotation_order) = a_seat
        _bump_version(session)
        db.commit()
        db.refresh(session)
        return session

    if action == "override":
        if student_id is None or grade_pool_override is None:
            raise HTTPException(status_code=422, detail="override needs student_id and grade_pool_override")
        member = _get_member_by_student(db, session.id, student_id)
        member.grade_pool_override = grade_pool_override
        _bump_version(session)
        db.commit()
        db.refresh(session)
        return session

    raise HTTPException(status_code=400, detail=f"Unknown teams action: {action!r}")


def claim_lane(db: Session, session: TeamArenaSession, student: User, lane: str) -> TeamArenaSession:
    """PRD §4 大廳選路線: 先點先得；lanes lock once the session leaves lobby
    (MVP simplification of the PRD's standalone 30s countdown — documented
    in docs/prd design-decision notes shipped with this slice: locking at
    the teacher's own "start" control avoids needing a server-side timer
    independent of any request, consistent with "MVP 先行" / 不要過度設計)."""
    if session.status != "lobby":
        raise HTTPException(status_code=409, detail="分隊已鎖定，無法更換路線")
    if lane not in LANES:
        raise HTTPException(status_code=400, detail=f"lane must be one of {LANES}")

    member = _get_member_by_student(db, session.id, student.id)
    teammates = (
        db.query(TeamArenaMember)
        .filter(
            TeamArenaMember.session_id == session.id,
            TeamArenaMember.match_no == member.match_no,
            TeamArenaMember.side == member.side,
        )
        .all()
    )
    occupied = {m.lane for m in teammates if m.id != member.id}
    if lane in occupied:
        raise HTTPException(status_code=409, detail="這個路線已經有人選了")

    member.lane = lane
    _recompute_rotation_order(teammates)
    _bump_version(session)
    db.commit()
    db.refresh(session)
    return session


# ---------------------------------------------------------------------------
# Control (minimal "start" for now — full turn resolution below)
# ---------------------------------------------------------------------------

def control(db: Session, session: TeamArenaSession, teacher: User, *, action: str) -> TeamArenaSession:
    _require_classroom_owned_by(db, session.classroom_id, teacher)
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
        # Restart the clock for the current (unfinished) turn — pausing
        # must not silently burn down the answer window while frozen.
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
    members = db.query(TeamArenaMember).filter(TeamArenaMember.session_id == session.id).all()
    if not members:
        raise HTTPException(status_code=400, detail="請先分隊再開始")

    by_team: dict[tuple[int, int], list[TeamArenaMember]] = defaultdict(list)
    for m in members:
        by_team[(m.match_no, m.side)].append(m)

    turns_per_player = session.settings["turns_per_player"]
    answer_seconds = session.settings["answer_seconds"]
    # PRD §3.3: a smaller team's members play extra laps to match the
    # larger team's total turn count ("小隊的人只是多上場一次") — the
    # GLOBAL turn clock (shared across every concurrent match in this
    # session, PRD §3.5 "全班所有場次同步") paces to whichever team in the
    # WHOLE SESSION is largest, not just within one match.
    max_team_size = max(len(v) for v in by_team.values())
    total_turns = turns_per_player * max_team_size
    session.settings = {**session.settings, "total_turns": total_turns}
    flag_modified(session, "settings")

    lessons = _load_lessons_for_scope(session.settings["scope_type"], session.settings["scope_ref"])
    rng = random.Random(session.id)

    # One pool per primary lane, sized to cover every member who might ever
    # draw from it: every non-support member in ANY team needs
    # `ceil(total_turns / their_team_size)` items from their own lane;
    # every support member needs that many items from EACH of the 4 lanes
    # (their actual lane is chosen dynamically at turn-time — see
    # `_ensure_current_round`). MVP simplification (documented): if a
    # lane's real pool is smaller than needed, cycle it rather than fail
    # outright or try to dynamically reassign lanes (PRD §15 names this as
    # a known risk; full dynamic reassignment is out of scope for v1).
    laps_needed: dict[tuple[int, int], int] = {
        key: math.ceil(total_turns / len(members_)) for key, members_ in by_team.items()
    }
    pool_needed: dict[str, int] = {lane: 0 for lane in PRIMARY_LANES}
    for key, members_ in by_team.items():
        laps = laps_needed[key]
        for m in members_:
            if m.lane == SUPPORT_LANE:
                for lane in PRIMARY_LANES:
                    pool_needed[lane] += laps
            else:
                pool_needed[m.lane] += laps

    pools: dict[str, list[dict]] = {}
    for lane in PRIMARY_LANES:
        settings = {
            "source_modules": [lane],
            "question_count_mode": "all",
            "seconds": answer_seconds,
            "reading_seconds": 0,
        }
        rounds, _fallback = live_quiz_choice.generate_rounds(lessons, settings, rng)
        if not rounds:
            raise HTTPException(status_code=400, detail=f"「{lane}」這個題型目前沒有題目，請改選其他範圍")
        pool = list(rounds)
        needed = pool_needed[lane]
        while len(pool) < needed:
            pool.extend(rounds)
        pools[lane] = pool

    cursor = {lane: 0 for lane in PRIMARY_LANES}
    for key, members_ in by_team.items():
        laps = laps_needed[key]
        for m in members_:
            if m.lane == SUPPORT_LANE:
                support_queue: dict[str, list[dict]] = {}
                for lane in PRIMARY_LANES:
                    support_queue[lane] = pools[lane][cursor[lane] : cursor[lane] + laps]
                    cursor[lane] += laps
                m.question_queue = {"support": support_queue}
            else:
                take = pools[m.lane][cursor[m.lane] : cursor[m.lane] + laps]
                cursor[m.lane] += laps
                m.question_queue = {"fixed": take}
            flag_modified(m, "question_queue")

    session.status = "playing"
    session.turn_no = 0
    session.turn_started_at = _now()
    session.scoreboard = {
        "roster": session.scoreboard.get("roster", []),
        "matches": {
            f"{match_no}:{side}": {
                "towers_down": {lane: 0 for lane in PRIMARY_LANES},
                "base_hits": 0,
                "score": 0,
                "match_status": "active",
                "winner": None,
            }
            for (match_no, side) in by_team
        },
    }
    flag_modified(session, "scoreboard")
    _bump_version(session)
    db.commit()
    db.refresh(session)
    return session


# ---------------------------------------------------------------------------
# Turn resolution (lazy, no-cron — same "輪詢時順便檢查" principle as
# pk.engine.advance_if_needed / live_quiz.engine._maybe_expire)
# ---------------------------------------------------------------------------

def _members_by_team(db: Session, session_id: int) -> dict[tuple[int, int], list[TeamArenaMember]]:
    members = db.query(TeamArenaMember).filter(TeamArenaMember.session_id == session_id).all()
    by_team: dict[tuple[int, int], list[TeamArenaMember]] = defaultdict(list)
    for m in members:
        by_team[(m.match_no, m.side)].append(m)
    return by_team


def _active_member_for_turn(team_members: list[TeamArenaMember], turn_no: int) -> TeamArenaMember:
    local = turn_no % len(team_members)
    return next(m for m in team_members if m.rotation_order == local)


def _lap_index_for_turn(team_members: list[TeamArenaMember], turn_no: int) -> int:
    return turn_no // len(team_members)


def _draw_question_entry(member: TeamArenaMember, lap: int, team_cache: dict) -> tuple[dict, str]:
    """Returns (round_entry, lane_for_scoring). `round_entry` is the frozen
    ``{round_index, round_type, payload}`` shape `generate_rounds` produces.
    """
    if member.lane == SUPPORT_LANE:
        # PRD §3.1: "系統替他挑本隊推進最少的那條路出題" — least towers_down
        # first, canonical lane order breaks ties deterministically.
        chosen_lane = min(
            PRIMARY_LANES, key=lambda lane: (team_cache["towers_down"][lane], PRIMARY_LANES.index(lane))
        )
        bank = member.question_queue["support"][chosen_lane]
        entry = bank[lap % len(bank)]
        return entry, chosen_lane
    queue = member.question_queue["fixed"]
    entry = queue[lap % len(queue)]
    return entry, member.lane


def _ensure_current_round(
    db: Session, session: TeamArenaSession, match_no: int, side: int, team_members: list[TeamArenaMember]
) -> dict:
    key = f"{match_no}:{side}"
    team_cache = session.scoreboard["matches"][key]
    current = team_cache.get("current_round")
    if current is not None and current.get("turn_no") == session.turn_no:
        return current

    active = _active_member_for_turn(team_members, session.turn_no)
    lap = _lap_index_for_turn(team_members, session.turn_no)
    entry, lane_for_scoring = _draw_question_entry(active, lap, team_cache)
    payload = entry["payload"]
    reading_seconds = reading_seconds_for_stem(payload.get("stem", ""), speed=session.settings["reading_speed"])

    current = {
        "turn_no": session.turn_no,
        "active_member_id": active.id,
        "active_student_id": active.student_id,
        "lane": lane_for_scoring,
        "payload": payload,
        "reading_seconds": reading_seconds,
        "answer_seconds": session.settings["answer_seconds"],
        "revealed": False,
    }
    team_cache["current_round"] = current
    flag_modified(session, "scoreboard")
    return current


def _all_matches_ended(session: TeamArenaSession) -> bool:
    matches = session.scoreboard.get("matches", {})
    return bool(matches) and all(v["match_status"] == "ended" for v in matches.values())


def _end_match(session: TeamArenaSession, match_no: int) -> None:
    matches = session.scoreboard["matches"]
    key_a, key_b = f"{match_no}:0", f"{match_no}:1"
    a, b = matches.get(key_a), matches.get(key_b)
    if a is None or b is None:
        return
    if a["match_status"] == "ended":
        return
    winner = decide_match_winner(
        side_a_score=a["score"],
        side_b_score=b["score"],
        side_a_base_conquered=a["base_hits"] >= BASE_HITS_TO_WIN,
        side_b_base_conquered=b["base_hits"] >= BASE_HITS_TO_WIN,
    )
    a["match_status"] = "ended"
    b["match_status"] = "ended"
    a["winner"] = winner
    b["winner"] = "a" if winner == "b" else ("b" if winner == "a" else "draw")
    flag_modified(session, "scoreboard")


def _end_session(db: Session, session: TeamArenaSession) -> None:
    if session.status == "ended":
        return
    # Any match still active when the whole session ends (teacher force-end,
    # or turns ran out) is decided on whatever score it has now — same
    # "decide on current numbers" rule PRD §3.2 already uses for the
    # turns-exhausted case.
    matches = session.scoreboard.get("matches", {})
    match_nos = {int(key.split(":")[0]) for key in matches}
    for match_no in match_nos:
        _end_match(session, match_no)
    session.status = "ended"
    session.ended_at = _now()
    flag_modified(session, "scoreboard")


def _advance_if_needed(db: Session, session: TeamArenaSession, *, force: bool = False) -> None:
    if session.status != "playing":
        return
    if _all_matches_ended(session):
        _end_session(db, session)
        _bump_version(session)
        db.commit()
        db.refresh(session)
        return

    by_team = _members_by_team(db, session.id)
    total_turns = session.settings.get("total_turns")
    if not total_turns or not by_team:
        return

    advanced = False
    while session.status == "playing":
        active_teams = {
            key: members_
            for key, members_ in by_team.items()
            if session.scoreboard["matches"][f"{key[0]}:{key[1]}"]["match_status"] != "ended"
        }
        if not active_teams:
            _end_session(db, session)
            break

        max_reading = MIN_READING_SECONDS
        for (match_no, side), team_members in active_teams.items():
            round_state = _ensure_current_round(db, session, match_no, side, team_members)
            max_reading = max(max_reading, round_state["reading_seconds"])

        answer_seconds = session.settings["answer_seconds"]
        reveal_start = max_reading + answer_seconds
        turn_end = reveal_start + REVEAL_SECONDS
        elapsed = (_now() - _aware(session.turn_started_at)).total_seconds()

        if not force and elapsed < reveal_start:
            break  # still reading or answering

        for (match_no, side) in active_teams:
            key = f"{match_no}:{side}"
            round_state = session.scoreboard["matches"][key].get("current_round")
            if round_state is not None:
                round_state["revealed"] = True
        flag_modified(session, "scoreboard")
        advanced = True

        if not force and elapsed < turn_end:
            break  # in reveal phase, not yet time for the next turn

        session.turn_no += 1
        if session.turn_no >= total_turns or _all_matches_ended(session):
            _end_session(db, session)
            break
        session.turn_started_at = _now()
        if force:
            break  # "next" control only forces ONE turn forward, not a full fast-forward

    if advanced:
        _bump_version(session)
        db.commit()
        db.refresh(session)


# ---------------------------------------------------------------------------
# Answer submission
# ---------------------------------------------------------------------------

def submit_answer(
    db: Session, session: TeamArenaSession, student: User, *, choice_key: str | None
) -> dict:
    _advance_if_needed(db, session)
    if session.status != "playing":
        raise HTTPException(status_code=409, detail="這場現在無法作答")

    member = _get_member_by_student(db, session.id, student.id)
    team_members = [
        m for m in db.query(TeamArenaMember).filter(
            TeamArenaMember.session_id == session.id,
            TeamArenaMember.match_no == member.match_no,
            TeamArenaMember.side == member.side,
        ).all()
    ]
    key = f"{member.match_no}:{member.side}"
    team_cache = session.scoreboard["matches"][key]
    if team_cache["match_status"] == "ended":
        raise HTTPException(status_code=409, detail="這場已經結束")

    round_state = _ensure_current_round(db, session, member.match_no, member.side, team_members)
    answer_seconds = session.settings["answer_seconds"]
    elapsed_since_turn_start = (_now() - _aware(session.turn_started_at)).total_seconds()
    elapsed_since_options_opened = elapsed_since_turn_start - round_state["reading_seconds"]

    # PRD §13 AC7: 選項出現前送出作答回 409. Also reject once the answer
    # window itself has closed (reveal phase / next turn already open).
    if elapsed_since_options_opened < 0:
        raise HTTPException(status_code=409, detail="選項還沒出現，無法作答")
    if elapsed_since_options_opened > answer_seconds:
        raise HTTPException(status_code=409, detail="這回合的作答時間已經結束")

    is_active = member.id == round_state["active_member_id"]
    role = "active" if is_active else "assist"
    correct_key = round_state["payload"].get("correct_key")
    is_correct = bool(choice_key) and choice_key == correct_key
    elapsed_ms = max(0, int(elapsed_since_options_opened * 1000))

    if role == "assist":
        prior_correct = (
            db.query(TeamArenaAnswer)
            .join(TeamArenaMember, TeamArenaAnswer.member_id == TeamArenaMember.id)
            .filter(
                TeamArenaAnswer.session_id == session.id,
                TeamArenaAnswer.turn_no == session.turn_no,
                TeamArenaAnswer.role == "assist",
                TeamArenaAnswer.correct.is_(True),
                TeamArenaMember.match_no == member.match_no,
                TeamArenaMember.side == member.side,
            )
            .count()
        )
        so_far = min(prior_correct * ASSIST_BONUS_PER_CORRECT, ASSIST_ROUND_CAP)
        team_delta, _individual_delta = score_assist_answer(
            is_correct=is_correct, round_assist_team_points_so_far=so_far
        )
        speed_bonus = 0
    else:
        team_delta = 0
        speed_bonus = 0
        if is_correct:
            points = score_active_answer(is_correct=True, elapsed_ms=elapsed_ms, limit_ms=answer_seconds * 1000)
            speed_bonus = points - 100  # TOWER_POINTS — kept local to avoid importing the constant twice
            team_delta = points

    answer = TeamArenaAnswer(
        session_id=session.id,
        member_id=member.id,
        turn_no=session.turn_no,
        role=role,
        choice=choice_key,
        correct=is_correct,
        elapsed_ms=elapsed_ms,
        speed_bonus=speed_bonus,
    )
    db.add(answer)
    try:
        db.flush()
    except Exception as exc:  # IntegrityError from the (session,member,turn) unique constraint
        db.rollback()
        raise HTTPException(status_code=409, detail="這回合已經作答過了") from exc

    if is_correct:
        team_cache["score"] = team_cache.get("score", 0) + team_delta
        if role == "active":
            path_state = PathState(towers_down=dict(team_cache["towers_down"]), base_hits=team_cache["base_hits"])
            new_state, event = apply_correct_answer(path_state, round_state["lane"])
            team_cache["towers_down"] = new_state.towers_down
            team_cache["base_hits"] = new_state.base_hits
            if event == "base_conquered":
                _end_match(session, member.match_no)
        flag_modified(session, "scoreboard")

    _bump_version(session)
    db.commit()
    db.refresh(session)
    # PRD §3.4: correctness is never revealed in the submit ack itself —
    # only via get_state once the round's reveal phase opens.
    return {"role": role, "turn_no": session.turn_no}


# ---------------------------------------------------------------------------
# State polling (role-aware, answer-safe)
# ---------------------------------------------------------------------------

def _public_round_view(round_state: dict, *, show_options: bool) -> dict:
    """Answer-safe projection of a team's current_round cache.

    Critic review (slice 2): this used to only strip `correct_key`
    pre-reveal — every poller saw the full `options` list from the very
    first `/state` poll of a turn, before PRD §0 decision 4 / §3.5's "先只
    顯示題幹，選項之後才出現" ever took effect. Same fix shape
    `live_quiz.engine`'s own `player_view(payload, revealed,
    show_options=...)` already uses for the identical "reading phase"
    requirement — `show_options` is the caller's own elapsed-time check
    (has `reading_seconds` passed for THIS turn), computed once per
    get_state call, not re-derived here.

    Never includes who-chose-what for any OTHER player (PRD §13 AC10) —
    there is no field here carrying another member's submitted choice at
    all, by construction (this cache only ever stores the team's shared
    current question, never individual answers).
    """
    payload = dict(round_state["payload"])
    if not round_state.get("revealed"):
        payload.pop("correct_key", None)
    if not show_options:
        payload.pop("options", None)
    return {
        "turn_no": round_state["turn_no"],
        "lane": round_state["lane"],
        "active_student_id": round_state["active_student_id"],
        "payload": payload,
        "reading_seconds": round_state["reading_seconds"],
        "answer_seconds": round_state["answer_seconds"],
        "revealed": round_state.get("revealed", False),
    }


def _team_summary(team_cache: dict) -> dict:
    return {
        "towers_down": dict(team_cache["towers_down"]),
        "base_hits": team_cache["base_hits"],
        "score": team_cache["score"],
        "match_status": team_cache["match_status"],
        "winner": team_cache.get("winner"),
    }


def _show_options_now(session: TeamArenaSession, round_state: dict) -> bool:
    """Has this turn's reading phase elapsed yet? PRD §0 decision 4 / §3.5:
    "先只顯示題幹，選項之後才出現" — computed fresh per get_state call from
    the server's own clock, never trusted from the client."""
    elapsed = (_now() - _aware(session.turn_started_at)).total_seconds()
    return elapsed >= round_state["reading_seconds"]


def get_state(db: Session, session: TeamArenaSession, user: User) -> dict:
    _advance_if_needed(db, session)

    is_teacher = session.teacher_id == user.id
    base = {
        "code": session.code,
        "status": session.status,
        "turn_no": session.turn_no,
        "state_version": session.state_version,
        "story": resolve_story_for_session(session.settings.get("story_pack_key")),
    }

    if is_teacher:
        matches: dict[str, dict] = {}
        by_team = _members_by_team(db, session.id)
        for (match_no, side), team_members in by_team.items():
            key = f"{match_no}:{side}"
            team_cache = session.scoreboard.get("matches", {}).get(key, {})
            entry = _team_summary(team_cache) if team_cache else {}
            if team_cache and team_cache.get("match_status") != "ended" and session.status == "playing":
                round_state = team_cache.get("current_round")
                if round_state and round_state.get("turn_no") == session.turn_no:
                    entry["current_round"] = _public_round_view(
                        round_state, show_options=_show_options_now(session, round_state)
                    )
            matches[key] = entry
        return {**base, "matches": matches}

    member = (
        db.query(TeamArenaMember)
        .filter(TeamArenaMember.session_id == session.id, TeamArenaMember.student_id == user.id)
        .first()
    )
    if member is None:
        return {**base, "own_match": None}

    key = f"{member.match_no}:{member.side}"
    team_cache = session.scoreboard.get("matches", {}).get(key, {})
    own_match = _team_summary(team_cache) if team_cache else {}
    if team_cache and team_cache.get("match_status") != "ended" and session.status == "playing":
        round_state = team_cache.get("current_round")
        if round_state and round_state.get("turn_no") == session.turn_no:
            own_match["current_round"] = _public_round_view(
                round_state, show_options=_show_options_now(session, round_state)
            )
    own_match["my_lane"] = member.lane
    own_match["am_i_active"] = (
        bool(own_match.get("current_round"))
        and own_match["current_round"]["active_student_id"] == user.id
    )
    return {**base, "own_match": own_match}


# ---------------------------------------------------------------------------
# Result (only after ended — PRD §13 AC13: team + individual numbers only,
# no individual ranking)
# ---------------------------------------------------------------------------

def get_result(db: Session, session: TeamArenaSession, user: User) -> dict:
    if session.status != "ended":
        raise HTTPException(status_code=409, detail="這場比賽還沒結束")

    matches: dict[str, dict] = {}
    by_team = _members_by_team(db, session.id)
    for (match_no, side), _team_members in by_team.items():
        key = f"{match_no}:{side}"
        team_cache = session.scoreboard.get("matches", {}).get(key, {})
        matches[key] = _team_summary(team_cache) if team_cache else {}

    member = (
        db.query(TeamArenaMember)
        .filter(TeamArenaMember.session_id == session.id, TeamArenaMember.student_id == user.id)
        .first()
    )
    me = None
    if member is not None:
        answers = (
            db.query(TeamArenaAnswer)
            .filter(TeamArenaAnswer.session_id == session.id, TeamArenaAnswer.member_id == member.id)
            .all()
        )
        turns_played = sum(1 for a in answers if a.role == "active")
        towers_knocked = sum(1 for a in answers if a.role == "active" and a.correct)
        assists = sum(1 for a in answers if a.role == "assist" and a.correct)
        me = {
            "lane": member.lane,
            "turns_played": turns_played,
            "towers_knocked": towers_knocked,
            "assists": assists,
        }

    return {"matches": matches, "me": me}
