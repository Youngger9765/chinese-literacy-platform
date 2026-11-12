from __future__ import annotations

from datetime import datetime, timedelta, timezone

import pytest
from fastapi import HTTPException
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.models.base import Base
import app.models  # noqa: F401
from app.services.escape_room import engine as svc
from app.services.game_core import scope as scope_svc
from league_factories import make_student


class Clock:
    def __init__(self):
        self.now = datetime(2026, 10, 17, tzinfo=timezone.utc)

    def advance(self, **kwargs):
        self.now += timedelta(**kwargs)


@pytest.fixture()
def clock(monkeypatch):
    clock = Clock()
    monkeypatch.setattr(svc, "_now", lambda: clock.now)
    return clock


@pytest.fixture()
def db_session():
    db_engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(db_engine)
    session = sessionmaker(bind=db_engine)()
    try:
        yield session
    finally:
        session.close()
        Base.metadata.drop_all(db_engine)


def _round(index: int, source: str = "vocab_definitions") -> dict:
    item_id = f"{source}_{index}"
    return {
        "round_index": index,
        "item_id": item_id,
        "payload": {
            "stem": f"題目{index}",
            "source_module": source,
            "item_id": item_id,
            "options": [
                {"key": "A", "text": "對"},
                {"key": "B", "text": "錯"},
                {"key": "C", "text": "錯"},
                {"key": "D", "text": "錯"},
            ],
            "correct_key": "A",
            "seconds": 30,
        },
    }


@pytest.fixture()
def run_factory(monkeypatch, db_session):
    monkeypatch.setattr(svc, "validate_scope", lambda *_: None)
    monkeypatch.setattr(svc, "_load_lessons_for_scope", lambda *_: [{"lesson_uid": "L1", "lesson": {}}])

    def rounds(_lessons, settings, _rng):
        source = settings["source_modules"][0]
        count = 1 if source == "comprehension" else 8
        return ([_round(i, source) for i in range(count)], False)

    monkeypatch.setattr(svc.choice, "generate_rounds", rounds)

    def create(student=None):
        student = student or make_student(db_session)
        return svc.start_run(db_session, student, "lesson", "L1"), student

    return create


def _current_question(run):
    chamber = next(c for c in run.chambers_snapshot if not c["unlocked"])
    return chamber["questions"][chamber["current_question"]]


def _unlock_all(db, run, user):
    for index in range(4):
        chamber = run.chambers_snapshot[index]
        while not chamber["unlocked"]:
            svc.answer_chamber(db, run, user, index, "A")
            chamber = run.chambers_snapshot[index]


def test_start_run_has_four_ordered_chambers_and_gate(run_factory):
    run, _ = run_factory()
    assert [c["index"] for c in run.chambers_snapshot] == [0, 1, 2, 3]
    assert len(run.gate_snapshot["questions"]) == 1
    assert {option["key"] for option in run.gate_snapshot["questions"][0]["payload"]["options"]} == {"A", "B", "C", "D"}
    assert run.result == "in_progress"


def test_grade_pool_uses_nearest_available_grade(monkeypatch):
    # `resolve_pool_grade` itself now lives in `game_core.scope` (issue
    # #3663 — shared verbatim with PK, see that module's docstring), so the
    # dependency it reads at call time must be patched there, not on this
    # module's re-exported name.
    monkeypatch.setattr(scope_svc, "get_available_grades", lambda: [4, 6])
    assert svc.resolve_pool_grade("5") == "6"


def test_empty_question_pool_returns_chinese_error(monkeypatch, db_session):
    student = make_student(db_session)
    monkeypatch.setattr(svc, "validate_scope", lambda *_: None)
    monkeypatch.setattr(svc, "_load_lessons_for_scope", lambda *_: [{"lesson_uid": "L1", "lesson": {}}])
    monkeypatch.setattr(svc.choice, "generate_rounds", lambda *_: ([], False))
    with pytest.raises(HTTPException) as exc:
        svc.start_run(db_session, student, "lesson", "L1")
    assert exc.value.status_code == 400
    assert "題目" in exc.value.detail


