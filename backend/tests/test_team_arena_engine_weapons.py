"""TDD for team_arena.engine v2 — weapons (PRD §0 v2 改版 F/G/H/I/J)."""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

import pytest
from fastapi import HTTPException

from app.models.team_arena import TeamArenaMember
from app.services.team_arena import engine as svc
from app.services.team_arena import towers
from league_factories import enroll_student, make_classroom, make_school, make_student, make_teacher

GRADE = 4


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


@pytest.fixture()
def arena(db_session, clock):
    school = make_school(db_session)
    teacher = make_teacher(db_session)
    room = make_classroom(db_session, school, teacher, grade=GRADE)
    students = [make_student(db_session, name=f"s{i}") for i in range(4)]
    for s in students:
        enroll_student(db_session, room, s)
    db_session.commit()

    host = students[0]
    session = svc.create_session(db_session, host, team_size=2, turns_per_player=2, answer_seconds=30, side="a")
    svc.join_session(db_session, students[1], session.code, side="a")
    svc.join_session(db_session, students[2], session.code, side="b")
    svc.join_session(db_session, students[3], session.code, side="b")
    session = svc.control(db_session, session, host, action="start")

    members = db_session.query(TeamArenaMember).filter_by(session_id=session.id).order_by(TeamArenaMember.rotation_order).all()
    return {
        "db": db_session, "session": session, "host": host, "students": students,
        "side_a": [host, students[1]], "side_b": [students[2], students[3]],
        "members": members, "clock": clock,
    }


def _open_options(arena, side_key: str) -> dict:
    db, session = arena["db"], arena["session"]
    svc.get_state(db, session, arena["host"])
    round_state = session.scoreboard["sides"][side_key]["current_round"]
    arena["clock"].advance(seconds=round_state["reading_seconds"] + 0.2)
    svc.get_state(db, session, arena["host"])
    return session.scoreboard["sides"][side_key]["current_round"]


def _active_member(arena, side_key: str) -> TeamArenaMember:
    round_state = arena["session"].scoreboard["sides"][side_key]["current_round"]
    return next(m for m in arena["members"] if m.id == round_state["active_member_id"])


class TestEliminate:
    def test_reduces_to_two_options_including_correct(self, arena):
        _open_options(arena, "a")
        member = _active_member(arena, "a")
        result = svc.use_weapon(arena["db"], arena["session"], member.student, weapon="eliminate")
        assert result["weapon"] == "eliminate"
        options = result["options"]
        assert len(options) == 2
        correct_key = arena["session"].scoreboard["sides"]["a"]["current_round"]["payload"]["correct_key"]
        assert any(o["key"] == correct_key for o in options)

    def test_cannot_use_twice_same_game(self, arena):
        _open_options(arena, "a")
        member = _active_member(arena, "a")
        svc.use_weapon(arena["db"], arena["session"], member.student, weapon="eliminate")
        with pytest.raises(HTTPException) as exc:
            svc.use_weapon(arena["db"], arena["session"], member.student, weapon="eliminate")
        assert exc.value.status_code == 409

    def test_only_active_player_can_use_weapon(self, arena):
        _open_options(arena, "a")
        active_member_id = arena["session"].scoreboard["sides"]["a"]["current_round"]["active_member_id"]
        non_active_member = next(m for m in arena["members"] if m.side == 0 and m.id != active_member_id)
        with pytest.raises(HTTPException) as exc:
            svc.use_weapon(arena["db"], arena["session"], non_active_member.student, weapon="eliminate")
        assert exc.value.status_code == 403

    def test_disabled_without_consuming_quota_when_too_few_options(self, arena, monkeypatch):
        """PRD rule I: 本來就只有 2 個選項的題目不能用，按鈕灰掉且不扣次數."""
        _open_options(arena, "a")
        member = _active_member(arena, "a")
        round_state = arena["session"].scoreboard["sides"]["a"]["current_round"]
        # Force a 2-option question to simulate zhuyin's narrower option sets.
        round_state["payload"] = {**round_state["payload"], "options": round_state["payload"]["options"][:2]}
        with pytest.raises(HTTPException) as exc:
            svc.use_weapon(arena["db"], arena["session"], member.student, weapon="eliminate")
        assert exc.value.status_code == 409
        weapons_used = member.question_queue["weapons_used"]
        assert weapons_used["eliminate"] is False


class TestHint:
    def test_zhuyin_question_gets_a_hint(self, arena):
        _open_options(arena, "a")
        member = _active_member(arena, "a")
        payload = arena["session"].scoreboard["sides"]["a"]["current_round"]["payload"]
        if payload.get("source_module") != "zhuyin":
            pytest.skip("this turn's drawn question is not zhuyin")
        result = svc.use_weapon(arena["db"], arena["session"], member.student, weapon="hint")
        assert result["hint_text"]
        assert payload["correct_key"] not in result["hint_text"]

    def test_non_zhuyin_question_has_no_hint_and_quota_not_consumed(self, arena):
        _open_options(arena, "a")
        member = _active_member(arena, "a")
        round_state = arena["session"].scoreboard["sides"]["a"]["current_round"]
        round_state["payload"] = {**round_state["payload"], "source_module": "vocab_definitions"}
        with pytest.raises(HTTPException) as exc:
            svc.use_weapon(arena["db"], arena["session"], member.student, weapon="hint")
        assert exc.value.status_code == 409
        assert member.question_queue["weapons_used"]["hint"] is False


