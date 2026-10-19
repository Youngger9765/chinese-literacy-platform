"""TDD for team_arena.engine — turn resolution + answer submission + state
polling + result (PRD §3.1-§3.5, §13 AC4-AC13).

Time is controlled via monkeypatching ``engine._now`` to a mutable clock,
same pattern as test_pk_engine.py's Clock fixture.
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

import pytest
from fastapi import HTTPException

from app.models.team_arena import TeamArenaMember
from app.services.team_arena import engine as svc
from league_factories import enroll_student, make_classroom, make_school, make_student, make_teacher

LESSON_A = "L0125"  # verified real content for zhuyin/vocab_definitions/vocab_application/comprehension


class Clock:
    def __init__(self, start: datetime):
        self.now = start

    def advance(self, **kwargs):
        self.now += timedelta(**kwargs)


@pytest.fixture()
def clock(monkeypatch):
    c = Clock(datetime(2026, 10, 19, 9, 0, 0, tzinfo=timezone.utc))
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


@pytest.fixture()
def arena(db_session, clock):
    """One 4v4 session (2 complete teams, 1 match), teams formed, started.
    4-person teams have no support lane (teams.py already locks this), which
    keeps turn resolution simple/deterministic for these tests."""
    school = make_school(db_session)
    teacher = make_teacher(db_session)
    room = make_classroom(db_session, school, teacher, feature_settings={"team_arena": True})
    db_session.commit()
    students = []
    for _ in range(8):
        s = make_student(db_session)
        enroll_student(db_session, room, s)
        students.append(s)
    db_session.commit()

    session = svc.create_session(
        db_session, teacher, classroom_id=room.id, scope_type="lesson", scope_ref=LESSON_A,
        turns_per_player=1, answer_seconds=20,
    )
    for s in students:
        svc.join_session(db_session, s, session.code)
    svc.assign_teams(db_session, session, teacher, action="auto")
    session = svc.control(db_session, session, teacher, action="start")

    members = db_session.query(TeamArenaMember).filter_by(session_id=session.id).all()
    return {
        "db": db_session, "session": session, "teacher": teacher,
        "students": students, "members": members, "clock": clock,
    }


def _open_options(arena, match_no=0, side=0):
    """Advance the test clock past this team's reading phase so the answer
    window ("options visible") is open — mirrors a real student waiting
    for the stem-reading countdown before the buttons appear."""
    db, session, teacher = arena["db"], arena["session"], arena["teacher"]
    svc.get_state(db, session, teacher)  # populates current_round cache, incl. reading_seconds
    db.refresh(session)
    key = f"{match_no}:{side}"
    reading_seconds = session.scoreboard["matches"][key]["current_round"]["reading_seconds"]
    arena["clock"].advance(seconds=reading_seconds + 0.5)


def _member_for(arena, student):
    return next(m for m in arena["members"] if m.student_id == student.id)


def _active_student(arena, match_no, side):
    db, session = arena["db"], arena["session"]
    team = [m for m in arena["members"] if m.match_no == match_no and m.side == side]
    local = session.turn_no % len(team)
    active_member = next(m for m in team if m.rotation_order == local)
    return next(s for s in arena["students"] if s.id == active_member.student_id)


def _teammate_not_active(arena, match_no, side):
    db, session = arena["db"], arena["session"]
    team = [m for m in arena["members"] if m.match_no == match_no and m.side == side]
    local = session.turn_no % len(team)
    other = next(m for m in team if m.rotation_order != local)
    return next(s for s in arena["students"] if s.id == other.student_id)


class TestStartGeneratesQuestionQueues:
    def test_every_member_has_a_non_empty_question_queue(self, arena):
        for m in arena["members"]:
            assert m.question_queue
            if m.lane == "support":
                assert all(m.question_queue["support"][lane] for lane in m.question_queue["support"])
            else:
                assert m.question_queue["fixed"]

    def test_total_turns_computed_and_stored(self, arena):
        session = arena["session"]
        assert session.settings["total_turns"] == 1 * 4  # turns_per_player=1, team_size=4


class TestGetStateHidesSecretsPreReveal:
    """PRD §13 AC10: 隊友私下答對時，上場者輪詢 state 看不到他的選項."""

    def test_correct_key_hidden_before_reveal(self, arena):
        db, session = arena["db"], arena["session"]
        active = _active_student(arena, 0, 0)
        state = svc.get_state(db, session, active)
        own_match = state["own_match"]
        assert "correct_key" not in own_match["current_round"]["payload"]

    def test_assist_choice_not_visible_to_active_player(self, arena):
        db, session = arena["db"], arena["session"]
        active = _active_student(arena, 0, 0)
        assistant = _teammate_not_active(arena, 0, 0)
        _open_options(arena)
        svc.submit_answer(db, session, assistant, choice_key="A")
        state = svc.get_state(db, session, active)
        assert "assist_choices" not in str(state["own_match"])  # no raw choice leakage anywhere in payload


class TestSubmitAnswerRoleResolution:
    def test_active_player_answer_recorded_as_active(self, arena):
        db, session = arena["db"], arena["session"]
        active = _active_student(arena, 0, 0)
        _open_options(arena)
        result = svc.submit_answer(db, session, active, choice_key="A")
        assert result["role"] == "active"

    def test_non_active_teammate_answer_recorded_as_assist(self, arena):
        db, session = arena["db"], arena["session"]
        assistant = _teammate_not_active(arena, 0, 0)
        _open_options(arena)
        result = svc.submit_answer(db, session, assistant, choice_key="A")
        assert result["role"] == "assist"

    def test_double_submit_same_turn_is_409(self, arena):
        db, session = arena["db"], arena["session"]
        active = _active_student(arena, 0, 0)
        _open_options(arena)
        svc.submit_answer(db, session, active, choice_key="A")
        with pytest.raises(HTTPException) as exc:
            svc.submit_answer(db, session, active, choice_key="B")
        assert exc.value.status_code == 409

    def test_submit_response_never_reveals_correctness_immediately(self, arena):
        """PRD §3.4: "每回合結束，自己手機看到...不公開對錯" — the ack itself
        must not leak whether the answer was right, even to its own author,
        before reveal."""
        db, session = arena["db"], arena["session"]
        active = _active_student(arena, 0, 0)
        _open_options(arena)
        result = svc.submit_answer(db, session, active, choice_key="A")
        assert "correct" not in result
        assert "is_correct" not in result


class TestWrongAnswerDoesNotRegressTowers:
    def test_wrong_active_answer_does_not_move_towers(self, arena):
        db, session = arena["db"], arena["session"]
        active = _active_student(arena, 0, 0)
        _open_options(arena)
        db.refresh(session)
        before = dict(session.scoreboard["matches"]["0:0"]["towers_down"])
        before_score = session.scoreboard["matches"]["0:0"]["score"]
        svc.submit_answer(db, session, active, choice_key="definitely-not-a-real-key")
        db.refresh(session)
        after = session.scoreboard["matches"]["0:0"]["towers_down"]
        assert after == before
        assert session.scoreboard["matches"]["0:0"]["score"] == before_score


class TestAnswerBeforeOptionsAppearIs409:
    """PRD §13 AC7."""

    def test_answer_during_reading_phase_rejected(self, arena):
        db, session = arena["db"], arena["session"]
        active = _active_student(arena, 0, 0)
        # Force a long reading phase by using a long comprehension stem —
        # simplest reliable way: directly inspect the cached round's
        # reading_seconds and answer before it elapses.
        state = svc.get_state(db, session, active)
        reading_seconds = state["own_match"]["current_round"]["reading_seconds"]
        if reading_seconds <= 0:
            pytest.skip("this stem's reading phase is effectively zero seconds")
        with pytest.raises(HTTPException) as exc:
            svc.submit_answer(db, session, active, choice_key="A")
        assert exc.value.status_code == 409


class TestAssistRoundCap:
    def test_assist_bonus_capped_at_30_per_round(self, arena):
        """4-person team => up to 3 assist submissions possible this turn.
        3 correct assists = 3x10 = 30, exactly at the cap."""
        db, session = arena["db"], arena["session"]
        active = _active_student(arena, 0, 0)
        _open_options(arena)
        db.refresh(session)
        correct_key = _reveal_correct_key_for_test(db, session, 0, 0)

        team = [m for m in arena["members"] if m.match_no == 0 and m.side == 0]
        assistants = [
            next(s for s in arena["students"] if s.id == m.student_id)
            for m in team if m.student_id != active.id
        ]
        for a in assistants:
            svc.submit_answer(db, session, a, choice_key=correct_key)

        db.refresh(session)
        assert session.scoreboard["matches"]["0:0"]["score"] == 30


def _reveal_correct_key_for_test(db, session, match_no, side):
    """Test-only helper: peek the server-cached payload's correct_key
    directly from the ORM session.scoreboard cache (bypassing the
    answer-safe get_state payload on purpose, to construct a guaranteed-
    correct submission for scoring tests)."""
    key = f"{match_no}:{side}"
    return session.scoreboard["matches"][key]["current_round"]["payload"]["correct_key"]


class TestActiveCorrectAnswerAdvancesTowers:
    def test_correct_active_answer_knocks_a_tower(self, arena):
        db, session = arena["db"], arena["session"]
        active = _active_student(arena, 0, 0)
        _open_options(arena)
        db.refresh(session)
        correct_key = _reveal_correct_key_for_test(db, session, 0, 0)
        result = svc.submit_answer(db, session, active, choice_key=correct_key)
        assert result["role"] == "active"
        db.refresh(session)
        towers = session.scoreboard["matches"]["0:0"]["towers_down"]
        assert sum(towers.values()) == 1
        assert session.scoreboard["matches"]["0:0"]["score"] >= 100


class TestGetStateRejectsNonMembers:
    """Rate-limit exemption test (test_team_arena_rate_limit.py) found this
    gap: a non-member (authenticated, but never joined/assigned to this
    session) used to get a 200 with `own_match: None` instead of a 403 —
    leaking the session's existence/status to a stranger who merely knows
    the code, unlike pk/live_quiz's equivalent routes."""

    def test_stranger_gets_403(self, arena):
        db, session = arena["db"], arena["session"]
        stranger = make_student(db, name="路人")
        db.commit()
        with pytest.raises(HTTPException) as exc:
            svc.get_state(db, session, stranger)
        assert exc.value.status_code == 403

    def test_roster_only_member_not_yet_team_assigned_is_allowed(self, db_session, clock):
        school = make_school(db_session)
        teacher = make_teacher(db_session)
        room = make_classroom(db_session, school, teacher, feature_settings={"team_arena": True})
        db_session.commit()
        student = make_student(db_session)
        enroll_student(db_session, room, student)
        db_session.commit()
        session = svc.create_session(
            db_session, teacher, classroom_id=room.id, scope_type="lesson", scope_ref=LESSON_A,
        )
        svc.join_session(db_session, student, session.code)
        # No assign_teams call yet — this student is lobby-roster-only.
        state = svc.get_state(db_session, session, student)
        assert state["own_match"] is None