def test_chambers_cannot_be_skipped(run_factory, db_session):
    run, user = run_factory()
    with pytest.raises(HTTPException) as exc:
        svc.answer_chamber(db_session, run, user, 1, "A")
    assert exc.value.status_code == 409


def test_mist_moves_in_correct_directions_and_stays_bounded(run_factory, db_session):
    run, user = run_factory()
    run.mist_distance = 50
    # Five frozen questions keep this test on one chamber, so every observed
    # call measures mist direction rather than a later chamber transition.
    run.chambers_snapshot[0]["questions"] = [_round(i) for i in range(5)]
    values = []
    for _ in range(5):
        result = svc.answer_chamber(db_session, run, user, 0, "A")
        values.append(result["mist_distance"])
    assert values == sorted(values)
    run.chambers_snapshot[0]["unlocked"] = False
    run.chambers_snapshot[0]["current_question"] = 0
    run.chambers_snapshot[0]["correct_count"] = 0
    values = []
    for _ in range(5):
        result = svc.answer_chamber(db_session, run, user, 0, "B")
        values.append(result["mist_distance"])
    assert values == sorted(values, reverse=True)
    assert all(0 <= value <= 100 for value in values)


def test_rescue_correct_frees_teammate_wrong_does_not_punish(run_factory, db_session):
    run, user = run_factory()
    run.mist_distance = 0
    svc.answer_chamber(db_session, run, user, 0, "B")
    frozen = next(t for t in run.teammates_state if t["frozen"])
    before = run.mist_distance
    wrong = svc.use_rescue(db_session, run, user, "B")
    assert wrong["mist_distance"] == before
    assert next(t for t in run.teammates_state if t["slug"] == frozen["slug"])["frozen"]
    right = svc.use_rescue(db_session, run, user, "A")
    assert right["mist_distance"] > before
    assert not next(t for t in run.teammates_state if t["slug"] == frozen["slug"])["frozen"]


def test_gate_requires_chambers_and_all_teammates(run_factory, db_session):
    run, user = run_factory()
    with pytest.raises(HTTPException) as exc:
        svc.answer_gate(db_session, run, user, "A")
    assert exc.value.status_code == 409
    _unlock_all(db_session, run, user)
    run.teammates_state[0]["frozen"] = True
    assert svc.answer_gate(db_session, run, user, "A")["status"] == "in_progress"
    run.teammates_state[0]["frozen"] = False
    assert svc.answer_gate(db_session, run, user, "A")["status"] == "escaped"


def test_abilities_are_single_use_and_expose_effect(run_factory, db_session):
    run, user = run_factory()
    hint = svc.use_ability(db_session, run, user, "hint")
    assert len(hint["current_chamber"]["options"]) == 3
    assert run.chambers_snapshot[0]["questions"][0]["payload"]["removed_choice_keys"]
    with pytest.raises(HTTPException) as exc:
        svc.use_ability(db_session, run, user, "hint")
    assert exc.value.status_code == 409
    assert svc.use_ability(db_session, run, user, "extra_time")["current_chamber"]["extra_time_ms"] == 5000
    assert run.chambers_snapshot[0]["questions"][0]["payload"]["extra_time_ms"] == 5000
    assert "shield" in svc.use_ability(db_session, run, user, "shield")["abilities_used"]
    run.mist_distance = 0
    svc.answer_chamber(db_session, run, user, 0, "B")
    assert not any(teammate["frozen"] for teammate in run.teammates_state)


