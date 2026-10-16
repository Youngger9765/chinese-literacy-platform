"""TDD for app.services.pk.engine — PRD §4/§5/§6/§7/§9 match lifecycle.

Time is controlled via monkeypatching ``engine._now`` to a mutable clock so
the lazy round-advance state machine (answer window -> reveal -> next round
-> completion) can be driven deterministically without real sleeps.
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

import pytest

from app.models.pk import ANSWER_SECONDS, PkMatch, PkRating, REVEAL_SECONDS
from app.services.pk import engine as svc
from league_factories import enroll_student, make_classroom, make_school, make_student, make_teacher

LESSON_A = "L0125"  # verified elsewhere (test_live_quiz_engine.py) to carry
# comprehension + vocab_definitions + vocab_application real items.


class Clock:
    def __init__(self, start: datetime):
        self.now = start

    def advance(self, **kwargs):
        self.now += timedelta(**kwargs)


@pytest.fixture()
def clock(monkeypatch):
    c = Clock(datetime(2026, 10, 16, 9, 0, 0, tzinfo=timezone.utc))
    monkeypatch.setattr(svc, "_now", lambda: c.now)
    return c


@pytest.fixture()
def db_session():
    from sqlalchemy import create_engine
    from sqlalchemy.orm import sessionmaker
    from app.models.base import Base
    import app.models  # noqa: F401

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
def classroom(db_session):
    teacher = make_teacher(db_session)
    school = make_school(db_session)
    room = make_classroom(db_session, school, teacher)
    return room


def _enrolled_student(db, classroom):
    s = make_student(db)
    enroll_student(db, classroom, s)
    return s


# ---------------------------------------------------------------------------
# Match creation
# ---------------------------------------------------------------------------

class TestCreateHumanMatch:
    def test_creates_active_match_with_5_rounds(self, db_session, classroom, clock):
        a = _enrolled_student(db_session, classroom)
        b = _enrolled_student(db_session, classroom)
        match = svc.create_human_match(
            db_session, a, b, scope_type="lesson", scope_ref=LESSON_A, classroom_id=classroom.id
        )
        assert match.status == "active"
        assert len(match.rounds_snapshot) == 5
        assert match.current_round_index == 0
        assert match.side_a_rating_before == 1000
        assert match.side_b_rating_before == 1000

    def test_rounds_snapshot_is_frozen_at_creation(self, db_session, classroom, clock):
        """PRD §6 independence rule #3: a later curriculum edit must never
        affect a match already in flight — proven here by the snapshot
        being plain data copied onto the row, not re-derived on read."""
        a = _enrolled_student(db_session, classroom)
        b = _enrolled_student(db_session, classroom)
        match = svc.create_human_match(
            db_session, a, b, scope_type="lesson", scope_ref=LESSON_A, classroom_id=classroom.id
        )
        snapshot_before = list(match.rounds_snapshot)
        db_session.refresh(match)
        assert match.rounds_snapshot == snapshot_before


class TestCreateAiMatch:
    def test_ai_side_has_all_5_answers_precomputed(self, db_session, classroom, clock):
        a = _enrolled_student(db_session, classroom)
        match = svc.create_ai_match(
            db_session, a, scope_type="lesson", scope_ref=LESSON_A, bot_tier=7, classroom_id=classroom.id
        )
        assert match.side_b_user_id is None
        assert match.side_b_bot_tier == 7
        assert len(match.side_b_answers) == 5
        assert match.side_b_score == sum(e["points"] for e in match.side_b_answers)

    def test_ai_tier_out_of_range_raises(self, db_session, classroom, clock):
        a = _enrolled_student(db_session, classroom)
        with pytest.raises(Exception):
            svc.create_ai_match(
                db_session, a, scope_type="lesson", scope_ref=LESSON_A, bot_tier=8, classroom_id=classroom.id
            )


# ---------------------------------------------------------------------------
# Authz on match access
# ---------------------------------------------------------------------------

class TestGetMatchForUser:
    def test_participant_can_access(self, db_session, classroom, clock):
        a = _enrolled_student(db_session, classroom)
        b = _enrolled_student(db_session, classroom)
        match = svc.create_human_match(
            db_session, a, b, scope_type="lesson", scope_ref=LESSON_A, classroom_id=classroom.id
        )
        got = svc.get_match_for_user(db_session, match.id, a)
        assert got.id == match.id

    def test_non_participant_gets_403(self, db_session, classroom, clock):
        a = _enrolled_student(db_session, classroom)
        b = _enrolled_student(db_session, classroom)
        outsider = _enrolled_student(db_session, classroom)
        match = svc.create_human_match(
            db_session, a, b, scope_type="lesson", scope_ref=LESSON_A, classroom_id=classroom.id
        )
        with pytest.raises(Exception):
            svc.get_match_for_user(db_session, match.id, outsider)

    def test_unknown_match_gets_404(self, db_session, classroom, clock):
        a = _enrolled_student(db_session, classroom)
        with pytest.raises(Exception):
            svc.get_match_for_user(db_session, 999999, a)


# ---------------------------------------------------------------------------
# Answer stripping — never leak correct_key or opponent's choice pre-reveal
# ---------------------------------------------------------------------------

class TestAnswerStripping:
    def test_correct_key_hidden_before_reveal(self, db_session, classroom, clock):
        a = _enrolled_student(db_session, classroom)
        b = _enrolled_student(db_session, classroom)
        match = svc.create_human_match(
            db_session, a, b, scope_type="lesson", scope_ref=LESSON_A, classroom_id=classroom.id
        )
        state = svc.build_match_state(db_session, match, a)
        assert "correct_key" not in state["round"]

    def test_opponent_choice_hidden_before_opponent_answers(self, db_session, classroom, clock):
        a = _enrolled_student(db_session, classroom)
        b = _enrolled_student(db_session, classroom)
        match = svc.create_human_match(
            db_session, a, b, scope_type="lesson", scope_ref=LESSON_A, classroom_id=classroom.id
        )
        round0 = match.rounds_snapshot[0]["payload"]
        correct = round0["correct_key"]
        wrong = next(o["key"] for o in round0["options"] if o["key"] != correct)
        svc.submit_match_answer(db_session, match, b, wrong)  # b answers, a hasn't yet

        state_for_a = svc.build_match_state(db_session, match, a)
        # a has not answered and the round isn't revealing yet (only one of
        # two sides has answered) -- a must not see b's pick or correctness.
        assert "opponent_choice_key" not in state_for_a["round"]
        assert "correct_key" not in state_for_a["round"]

    def test_revealed_after_both_answer(self, db_session, classroom, clock):
        a = _enrolled_student(db_session, classroom)
        b = _enrolled_student(db_session, classroom)
        match = svc.create_human_match(
            db_session, a, b, scope_type="lesson", scope_ref=LESSON_A, classroom_id=classroom.id
        )
        round0 = match.rounds_snapshot[0]["payload"]
        correct = round0["correct_key"]
        svc.submit_match_answer(db_session, match, a, correct)
        svc.submit_match_answer(db_session, match, b, correct)

        state = svc.build_match_state(db_session, match, a)
        assert state["revealing"] is True
        assert state["round"]["correct_key"] == correct
        assert state["round"]["opponent_choice_key"] == correct


# ---------------------------------------------------------------------------
# Server-authoritative elapsed_ms (CTO review #1, PRD §17)
# ---------------------------------------------------------------------------

class TestMatchStateNames:
    def test_includes_my_name_and_opponent_name_for_human_match(self, db_session, classroom, clock):
        a = _enrolled_student(db_session, classroom)
        b = _enrolled_student(db_session, classroom)
        match = svc.create_human_match(
            db_session, a, b, scope_type="lesson", scope_ref=LESSON_A, classroom_id=classroom.id
        )
        state_a = svc.build_match_state(db_session, match, a)
        assert state_a["my_name"] == a.name
        assert state_a["opponent_name"] == b.name

    def test_opponent_name_is_none_for_ai_match(self, db_session, classroom, clock):
        a = _enrolled_student(db_session, classroom)
        match = svc.create_ai_match(
            db_session, a, scope_type="lesson", scope_ref=LESSON_A, bot_tier=2, classroom_id=classroom.id
        )
        state = svc.build_match_state(db_session, match, a)
        assert state["opponent_name"] is None
        assert state["my_name"] == a.name


class TestServerAuthoritativeTiming:
    def test_elapsed_ms_computed_from_server_clock_not_client_input(self, db_session, classroom, clock):
        a = _enrolled_student(db_session, classroom)
        b = _enrolled_student(db_session, classroom)
        match = svc.create_human_match(
            db_session, a, b, scope_type="lesson", scope_ref=LESSON_A, classroom_id=classroom.id
        )
        # Both sides "reach the battle screen" at t=0 (VS screen has no
        # intro delay for a human opponent) -- this is what lazily starts
        # round 0's clock (see engine.advance_if_needed's docstring).
        svc.build_match_state(db_session, match, a)
        clock.advance(seconds=7)
        round0 = match.rounds_snapshot[0]["payload"]
        correct = round0["correct_key"]
        svc.submit_match_answer(db_session, match, a, correct)
        entry = next(e for e in match.side_a_answers if e["round_index"] == 0)
        assert 6900 <= entry["elapsed_ms"] <= 7100

    def test_double_submit_same_round_rejected(self, db_session, classroom, clock):
        a = _enrolled_student(db_session, classroom)
        b = _enrolled_student(db_session, classroom)
        match = svc.create_human_match(
            db_session, a, b, scope_type="lesson", scope_ref=LESSON_A, classroom_id=classroom.id
        )
        round0 = match.rounds_snapshot[0]["payload"]
        correct = round0["correct_key"]
        svc.submit_match_answer(db_session, match, a, correct)
        with pytest.raises(Exception):
            svc.submit_match_answer(db_session, match, a, correct)


# ---------------------------------------------------------------------------
# Lazy round-advance: window timeout, reveal pause, completion
# ---------------------------------------------------------------------------

class TestRoundOneDoesNotStartDuringVsOrIntro:
    """PRD §10.1: "絕不卡住對戰...不算進 §4 的 5 題約 2 分鐘預算" — the clock for
    round 1 must not be running while the student is still looking at the
    VS screen / figure intro (which can legitimately take up to 15s for a
    first-time AI encounter)."""

    def test_round_one_clock_does_not_tick_before_first_real_poll(self, db_session, classroom, clock):
        a = _enrolled_student(db_session, classroom)
        b = _enrolled_student(db_session, classroom)
        match = svc.create_human_match(
            db_session, a, b, scope_type="lesson", scope_ref=LESSON_A, classroom_id=classroom.id
        )
        assert match.current_round_started_at is None

        # Student watches a 15s VS screen / intro before ever polling.
        clock.advance(seconds=15)
        state = svc.build_match_state(db_session, match, a)

        # The round must appear freshly started NOW, not 15s ago -- the
        # full 20s answer window must still be available.
        assert state["round_started_at"] == clock.now.isoformat()
        assert state["status"] == "active"
        assert state["round_index"] == 0  # did not time out before anyone saw it

    def test_full_20s_window_available_after_a_15s_intro(self, db_session, classroom, clock):
        a = _enrolled_student(db_session, classroom)
        match = svc.create_ai_match(
            db_session, a, scope_type="lesson", scope_ref=LESSON_A, bot_tier=1, classroom_id=classroom.id
        )
        clock.advance(seconds=15)  # first-time AI intro, full version
        svc.build_match_state(db_session, match, a)  # lazily starts the clock HERE, not at creation

        clock.advance(seconds=19)  # 19s into round 1's OWN window -- still in time
        payload = match.rounds_snapshot[0]["payload"]
        result = svc.submit_match_answer(db_session, match, a, payload["correct_key"])
        assert result["is_correct"] is True  # not rejected as "too late"


class TestAdvanceIfNeeded:
    def test_round_does_not_advance_within_the_answer_window(self, db_session, classroom, clock):
        a = _enrolled_student(db_session, classroom)
        b = _enrolled_student(db_session, classroom)
        match = svc.create_human_match(
            db_session, a, b, scope_type="lesson", scope_ref=LESSON_A, classroom_id=classroom.id
        )
        svc.build_match_state(db_session, match, a)  # lazily starts round 0's clock
        clock.advance(seconds=5)
        svc.advance_if_needed(db_session, match)
        assert match.current_round_index == 0
        assert match.status == "active"

    def test_round_reveals_once_window_elapses_even_with_no_answers(self, db_session, classroom, clock):
        a = _enrolled_student(db_session, classroom)
        b = _enrolled_student(db_session, classroom)
        match = svc.create_human_match(
            db_session, a, b, scope_type="lesson", scope_ref=LESSON_A, classroom_id=classroom.id
        )
        svc.build_match_state(db_session, match, a)  # lazily starts round 0's clock
        clock.advance(seconds=ANSWER_SECONDS + 1)
        svc.advance_if_needed(db_session, match)
        assert match.reveal_started_at is not None
        # Un-answered round gets a backfilled 0-point entry for both sides.
        assert any(e["round_index"] == 0 for e in match.side_a_answers)
        assert any(e["round_index"] == 0 for e in match.side_b_answers)

    def test_advances_to_next_round_after_reveal_pause(self, db_session, classroom, clock):
        a = _enrolled_student(db_session, classroom)
        b = _enrolled_student(db_session, classroom)
        match = svc.create_human_match(
            db_session, a, b, scope_type="lesson", scope_ref=LESSON_A, classroom_id=classroom.id
        )
        round0 = match.rounds_snapshot[0]["payload"]
        correct = round0["correct_key"]
        svc.submit_match_answer(db_session, match, a, correct)
        svc.submit_match_answer(db_session, match, b, correct)  # both answered -> reveal starts
        assert match.current_round_index == 0

        clock.advance(seconds=REVEAL_SECONDS + 0.5)
        svc.advance_if_needed(db_session, match)
        assert match.current_round_index == 1
        assert match.reveal_started_at is None

    def test_full_match_completes_after_5_rounds(self, db_session, classroom, clock):
        a = _enrolled_student(db_session, classroom)
        b = _enrolled_student(db_session, classroom)
        match = svc.create_human_match(
            db_session, a, b, scope_type="lesson", scope_ref=LESSON_A, classroom_id=classroom.id
        )
        for i in range(5):
            payload = match.rounds_snapshot[i]["payload"]
            correct = payload["correct_key"]
            svc.submit_match_answer(db_session, match, a, correct)
            svc.submit_match_answer(db_session, match, b, correct)
            clock.advance(seconds=REVEAL_SECONDS + 0.5)
            svc.advance_if_needed(db_session, match)
        assert match.status == "completed"
        assert match.completed_at is not None


class TestOpponentsView:
    def test_previously_played_false_before_any_match(self, db_session, classroom, clock):
        a = _enrolled_student(db_session, classroom)
        view = svc.get_opponents_view(db_session, a)
        assert all(o["previously_played"] is False for o in view["opponents"])

    def test_previously_played_true_after_a_completed_match_even_on_loss(self, db_session, classroom, clock):
        """PRD §10.2: ANY completed match counts, not just a win (unlock
        for the figure-card is win-only — a separate flag)."""
        a = _enrolled_student(db_session, classroom)
        match = svc.create_ai_match(
            db_session, a, scope_type="lesson", scope_ref=LESSON_A, bot_tier=4, classroom_id=classroom.id
        )
        for i in range(5):
            payload = match.rounds_snapshot[i]["payload"]
            wrong = next(o["key"] for o in payload["options"] if o["key"] != payload["correct_key"])
            svc.submit_match_answer(db_session, match, a, wrong)  # lose every round on purpose
            clock.advance(seconds=REVEAL_SECONDS + 0.5)
            svc.advance_if_needed(db_session, match)
        assert match.status == "completed"
        assert match.winner_user_id != a.id  # a lost

        view = svc.get_opponents_view(db_session, a)
        tier4 = next(o for o in view["opponents"] if o["tier"] == 4)
        assert tier4["previously_played"] is True
        assert tier4["unlocked"] is False  # lost, so NOT unlocked


class TestTieBreakAndRatingUpdate:
    def test_winner_gets_rating_increase_loser_decrease(self, db_session, classroom, clock):
        a = _enrolled_student(db_session, classroom)
        b = _enrolled_student(db_session, classroom)
        match = svc.create_human_match(
            db_session, a, b, scope_type="lesson", scope_ref=LESSON_A, classroom_id=classroom.id
        )
        for i in range(5):
            payload = match.rounds_snapshot[i]["payload"]
            correct = payload["correct_key"]
            wrong = next(o["key"] for o in payload["options"] if o["key"] != correct)
            svc.submit_match_answer(db_session, match, a, correct)  # a always right
            svc.submit_match_answer(db_session, match, b, wrong)  # b always wrong
            clock.advance(seconds=REVEAL_SECONDS + 0.5)
            svc.advance_if_needed(db_session, match)

        assert match.status == "completed"
        assert match.winner_user_id == a.id
        assert match.side_a_rating_after > match.side_a_rating_before
        assert match.side_b_rating_after < match.side_b_rating_before
        rating_a = db_session.query(PkRating).filter(PkRating.student_id == a.id).first()
        rating_b = db_session.query(PkRating).filter(PkRating.student_id == b.id).first()
        assert rating_a.wins == 1
        assert rating_b.losses == 1

    def test_draw_does_not_change_rating(self, db_session, classroom, clock):
        """PRD §4: "平手對積分的影響：不調整積分"."""
        a = _enrolled_student(db_session, classroom)
        b = _enrolled_student(db_session, classroom)
        match = svc.create_human_match(
            db_session, a, b, scope_type="lesson", scope_ref=LESSON_A, classroom_id=classroom.id
        )
        for i in range(5):
            payload = match.rounds_snapshot[i]["payload"]
            correct = payload["correct_key"]
            # Both answer correctly, with the SAME elapsed time each round
            # (no clock advance between the two submits) so total time ties.
            svc.submit_match_answer(db_session, match, a, correct)
            svc.submit_match_answer(db_session, match, b, correct)
            clock.advance(seconds=REVEAL_SECONDS + 0.5)
            svc.advance_if_needed(db_session, match)

        assert match.status == "completed"
        assert match.winner_user_id is None
        assert match.side_a_rating_after == match.side_a_rating_before
        assert match.side_b_rating_after == match.side_b_rating_before
        rating_a = db_session.query(PkRating).filter(PkRating.student_id == a.id).first()
        assert rating_a.draws == 1

    def test_tied_score_broken_by_faster_total_time(self, db_session, classroom, clock):
        """PRD §16.1 QA case: equal score, different total time -> faster wins."""
        a = _enrolled_student(db_session, classroom)
        b = _enrolled_student(db_session, classroom)
        match = svc.create_human_match(
            db_session, a, b, scope_type="lesson", scope_ref=LESSON_A, classroom_id=classroom.id
        )
        for i in range(5):
            payload = match.rounds_snapshot[i]["payload"]
            correct = payload["correct_key"]
            svc.submit_match_answer(db_session, match, a, correct)  # a answers immediately (fast)
            clock.advance(seconds=5)  # b takes 5s longer than a, every round
            svc.submit_match_answer(db_session, match, b, correct)
            clock.advance(seconds=REVEAL_SECONDS + 0.5)
            svc.advance_if_needed(db_session, match)

        assert match.status == "completed"
        assert match.side_a_score == match.side_b_score == 5000
        assert match.winner_user_id == a.id  # a was faster every round