class TestOptionsHiddenDuringReadingPhase:
    """Critic review (slice 2): _public_round_view stripped correct_key
    pre-reveal but NOT `options` — every poller saw the full answer list
    from the very first /state poll of a turn, before PRD §0 decision 4 /
    §3.5's "先只顯示題幹，選項之後才出現" ever took effect. Mirrors
    live_quiz.engine's own fix for the identical problem
    (player_view(..., show_options=not in_reading_phase))."""

    def test_options_absent_while_still_reading(self, arena):
        db, session = arena["db"], arena["session"]
        active = _active_student(arena, 0, 0)
        state = svc.get_state(db, session, active)
        round_state = state["own_match"]["current_round"]
        if round_state["reading_seconds"] <= 0:
            pytest.skip("this stem's reading phase is effectively zero seconds")
        assert "options" not in round_state["payload"]

    def test_options_present_once_reading_phase_elapses(self, arena):
        db, session = arena["db"], arena["session"]
        active = _active_student(arena, 0, 0)
        _open_options(arena)
        state = svc.get_state(db, session, active)
        round_state = state["own_match"]["current_round"]
        assert "options" in round_state["payload"]

    def test_teacher_feed_also_hides_options_during_reading(self, arena):
        db, session, teacher = arena["db"], arena["session"], arena["teacher"]
        state = svc.get_state(db, session, teacher)
        round_state = state["matches"]["0:0"].get("current_round")
        if not round_state or round_state["reading_seconds"] <= 0:
            pytest.skip("this stem's reading phase is effectively zero seconds")
        assert "options" not in round_state["payload"]