def test_state_uses_safe_questions_for_chamber_rescue_and_gate(run_factory, db_session):
    run, user = run_factory()
    state = svc.get_run_state(db_session, run)
    assert "correct_key" not in state["current_chamber"]
    run.mist_distance = 0
    svc.answer_chamber(db_session, run, user, 0, "B")
    rescue_state = svc.get_run_state(db_session, run)
    assert "correct_key" not in rescue_state["rescue_question"]
    _unlock_all(db_session, run, user)
    gate_state = svc.get_run_state(db_session, run)
    assert "correct_key" not in gate_state["gate_question"]


def test_expired_run_becomes_not_this_time_and_rejects_writes(run_factory, db_session, clock):
    run, user = run_factory()
    run.started_at = clock.now - timedelta(minutes=11)
    db_session.commit()
    state = svc.get_run_state(db_session, run)
    assert state["status"] == "not_this_time"
    for action in (
        lambda: svc.answer_chamber(db_session, run, user, 0, "A"),
        lambda: svc.use_rescue(db_session, run, user, "A"),
        lambda: svc.answer_gate(db_session, run, user, "A"),
        lambda: svc.use_ability(db_session, run, user, "hint"),
    ):
        with pytest.raises(HTTPException) as exc:
            action()
        assert exc.value.status_code == 409


def test_state_has_the_complete_frontend_contract(run_factory, db_session):
    run, _ = run_factory()
    state = svc.get_run_state(db_session, run)
    assert state["run_id"] == run.id
    assert state["status"] == "in_progress"
    assert state["unlocked_chambers"] == 0
    assert state["current_chamber"]["chamber_index"] == 0
    assert state["current_chamber"]["extra_time_ms"] == 0
    assert state["gate_question"] is None
    assert state["rescue_question"] is None
    assert state["story_intro"]
    assert state["mist_message"]


def test_answer_and_gate_no_longer_accept_client_elapsed_ms(run_factory, db_session):
    run, user = run_factory()
    svc.answer_chamber(db_session, run, user, 0, "A")
    _unlock_all(db_session, run, user)
    gate = svc.answer_gate(db_session, run, user, "A")
    assert "elapsed_ms" not in gate


def test_run_ownership_and_result_copy_are_safe(run_factory, db_session):
    run, owner = run_factory()
    other = make_student(db_session)
    assert svc.get_run_for_user(db_session, run.id, owner) is run
    with pytest.raises(HTTPException) as forbidden:
        svc.get_run_for_user(db_session, run.id, other)
    assert forbidden.value.status_code == 403
    with pytest.raises(HTTPException) as missing:
        svc.get_run_for_user(db_session, 999999, owner)
    assert missing.value.status_code == 404
    messages = [forbidden.value.detail, missing.value.detail]
    for action in (
        lambda: svc.answer_chamber(db_session, run, owner, 4, "A"),
        lambda: svc.answer_gate(db_session, run, owner, "A"),
        lambda: svc.use_rescue(db_session, run, owner, "A"),
        lambda: svc.use_ability(db_session, run, owner, "unknown"),
    ):
        with pytest.raises(HTTPException) as public_error:
            action()
        messages.append(public_error.value.detail)
    run.result = "not_this_time"
    messages.append(svc.get_run_result(run)["message"])
    text = str(messages)
    assert all(term not in text for term in ("失敗", "你輸了", "GAME OVER"))


def test_escaped_skin_is_derived_from_completed_runs(run_factory, db_session):
    run, user = run_factory()
    run.story_pack_key = "myth"
    run.result = "escaped"
    db_session.commit()
    result = svc.get_run_result(run, db_session)
    assert result["run_id"] == run.id
    assert result["message"] == svc.DEFAULT_DIALOGUE["escape"]
    assert {"story_pack_key": "myth", "chapter_key": "default"} in result["unlocked_skins"]


