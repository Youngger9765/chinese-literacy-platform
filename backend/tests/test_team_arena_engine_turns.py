"""TDD for team_arena.engine v2 — turn rotation + answer submission + tower
damage + win conditions (PRD §0 v2 改版 D/L, §13-style acceptance).

Time is controlled via monkeypatching ``engine._now`` to a mutable clock,
same pattern PK/live_quiz engine tests already use.
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

import pytest
from fastapi import HTTPException

from app.models.team_arena import TeamArenaMember
from app.services.team_arena import engine as svc
from app.services.team_arena import towers
from league_factories import enroll_student, make_classroom, make_school, make_student, make_teacher

GRADE = "4"  # verified real content (2,801 mixed-type rounds, see engine)


class Clock:
    def __init__(self, start: datetime):
        self.now = start

    def advance(self, **kwargs):
        self.now += timedelta(**kwargs)


@pytest.fixture()
def clock(monkeypatch):
    c = Clock(datetime(2026, 10, 20, 9, 0, 0, tzinfo=timezone.utc))
    monkeypatch.setattr(svc, "_now", lambda: c.now)
    return c


@pytest.fixture()
def db_session():
    from sqlalchemy import create_engine
    from sqlalchemy.orm import sessionmaker

    import app.models  # noqa: F401
    from app.models.base import Base

    engine = create_engine("sqlite:///:memory:", connect_args={"check_same_thread": False})
    Base.metadata.create_all(engine)
    SessionLocal = sessionmaker(bind=engine)
    session = SessionLocal()
    try:
        yield session
    finally:
        session.close()
        Base.metadata.drop_all(engine)


def _make_arena(db, clock, *, team_size=2, turns_per_player=1, answer_seconds=20):
    school = make_school(db)
    teacher = make_teacher(db)
    room = make_classroom(db, school, teacher, grade=int(GRADE))
    students = [make_student(db, name=f"s{i}") for i in range(team_size * 2)]
    for s in students:
        enroll_student(db, room, s)
    db.commit()

    host = students[0]
    session = svc.create_session(
        db, host, team_size=team_size, turns_per_player=turns_per_player,
        answer_seconds=answer_seconds, side="a",
    )
    side_a = [host] + students[1:team_size]
    side_b = students[team_size:]
    for s in side_a[1:]:
        svc.join_session(db, s, session.code, side="a")
    for s in side_b:
        svc.join_session(db, s, session.code, side="b")
    session = svc.control(db, session, host, action="start")

    members = db.query(TeamArenaMember).filter_by(session_id=session.id).order_by(TeamArenaMember.rotation_order).all()
    return {
        "db": db, "session": session, "host": host, "students": students,
        "side_a": side_a, "side_b": side_b, "members": members, "clock": clock,
    }


@pytest.fixture()
def arena(db_session, clock):
    return _make_arena(db_session, clock)


def _member_for(arena, student):
    return next(m for m in arena["members"] if m.student_id == student.id)


def _side_key(member: TeamArenaMember) -> str:
    return "a" if member.side == 0 else "b"


def _open_options(arena, side_key: str) -> dict:
    db, session = arena["db"], arena["session"]
    svc.get_state(db, session, arena["host"])  # triggers _advance_if_needed/_ensure_current_round
    round_state = session.scoreboard["sides"][side_key]["current_round"]
    arena["clock"].advance(seconds=round_state["reading_seconds"] + 0.2)
    svc.get_state(db, session, arena["host"])  # re-check (no-op advance, just refresh view)
    return session.scoreboard["sides"][side_key]["current_round"]


def _force_next_turn(arena):
    """Advance the clock comfortably past BOTH the answer window and the
    4s reveal window, then re-poll — the engine's own lazy
    `_advance_if_needed` moves `turn_no` forward on the next read. Used
    once a turn's outcome has already been recorded and the test wants to
    move on to the next one without caring about exact timing."""
    db, session = arena["db"], arena["session"]
    svc.get_state(db, session, arena["host"])
    max_reading = 0
    for side_key in ("a", "b"):
        rs = session.scoreboard.get("sides", {}).get(side_key, {}).get("current_round")
        if rs:
            max_reading = max(max_reading, rs["reading_seconds"])
    answer_seconds = session.settings["answer_seconds"]
    arena["clock"].advance(seconds=max_reading + answer_seconds + 10)
    svc.get_state(db, session, arena["host"])


def _answer(arena, member: TeamArenaMember, *, correct: bool, elapsed_after_open: float = 0.0):
    db, session = arena["db"], arena["session"]
    side_key = _side_key(member)
    round_state = _open_options(arena, side_key)
    if elapsed_after_open:
        arena["clock"].advance(seconds=elapsed_after_open)
    payload = round_state["payload"]
    correct_key = payload["correct_key"]
    choice = correct_key if correct else next(o["key"] for o in payload["options"] if o["key"] != correct_key)
    return svc.submit_answer(db, session, member.student, choice_key=choice)


class TestRotation:
    def test_turn_zero_active_is_rotation_order_zero_on_each_side(self, arena):
        svc.get_state(arena["db"], arena["session"], arena["host"])
        session = arena["session"]
        a_active = session.scoreboard["sides"]["a"]["current_round"]["active_student_id"]
        b_active = session.scoreboard["sides"]["b"]["current_round"]["active_student_id"]
        assert a_active == arena["side_a"][0].id
        assert b_active == arena["side_b"][0].id


class TestAnswerWindowGating:
    def test_answering_before_reading_phase_elapsed_is_409(self, arena):
        svc.get_state(arena["db"], arena["session"], arena["host"])
        member = _member_for(arena, arena["side_a"][0])
        payload = arena["session"].scoreboard["sides"]["a"]["current_round"]["payload"]
        with pytest.raises(HTTPException) as exc:
            svc.submit_answer(arena["db"], arena["session"], member.student, choice_key=payload["correct_key"])
        assert exc.value.status_code == 409

    def test_answering_after_window_closed_is_409(self, arena):
        member = _member_for(arena, arena["side_a"][0])
        round_state = _open_options(arena, "a")
        # Past the answer window but still short of REVEAL_SECONDS (4s)
        # past reveal_start, so the turn itself has not advanced yet —
        # same active member, now just too late to answer.
        arena["clock"].advance(seconds=round_state["answer_seconds"] + 1)
        with pytest.raises(HTTPException) as exc:
            svc.submit_answer(
                arena["db"], arena["session"], member.student,
                choice_key=round_state["payload"]["correct_key"],
            )
        assert exc.value.status_code == 409

    def test_non_active_member_cannot_answer(self, arena):
        """PRD §0 v2 rule E: support cannot submit a real answer at all."""
        non_active = _member_for(arena, arena["side_a"][1])
        _open_options(arena, "a")
        with pytest.raises(HTTPException) as exc:
            svc.submit_answer(arena["db"], arena["session"], non_active.student, choice_key="A")
        assert exc.value.status_code == 403

    def test_double_answer_same_turn_is_409(self, arena):
        member = _member_for(arena, arena["side_a"][0])
        _answer(arena, member, correct=True)
        round_state = arena["session"].scoreboard["sides"]["a"]["current_round"]
        with pytest.raises(HTTPException) as exc:
            svc.submit_answer(
                arena["db"], arena["session"], member.student,
                choice_key=round_state["payload"]["correct_key"],
            )
        assert exc.value.status_code == 409


def _total_damage(cache: dict) -> int:
    """Total HP knocked off the OPPONENT so far — `current_hp` alone is
    misleading once a hit exactly fells a structure (it resets to a fresh
    STRUCTURE_HP for the next one, PRD's "no overflow carry" design, see
    towers.py), so a meaningful "how much damage has landed" metric must
    also count fully-destroyed structures."""
    return cache["towers_destroyed"] * towers.STRUCTURE_HP + (towers.STRUCTURE_HP - cache["current_hp"])


class TestDamage:
    def test_correct_answer_damages_opponent_not_self(self, arena):
        active_a = _member_for(arena, arena["side_a"][0])
        _answer(arena, active_a, correct=True, elapsed_after_open=0.0)
        session = arena["session"]
        assert _total_damage(session.scoreboard["sides"]["b"]) > 0
        assert _total_damage(session.scoreboard["sides"]["a"]) == 0

    def test_wrong_answer_changes_nothing(self, arena):
        active_a = _member_for(arena, arena["side_a"][0])
        _answer(arena, active_a, correct=False)
        session = arena["session"]
        assert session.scoreboard["sides"]["b"]["current_hp"] == towers.STRUCTURE_HP
        assert session.scoreboard["sides"]["b"]["towers_destroyed"] == 0

    def test_faster_answer_deals_more_damage(self, db_session, clock):
        """Two independent arenas (fresh RNG seeds don't matter — damage is
        a pure function of elapsed/limit) compared at two different
        speeds. turns_per_player=2 (not the default 1) so turn 0 is NOT
        PRD rule P's 決戰時刻 -- a single-lap game makes its only turn the
        final lap by definition, which would double BOTH measurements and
        mask the speed difference this test exists to prove."""
        arena_fast = _make_arena(db_session, clock, turns_per_player=2, answer_seconds=20)
        fast_member = _member_for(arena_fast, arena_fast["side_a"][0])
        _answer(arena_fast, fast_member, correct=True, elapsed_after_open=0.0)
        fast_damage = _total_damage(arena_fast["session"].scoreboard["sides"]["b"])

        from sqlalchemy import create_engine
        from sqlalchemy.orm import sessionmaker
        import app.models  # noqa: F401
        from app.models.base import Base
        engine2 = create_engine("sqlite:///:memory:", connect_args={"check_same_thread": False})
        Base.metadata.create_all(engine2)
        db2 = sessionmaker(bind=engine2)()
        arena_slow = _make_arena(db2, clock, turns_per_player=2, answer_seconds=20)
        slow_member = _member_for(arena_slow, arena_slow["side_a"][0])
        _answer(arena_slow, slow_member, correct=True, elapsed_after_open=19.5)
        slow_damage = _total_damage(arena_slow["session"].scoreboard["sides"]["b"])

        assert fast_damage > slow_damage
        db2.close()
        Base.metadata.drop_all(engine2)


class TestCorrectKeyNeverLeaksPreReveal:
    def test_opponent_state_view_has_no_access_to_my_round(self, arena):
        svc.get_state(arena["db"], arena["session"], arena["host"])
        opponent_member = arena["side_b"][0]
        state = svc.get_state(arena["db"], arena["session"], opponent_member)
        # opponent's own_match is their OWN side's round — never side a's.
        assert state["own_match"]["my_side"] == "b"

    def test_active_players_own_view_hides_correct_key_before_reveal(self, arena):
        active_a = arena["side_a"][0]
        svc.get_state(arena["db"], arena["session"], arena["host"])
        round_state = arena["session"].scoreboard["sides"]["a"]["current_round"]
        arena["clock"].advance(seconds=round_state["reading_seconds"] + 0.2)
        state = svc.get_state(arena["db"], arena["session"], active_a)
        current = state["own_match"]["current_round"]
        assert "correct_key" not in current


class TestTowerProgressionAndWinConditions:
    def test_base_floors_at_1hp_before_showdown_then_falls_during_it(self, db_session, clock):
        """PRD v2 rule P end-to-end: team_size=2, turns_per_player=3 ->
        total_turns=6, 決戰時刻 = turns 4-5 (the last `team_size`=2 turns).
        Side a lands an instant, correct answer on EVERY one of its turns
        -> max damage each time; the 4th hit (turn_no=3, still pre-
        showdown) would fell the base but must floor at 1hp instead; the
        5th hit (turn_no=4, now showdown) actually destroys it."""
        arena = _make_arena(db_session, clock, team_size=2, turns_per_player=3, answer_seconds=20)

        def _land_one_hit():
            svc.get_state(arena["db"], arena["session"], arena["host"])
            active_student_id = arena["session"].scoreboard["sides"]["a"]["current_round"]["active_student_id"]
            member = next(m for m in arena["members"] if m.student_id == active_student_id)
            _answer(arena, member, correct=True, elapsed_after_open=0.0)

        # Hits 1-3: fell all 3 towers (turns 0, 1, 2).
        for _ in range(3):
            _land_one_hit()
            _force_next_turn(arena)
        cache_b = arena["session"].scoreboard["sides"]["b"]
        assert cache_b["towers_destroyed"] == towers.TOWER_COUNT
        assert cache_b["current_hp"] == towers.STRUCTURE_HP  # now attacking a fresh base

        # Hit 4 (turn_no=3): still PRE-showdown (showdown starts at
        # turn_no=4) -- base must NOT fall, floors at 1hp instead.
        _land_one_hit()
        cache_b = arena["session"].scoreboard["sides"]["b"]
        assert cache_b["base_destroyed"] is False
        assert cache_b["current_hp"] == towers.BASE_HP_FLOOR_BEFORE_SHOWDOWN
        assert arena["session"].status == "playing"
        _force_next_turn(arena)

        # Hit 5 (turn_no=4): now IN showdown -- this hit actually destroys
        # the base and ends the whole session immediately.
        _land_one_hit()
        assert arena["session"].status == "ended"
        assert arena["session"].scoreboard["sides"]["b"]["base_destroyed"] is True
        assert arena["session"].scoreboard["sides"]["a"]["winner"] == "a"
        assert arena["session"].scoreboard["sides"]["b"]["winner"] == "a"

    def test_turns_exhausted_without_base_destroyed_decides_by_progress(self, arena):
        """team_size=2, turns_per_player=1 -> total_turns=2, nowhere near
        enough damage to finish a base — exercises the tie-break path.

        Code-reviewer note: turns_per_player=1 means turn_no=0 is this
        match's only lap AND its final lap -- i.e. is_showdown_turn is
        True from the start (see test_single_lap_game_is_showdown_from_
        turn_zero in test_team_arena_towers.py), so the one correct
        answer below actually deals DOUBLED damage. The assertion below
        only needs "a dealt some damage, b dealt none" (strictly ahead),
        which holds regardless — it is not asserting an exact HP value,
        so the showdown doubling does not change what this test proves.
        """
        active_a0 = _member_for(arena, arena["side_a"][0])
        _answer(arena, active_a0, correct=True, elapsed_after_open=0.0)  # a deals dmg to b
        # b never answers EITHER of its two turns (times out) -> no damage
        # back the whole match; team_size=2 * turns_per_player=1 = 2 total
        # turns, so two forced advances exhaust the match.
        _force_next_turn(arena)
        _force_next_turn(arena)

        assert arena["session"].status == "ended"
        # a dealt damage to b, b never damaged a -> a is strictly ahead.
        assert arena["session"].scoreboard["sides"]["a"]["winner"] == "a"
        assert arena["session"].scoreboard["sides"]["b"]["winner"] == "a"


class TestGetResult:
    def test_result_has_no_individual_ranking_or_score_only_a_highlight(self, arena):
        """PRD §0 v2 rule Q: no per-player ranking/score anywhere in this
        payload -- only a team result and one real highlight sentence."""
        active_a0 = _member_for(arena, arena["side_a"][0])
        _answer(arena, active_a0, correct=True, elapsed_after_open=0.0)
        svc.control(arena["db"], arena["session"], arena["host"], action="end")
        result = svc.get_result(arena["db"], arena["session"], active_a0.student)

        assert "a" in result["sides"] and "b" in result["sides"]
        assert set(result["me"].keys()) == {"my_side", "highlight"}
        assert isinstance(result["me"]["highlight"], str) and result["me"]["highlight"]

        # The whole roster is visible (both sides), each with a name + a
        # highlight sentence only -- no numeric field anywhere that could
        # be read as a score or used to rank players against each other.
        for side_key in ("a", "b"):
            for player in result["players"][side_key]:
                assert set(player.keys()) == {"student_id", "display_name", "highlight"}

    def test_highlight_traces_to_a_real_logged_event_not_invention(self, arena):
        """The player who fells the opponent's tower gets the tower-fallen
        highlight; this is derived from the events log `submit_answer`
        appends, not guessed from aggregate stats."""
        active_a0 = _member_for(arena, arena["side_a"][0])
        _answer(arena, active_a0, correct=True, elapsed_after_open=0.0)
        events = arena["session"].scoreboard["events"]
        assert events and events[0]["student_id"] == active_a0.student_id
        assert events[0]["correct"] is True
        assert events[0]["event"] in ("tower_fallen", "damage", "tower_fallen_to_base", "base_destroyed")

        svc.control(arena["db"], arena["session"], arena["host"], action="end")
        result = svc.get_result(arena["db"], arena["session"], active_a0.student)
        my_highlight = result["me"]["highlight"]
        assert my_highlight != svc._HIGHLIGHT_NEUTRAL  # this player DID do something real

    def test_player_with_no_events_gets_a_neutral_non_negative_line(self, arena):
        """A member who never got to act (e.g. the match ended before
        their turn) still gets a highlight -- a neutral one, never a
        negative framing of "did nothing"."""
        svc.control(arena["db"], arena["session"], arena["host"], action="end")
        someone = arena["side_b"][0]  # never answered in this test
        result = svc.get_result(arena["db"], arena["session"], someone)
        assert result["me"]["highlight"] == svc._HIGHLIGHT_NEUTRAL

    def test_result_before_ended_is_409(self, arena):
        with pytest.raises(HTTPException) as exc:
            svc.get_result(arena["db"], arena["session"], arena["host"])
        assert exc.value.status_code == 409

    def test_non_participant_gets_403(self, arena):
        svc.control(arena["db"], arena["session"], arena["host"], action="end")
        stranger = make_student(arena["db"], name="stranger")
        arena["db"].commit()
        with pytest.raises(HTTPException) as exc:
            svc.get_result(arena["db"], arena["session"], stranger)
        assert exc.value.status_code == 403