class TestStateVersionIncrementsOnMutation:
    """Critic review (slice 2): state_version was written to the model but
    never bumped anywhere — after_version polling would short-circuit to
    "unchanged" forever after the first poll, regardless of real
    progress."""

    def test_version_bumps_after_join(self, db_session, clock):
        school = make_school(db_session)
        teacher = make_teacher(db_session)
        room = make_classroom(db_session, school, teacher, feature_settings={"team_arena": True})
        db_session.commit()
        student = make_student(db_session)
        enroll_student(db_session, room, student)
        db_session.commit()
        session = svc.create_session(
            db_session, teacher, classroom_id=room.id, scope_type="lesson", scope_ref=LESSON_A,
        )
        before = svc.get_state(db_session, session, teacher)["state_version"]
        svc.join_session(db_session, student, session.code)
        after = svc.get_state(db_session, session, teacher)["state_version"]
        assert after > before

    def test_version_bumps_after_start(self, arena):
        # arena fixture already called create/join/assign_teams/control(start)
        # — compare a version captured right after start against one after
        # a subsequent mutating call (lane claim is locked post-start, so use
        # control "end" here as an unambiguous mutating action).
        db, session, teacher = arena["db"], arena["session"], arena["teacher"]
        before = svc.get_state(db, session, teacher)["state_version"]
        svc.control(db, session, teacher, action="end")
        after = svc.get_state(db, session, teacher)["state_version"]
        assert after > before

    def test_version_bumps_after_answer_submission(self, arena):
        db, session = arena["db"], arena["session"]
        active = _active_student(arena, 0, 0)
        _open_options(arena)
        before = svc.get_state(db, session, active)["state_version"]
        svc.submit_answer(db, session, active, choice_key="A")
        after = svc.get_state(db, session, active)["state_version"]
        assert after > before