def test_rescue_question_does_not_collide_with_chamber_questions(monkeypatch, db_session):
    student = make_student(db_session)
    monkeypatch.setattr(svc, "validate_scope", lambda *_: None)
    monkeypatch.setattr(svc, "_load_lessons_for_scope", lambda *_: [{"lesson_uid": "L1", "lesson": {}}])

    # 構造題庫剛好等於最小可行數量：8 題機關 + 盡量少的大門題（1 題）
    def rounds(_lessons, settings, _rng):
        source = settings["source_modules"][0]
        count = 1 if source == "comprehension" else 8
        return ([_round(i, source) for i in range(count)], False)

    monkeypatch.setattr(svc.choice, "generate_rounds", rounds)
    run = svc.start_run(db_session, student, "lesson", "L1")

    rescue_item_id = run.gate_snapshot["rescue_question"]["item_id"]
    chamber_item_ids = [
        q["item_id"]
        for chamber in run.chambers_snapshot
        for q in chamber["questions"]
    ]
    assert len(chamber_item_ids) == 8
    for chamber_id in chamber_item_ids:
        assert rescue_item_id != chamber_id


def test_hint_ability_works_on_gate_question_when_all_chambers_unlocked(run_factory, db_session):
    run, user = run_factory()
    _unlock_all(db_session, run, user)
    state_before = svc.get_run_state(db_session, run)
    assert state_before["gate_question"] is not None
    options_before = len(state_before["gate_question"]["options"])

    svc.use_ability(db_session, run, user, "hint")

    state_after = svc.get_run_state(db_session, run)
    assert state_after["gate_question"] is not None
    options_after = len(state_after["gate_question"]["options"])
    assert options_after == options_before - 1


# ---------------------------------------------------------------------------
# #3754 "剩餘 0 秒 然後呢？？？？" — a question that nobody answered within its
# own time budget must not leave the run frozen forever. Every `_round()`
# fixture question carries `seconds: 30` and no `extra_time_ms`, so 31s is
# always past its deadline.
# ---------------------------------------------------------------------------