class TestCallTeammate:
    def test_teammate_sees_nothing_until_summoned(self, arena):
        _open_options(arena, "a")
        teammate = next(m for m in arena["members"] if m.side == 0 and m.id != arena["session"].scoreboard["sides"]["a"]["current_round"]["active_member_id"])
        state = svc.get_state(arena["db"], arena["session"], teammate.student)
        current = state["own_match"]["current_round"]
        assert current["called_for_help"] is False
        assert "stem" not in current

    def test_after_call_teammate_sees_full_options_and_can_suggest(self, arena):
        _open_options(arena, "a")
        active = _active_member(arena, "a")
        teammate = next(m for m in arena["members"] if m.side == 0 and m.id != active.id)

        svc.use_weapon(arena["db"], arena["session"], active.student, weapon="call_teammate")

        state = svc.get_state(arena["db"], arena["session"], teammate.student)
        current = state["own_match"]["current_round"]
        assert current["called_for_help"] is True
        assert current["options"]  # full, non-eliminated options

        suggestion_options = current["options"]
        pick = suggestion_options[0]["key"]
        res = svc.submit_suggestion(arena["db"], arena["session"], teammate.student, choice_key=pick)
        assert res["status"] == "ok"

    def test_active_player_sees_teammate_suggestions(self, arena):
        _open_options(arena, "a")
        active = _active_member(arena, "a")
        teammate = next(m for m in arena["members"] if m.side == 0 and m.id != active.id)
        svc.use_weapon(arena["db"], arena["session"], active.student, weapon="call_teammate")
        options = arena["session"].scoreboard["sides"]["a"]["current_round"]["payload"]["options"]
        svc.submit_suggestion(arena["db"], arena["session"], teammate.student, choice_key=options[0]["key"])

        state = svc.get_state(arena["db"], arena["session"], active.student)
        suggestions = state["own_match"]["current_round"]["suggestions"]
        assert len(suggestions) == 1
        assert suggestions[0]["student_id"] == teammate.student_id
        assert suggestions[0]["choice_key"] == options[0]["key"]
        # Privacy (PRD rule M): no email/school/class leaked, only a name.
        assert set(suggestions[0].keys()) == {"student_id", "display_name", "choice_key"}

    def test_opponent_side_never_sees_my_suggestions(self, arena):
        _open_options(arena, "a")
        active_a = _active_member(arena, "a")
        teammate_a = next(m for m in arena["members"] if m.side == 0 and m.id != active_a.id)
        svc.use_weapon(arena["db"], arena["session"], active_a.student, weapon="call_teammate")
        options = arena["session"].scoreboard["sides"]["a"]["current_round"]["payload"]["options"]
        svc.submit_suggestion(arena["db"], arena["session"], teammate_a.student, choice_key=options[0]["key"])

        opponent = arena["side_b"][0]
        state = svc.get_state(arena["db"], arena["session"], opponent)
        assert state["own_match"]["my_side"] == "b"
        # b's own current_round (if any) must never carry a's suggestions.
        own_round = state["own_match"].get("current_round")
        if own_round:
            assert "suggestions" not in own_round or own_round is None

    def test_active_player_cannot_suggest_to_self(self, arena):
        _open_options(arena, "a")
        active = _active_member(arena, "a")
        svc.use_weapon(arena["db"], arena["session"], active.student, weapon="call_teammate")
        with pytest.raises(HTTPException) as exc:
            svc.submit_suggestion(arena["db"], arena["session"], active.student, choice_key="A")
        assert exc.value.status_code == 403

    def test_suggestion_without_call_teammate_is_409(self, arena):
        _open_options(arena, "a")
        active = _active_member(arena, "a")
        teammate = next(m for m in arena["members"] if m.side == 0 and m.id != active.id)
        with pytest.raises(HTTPException) as exc:
            svc.submit_suggestion(arena["db"], arena["session"], teammate.student, choice_key="A")
        assert exc.value.status_code == 409

    def test_teammate_cannot_submit_a_real_scored_answer(self, arena):
        """PRD rule E: 支援只能建議，不能代答 — /answer itself must reject
        a non-active member outright, call_teammate or not."""
        _open_options(arena, "a")
        active = _active_member(arena, "a")
        teammate = next(m for m in arena["members"] if m.side == 0 and m.id != active.id)
        svc.use_weapon(arena["db"], arena["session"], active.student, weapon="call_teammate")
        with pytest.raises(HTTPException) as exc:
            svc.submit_answer(arena["db"], arena["session"], teammate.student, choice_key="A")
        assert exc.value.status_code == 403


class TestWeaponHalvesDamage:
    def test_correct_answer_after_weapon_deals_half_damage(self, arena):
        round_state = _open_options(arena, "a")
        active = _active_member(arena, "a")
        svc.use_weapon(arena["db"], arena["session"], active.student, weapon="call_teammate")
        correct_key = round_state["payload"]["correct_key"]
        svc.submit_answer(arena["db"], arena["session"], active.student, choice_key=correct_key)

        cache_b = arena["session"].scoreboard["sides"]["b"]
        total_damage = cache_b["towers_destroyed"] * towers.STRUCTURE_HP + (towers.STRUCTURE_HP - cache_b["current_hp"])
        expected = towers.compute_damage(elapsed_ms=200, limit_ms=30_000, weapon_used=True)
        # elapsed is ~0.2s after options opened in this test's timing, so
        # compare against the halved-damage ceiling rather than an exact
        # equality (avoids coupling this test to msec-perfect timing).
        assert total_damage <= towers.compute_damage(elapsed_ms=0, limit_ms=30_000, weapon_used=False) // 2 + 1
        assert total_damage == expected or abs(total_damage - expected) <= 1