class TestEndMatchWinnerConsistency:
    """Critic review (slice 3): _end_match's actual scoreboard WRITE path
    (not just the pure decide_match_winner function, which IS already
    tested) used to flip the winner for side b — a["winner"]="a" paired
    with b["winner"]="b" for the exact same match, so the two tiles for
    the same match told the teacher contradictory stories. Calls the real
    `_end_match` against a real session's real scoreboard dict (not a
    hand-built fixture), so this still exercises the actual write path —
    it just skips replaying dozens of real turns to reach the end state."""

    @pytest.mark.parametrize("winning_side,expected", [(0, "a"), (1, "b")])
    def test_both_sides_record_the_same_winner(self, arena, winning_side, expected):
        db, session = arena["db"], arena["session"]
        matches = session.scoreboard["matches"]
        matches["0:0"]["base_hits"] = svc.BASE_HITS_TO_WIN if winning_side == 0 else 0
        matches["0:1"]["base_hits"] = svc.BASE_HITS_TO_WIN if winning_side == 1 else 0

        svc._end_match(session, 0)

        a = session.scoreboard["matches"]["0:0"]
        b = session.scoreboard["matches"]["0:1"]
        assert a["match_status"] == "ended"
        assert b["match_status"] == "ended"
        assert a["winner"] == b["winner"] == expected, (
            f"both tiles of the SAME match must agree on who won: a={a['winner']!r} b={b['winner']!r}"
        )

    def test_draw_is_also_consistent(self, arena):
        db, session = arena["db"], arena["session"]
        svc._end_match(session, 0)  # both sides start at base_hits=0, score=0 -> draw
        a = session.scoreboard["matches"]["0:0"]
        b = session.scoreboard["matches"]["0:1"]
        assert a["winner"] == b["winner"] == "draw"


class TestOwnMatchExposesMySide:
    """Fix for a gap the critic flagged: the frontend needs to know which
    side ("a"/"b") the student is actually on to correctly say win/lose
    relative to `winner`, not just echo a generic "比賽結果已產生"."""

    def test_side_0_member_is_side_a(self, arena):
        db, session = arena["db"], arena["session"]
        student = _active_student(arena, 0, 0)
        state = svc.get_state(db, session, student)
        assert state["own_match"]["my_side"] == "a"

    def test_side_1_member_is_side_b(self, arena):
        db, session = arena["db"], arena["session"]
        member = next(m for m in arena["members"] if m.match_no == 0 and m.side == 1)
        student = next(s for s in arena["students"] if s.id == member.student_id)
        state = svc.get_state(db, session, student)
        assert state["own_match"]["my_side"] == "b"


class TestControlEnd:

    def test_teacher_can_force_end_anytime(self, arena):
        db, session, teacher = arena["db"], arena["session"], arena["teacher"]
        ended = svc.control(db, session, teacher, action="end")
        assert ended.status == "ended"
        assert ended.ended_at is not None


class TestGetResultOnlyAfterEnded:
    def test_result_before_ended_is_409(self, arena):
        db, session, students = arena["db"], arena["session"], arena["students"]
        with pytest.raises(HTTPException) as exc:
            svc.get_result(db, session, students[0])
        assert exc.value.status_code == 409

    def test_result_after_ended_has_team_and_individual_numbers_no_ranking(self, arena):
        db, session, teacher, students = arena["db"], arena["session"], arena["teacher"], arena["students"]
        svc.control(db, session, teacher, action="end")
        db.refresh(session)
        result = svc.get_result(db, session, students[0])
        assert "matches" in result
        assert "rank" not in str(result).lower() or "ranking" not in str(result).lower()
        own = result["me"]
        assert "turns_played" in own
        assert "towers_knocked" in own
        assert "assists" in own