class TestQuestionTimeout:
    def test_chamber_timeout_resolves_as_wrong_and_advances(self, run_factory, db_session, clock):
        run, user = run_factory()
        run.mist_distance = 50
        db_session.commit()
        expired_stem = _current_question(run)["payload"]["stem"]

        clock.advance(seconds=31)
        state = svc.get_run_state(db_session, run)

        assert state["mist_distance"] == 40  # scored exactly like a wrong answer-click
        assert run.chambers_snapshot[0]["current_question"] == 1
        assert state["current_chamber"]["stem"] != expired_stem  # a NEW question is now showing

    def test_timeout_resolves_one_question_per_poll_not_a_skip_ahead(self, run_factory, db_session, clock):
        """Mirrors `pk.engine.advance_if_needed`'s own "lazy, no-cron" contract:
        a long-idle student catches up one step per poll, never several at once."""
        run, user = run_factory()
        clock.advance(seconds=600)  # wildly past more than one question's own budget

        svc.get_run_state(db_session, run)
        assert run.chambers_snapshot[0]["current_question"] == 1
        assert not run.chambers_snapshot[0]["unlocked"]

        # Same instant, polled again — question 2's own clock only just
        # started (reset to "now" by the first resolve), so it must NOT
        # also already read as expired.
        svc.get_run_state(db_session, run)
        assert run.chambers_snapshot[0]["current_question"] == 1

    def test_chamber_timeout_is_blocked_while_a_teammate_needs_rescue(self, run_factory, db_session, clock):
        run, user = run_factory()
        run.mist_distance = 0
        db_session.commit()
        svc.answer_chamber(db_session, run, user, 0, "B")  # wrong at mist=0 -> freezes a teammate
        assert any(t["frozen"] for t in run.teammates_state)
        current_question_before = run.chambers_snapshot[0]["current_question"]

        clock.advance(seconds=31)
        state = svc.get_run_state(db_session, run)

        assert state["rescue_question"] is not None
        # The base chamber question is disabled behind the rescue overlay
        # (ChoiceButtons `disabled={... || Boolean(state.rescue_question)}`)
        # — its own clock must not keep burning down unseen.
        assert run.chambers_snapshot[0]["current_question"] == current_question_before

    def test_rescue_timeout_carries_no_penalty_but_restarts_its_own_clock(self, run_factory, db_session, clock):
        run, user = run_factory()
        run.mist_distance = 0
        db_session.commit()
        svc.answer_chamber(db_session, run, user, 0, "B")
        frozen_slug = next(t["slug"] for t in run.teammates_state if t["frozen"])
        before_mist = run.mist_distance
        rescue_seconds = run.gate_snapshot["rescue_question"]["payload"].get("seconds", 30)

        clock.advance(seconds=rescue_seconds + 1)
        state = svc.get_run_state(db_session, run)

        assert state["rescue_question"] is not None  # still needs rescue — same as a wrong guess
        assert state["mist_distance"] == before_mist  # no penalty, matching a manual wrong guess
        still_frozen = next(t for t in run.teammates_state if t["slug"] == frozen_slug)
        assert still_frozen["frozen"]
        frozen_at_after_expiry = still_frozen["frozen_at"]

        # Polled again at the SAME instant: must not expire (and reset the
        # clock) a second time, or this would loop forever on every poll.
        svc.get_run_state(db_session, run)
        assert next(t for t in run.teammates_state if t["slug"] == frozen_slug)["frozen_at"] == frozen_at_after_expiry

    def test_gate_timeout_resolves_as_wrong_and_stays_retryable(self, run_factory, db_session, clock):
        run, user = run_factory()
        _unlock_all(db_session, run, user)
        gate_seconds = run.gate_snapshot["questions"][0]["payload"].get("seconds", 30)

        clock.advance(seconds=gate_seconds + 1)
        state = svc.get_run_state(db_session, run)

        assert state["status"] == "in_progress"  # a timeout never ends the run outright
        assert state["gate_question"] is not None  # same question, retryable — like a wrong guess
        assert run.gate_snapshot["answered"] is True

    def test_gate_clock_starts_when_it_first_becomes_reachable(self, run_factory, db_session, clock):
        """The gate question must not read as already-expired the instant
        it appears just because `gate_snapshot["started_at"]` was still
        sitting at run-creation time."""
        run, user = run_factory()
        for index in range(3):
            chamber = run.chambers_snapshot[index]
            while not chamber["unlocked"]:
                svc.answer_chamber(db_session, run, user, index, "A")
                chamber = run.chambers_snapshot[index]

        clock.advance(seconds=400)  # long past any one question's own budget
        chamber = run.chambers_snapshot[3]
        while not chamber["unlocked"]:
            svc.answer_chamber(db_session, run, user, 3, "A")
            chamber = run.chambers_snapshot[3]
        assert all(c["unlocked"] for c in run.chambers_snapshot)

        state = svc.get_run_state(db_session, run)
        assert state["status"] == "in_progress"
        assert run.gate_snapshot["answered"] is False  # not auto-resolved before the student even saw it
        assert state["gate_question"] is not None


# ---------------------------------------------------------------------------
# #3770 "救援題與主題同時逾時，畫面永久卡死在「正在判定…」" — game-academy
# audit round 2, P0-1. `gate_question` and `rescue_question` are the SAME
# dict reused every retry (`gate_snapshot["questions"][0]` /
# `["rescue_question"]` never change), so the frontend's stem-keyed "did the
# question change" check can never tell a retried attempt apart from the one
# before it — the countdown reaches 0 once and then has no signal a fresh
# window ever started, even though #3754's lazy expire keeps correctly
# resolving it server-side. Fix: expose a per-question `started_at` (server
# time) that genuinely changes on every retry, same pattern
# `pk.engine.build_match_state`'s `round_started_at`/`server_now` already use.
# ---------------------------------------------------------------------------

class TestServerAuthoritativeQuestionTimers:
    def test_chamber_question_exposes_started_at(self, run_factory, db_session):
        run, _ = run_factory()
        state = svc.get_run_state(db_session, run)
        assert state["current_chamber"]["started_at"] is not None

    def test_state_exposes_server_now(self, run_factory, db_session):
        run, _ = run_factory()
        state = svc.get_run_state(db_session, run)
        assert state["server_now"] is not None

    def test_rescue_question_started_at_changes_on_each_retry(self, run_factory, db_session, clock):
        run, user = run_factory()
        run.mist_distance = 0
        db_session.commit()
        svc.answer_chamber(db_session, run, user, 0, "B")  # wrong at mist=0 -> freezes a teammate
        state0 = svc.get_run_state(db_session, run)
        started_at_0 = state0["rescue_question"]["started_at"]
        assert started_at_0 is not None

        rescue_seconds = run.gate_snapshot["rescue_question"]["payload"].get("seconds", 30)
        clock.advance(seconds=rescue_seconds + 1)
        state1 = svc.get_run_state(db_session, run)  # triggers the lazy auto-expire
        started_at_1 = state1["rescue_question"]["started_at"]

        assert started_at_1 != started_at_0, (
            "a retried rescue attempt must expose a NEW started_at — otherwise the "
            "frontend's countdown has no way to tell a fresh window began and stays "
            "stuck at 0 forever (#3770)"
        )

    def test_gate_question_started_at_changes_on_each_retry(self, run_factory, db_session, clock):
        run, user = run_factory()
        _unlock_all(db_session, run, user)
        state0 = svc.get_run_state(db_session, run)
        started_at_0 = state0["gate_question"]["started_at"]
        assert started_at_0 is not None

        gate_seconds = run.gate_snapshot["questions"][0]["payload"].get("seconds", 30)
        clock.advance(seconds=gate_seconds + 1)
        state1 = svc.get_run_state(db_session, run)
        started_at_1 = state1["gate_question"]["started_at"]

        assert started_at_1 != started_at_0

    def test_dual_timeout_rescue_keeps_refreshing_while_chamber_stays_paused(self, run_factory, db_session, clock):
        """The exact reported scenario: a chamber question and a rescue
        question overdue AT THE SAME TIME, repeated across more than one
        cycle (the audit saw it "persist 31 秒" — a single fix that only
        covers the first expiry would still look broken on the second)."""
        run, user = run_factory()
        run.mist_distance = 0
        db_session.commit()
        svc.answer_chamber(db_session, run, user, 0, "B")  # freezes a teammate; also stamps chamber started_at = now
        state0 = svc.get_run_state(db_session, run)
        chamber_started_at_0 = state0["current_chamber"]["started_at"]
        rescue_started_at_0 = state0["rescue_question"]["started_at"]

        # Both the chamber's own 30s budget and the rescue's 30s budget are
        # now simultaneously overdue.
        clock.advance(seconds=31)
        state1 = svc.get_run_state(db_session, run)
        assert state1["rescue_question"] is not None, "still needs rescue — not stuck, not ended"
        assert state1["rescue_question"]["started_at"] != rescue_started_at_0, (
            "rescue must get a fresh window so the frontend's countdown actually resets"
        )
        assert state1["current_chamber"]["started_at"] == chamber_started_at_0, (
            "the base question is correctly paused behind the rescue overlay — it must "
            "NOT silently expire unseen while blocked"
        )

        # A second consecutive dual-timeout cycle — this is the "persisted
        # for 31 seconds and never moved" part of the report, not a one-shot.
        clock.advance(seconds=31)
        state2 = svc.get_run_state(db_session, run)
        assert state2["rescue_question"]["started_at"] != state1["rescue_question"]["started_at"], (
            "a SECOND dual-timeout cycle must also refresh — the reported bug was "
            "that it stays stuck permanently, not just once"
        )


