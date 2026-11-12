"""TDD for app.services.pk.matchmaking — PRD §9 配對演算法.

Covers the CTO review #2 regression lock verbatim (§17 #2): "兩個學生以極短
時間差同時呼叫輪詢，只能產生一場 pk_matches" — simulated here as two queue
rows already waiting, both attempting to match in quick succession (SQLite
can't give us real multi-process concurrency, but the FOR UPDATE SKIP LOCKED
query + the "flip BOTH rows to matched in the same transaction" logic this
test exercises is the exact property that query is supposed to guarantee —
see services/pk/matchmaking.py module docstring).
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

import pytest

from app.models.pk import PkMatch, PkQueue
from app.services.pk import matchmaking as svc
from league_factories import enroll_student, make_classroom, make_school, make_student, make_teacher


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
    """PRD §7.4: 真人 PK defaults OFF per-classroom -- these matchmaking
    tests are about matching behavior itself, not the gate, so the fixture
    opts the test classroom IN. The gate's own on/off behavior gets its
    own dedicated tests below (TestPkHumanFeatureGate)."""
    teacher = make_teacher(db_session)
    school = make_school(db_session)
    return make_classroom(db_session, school, teacher, feature_settings={"pk_human": True})


def _enrolled_student(db, classroom, **kwargs):
    student = make_student(db, **kwargs)
    enroll_student(db, classroom, student)
    return student


class TestCreateQueueEntry:
    def test_creates_a_waiting_row(self, db_session, classroom):
        student = _enrolled_student(db_session, classroom)
        q = svc.create_queue_entry(
            db_session, student, scope_type="grade_pool", scope_ref="4", classroom_id=classroom.id
        )
        assert q.status == "waiting"
        assert q.invite_code is None
        assert q.student_id == student.id

    def test_rejects_classroom_the_student_does_not_belong_to(self, db_session, classroom):
        """authz: the caller supplies classroom_id in the body — it must be
        bound to the caller, not merely a classroom that exists."""
        outsider = make_student(db_session)  # NOT enrolled in `classroom`
        with pytest.raises(Exception):
            svc.create_queue_entry(
                db_session, outsider, scope_type="grade_pool", scope_ref="4", classroom_id=classroom.id
            )


class TestAttemptMatch:
    def test_two_waiting_students_same_scope_get_matched(self, db_session, classroom):
        a = _enrolled_student(db_session, classroom)
        b = _enrolled_student(db_session, classroom)
        qa = svc.create_queue_entry(db_session, a, scope_type="grade_pool", scope_ref="4", classroom_id=classroom.id)
        qb = svc.create_queue_entry(db_session, b, scope_type="grade_pool", scope_ref="4", classroom_id=classroom.id)

        match = svc.attempt_match(db_session, qb)  # b polls and finds a waiting

        assert match is not None
        assert {match.side_a_user_id, match.side_b_user_id} == {a.id, b.id}
        db_session.refresh(qa)
        db_session.refresh(qb)
        assert qa.status == "matched"
        assert qb.status == "matched"
        assert qa.match_id == match.id
        assert qb.match_id == match.id

    def test_only_one_match_is_created_even_if_both_sides_poll(self, db_session, classroom):
        """The CTO review #2 regression lock: simulate near-simultaneous
        polling by both sides calling attempt_match in quick succession."""
        a = _enrolled_student(db_session, classroom)
        b = _enrolled_student(db_session, classroom)
        qa = svc.create_queue_entry(db_session, a, scope_type="grade_pool", scope_ref="4", classroom_id=classroom.id)
        qb = svc.create_queue_entry(db_session, b, scope_type="grade_pool", scope_ref="4", classroom_id=classroom.id)

        m1 = svc.attempt_match(db_session, qa)
        m2 = svc.attempt_match(db_session, qb)  # b's row is already matched now

        assert m1 is not None
        assert m2 is None  # already matched by m1; must NOT create a second match
        count = db_session.query(PkMatch).count()
        assert count == 1

    def test_different_scope_does_not_match(self, db_session, classroom):
        a = _enrolled_student(db_session, classroom)
        b = _enrolled_student(db_session, classroom)
        svc.create_queue_entry(db_session, a, scope_type="grade_pool", scope_ref="4", classroom_id=classroom.id)
        qb = svc.create_queue_entry(db_session, b, scope_type="grade_pool", scope_ref="5", classroom_id=classroom.id)

        match = svc.attempt_match(db_session, qb)
        assert match is None

    def test_invite_rows_are_excluded_from_generic_matching(self, db_session, classroom):
        """PRD §2: invite codes are "約好的那一位", not open matchmaking —
        an invite-creator's row must not be picked up by a stranger's
        generic queue poll."""
        a = _enrolled_student(db_session, classroom)
        b = _enrolled_student(db_session, classroom)
        svc.create_invite(db_session, a, scope_type="grade_pool", scope_ref="4", classroom_id=classroom.id)
        qb = svc.create_queue_entry(db_session, b, scope_type="grade_pool", scope_ref="4", classroom_id=classroom.id)

        match = svc.attempt_match(db_session, qb)
        assert match is None

    def test_cannot_match_with_self(self, db_session, classroom):
        a = _enrolled_student(db_session, classroom)
        qa = svc.create_queue_entry(db_session, a, scope_type="grade_pool", scope_ref="4", classroom_id=classroom.id)
        match = svc.attempt_match(db_session, qa)
        assert match is None


class TestDifferentClassroomRestriction:
    def test_students_in_different_classrooms_do_not_match(self, db_session):
        teacher = make_teacher(db_session)
        school = make_school(db_session)
        room1 = make_classroom(db_session, school, teacher, name="班級1", feature_settings={"pk_human": True})
        room2 = make_classroom(db_session, school, teacher, name="班級2", feature_settings={"pk_human": True})
        a = _enrolled_student(db_session, room1)
        b = _enrolled_student(db_session, room2)
        svc.create_queue_entry(db_session, a, scope_type="grade_pool", scope_ref="4", classroom_id=room1.id)
        qb = svc.create_queue_entry(db_session, b, scope_type="grade_pool", scope_ref="4", classroom_id=room2.id)

        match = svc.attempt_match(db_session, qb)
        assert match is None


class TestInvite:
    def test_create_invite_sets_code_and_5_minute_expiry(self, db_session, classroom):
        a = _enrolled_student(db_session, classroom)
        q = svc.create_invite(db_session, a, scope_type="lesson", scope_ref="L0125", classroom_id=classroom.id)
        assert q.invite_code is not None
        assert len(q.invite_code) == 6
        assert q.invite_expires_at is not None
        delta = q.invite_expires_at - q.created_at
        assert abs(delta - timedelta(minutes=5)) < timedelta(seconds=5)

    def test_create_invite_requires_classroom(self, db_session, classroom):
        a = _enrolled_student(db_session, classroom)
        with pytest.raises(Exception):
            svc.create_invite(db_session, a, scope_type="lesson", scope_ref="L0125", classroom_id=None)

    def test_create_invite_rejects_non_member_classroom(self, db_session, classroom):
        outsider = make_student(db_session)  # NOT enrolled
        with pytest.raises(Exception):
            svc.create_invite(db_session, outsider, scope_type="lesson", scope_ref="L0125", classroom_id=classroom.id)

    def test_redeem_matches_immediately(self, db_session, classroom):
        a = _enrolled_student(db_session, classroom)
        b = _enrolled_student(db_session, classroom)
        q_invite = svc.create_invite(db_session, a, scope_type="lesson", scope_ref="L0125", classroom_id=classroom.id)

        q_redeemer, match = svc.redeem_invite(db_session, b, q_invite.invite_code)

        assert match is not None
        assert {match.side_a_user_id, match.side_b_user_id} == {a.id, b.id}
        assert q_redeemer.status == "matched"
        assert q_redeemer.match_id == match.id
        db_session.refresh(q_invite)
        assert q_invite.status == "matched"
        assert q_invite.match_id == match.id

    def test_redeem_used_up_code_fails(self, db_session, classroom):
        a = _enrolled_student(db_session, classroom)
        b = _enrolled_student(db_session, classroom)
        c = _enrolled_student(db_session, classroom)
        q_invite = svc.create_invite(db_session, a, scope_type="lesson", scope_ref="L0125", classroom_id=classroom.id)
        svc.redeem_invite(db_session, b, q_invite.invite_code)

        with pytest.raises(Exception):
            svc.redeem_invite(db_session, c, q_invite.invite_code)

    def test_redeem_expired_code_fails(self, db_session, classroom):
        a = _enrolled_student(db_session, classroom)
        b = _enrolled_student(db_session, classroom)
        q_invite = svc.create_invite(db_session, a, scope_type="lesson", scope_ref="L0125", classroom_id=classroom.id)
        q_invite.invite_expires_at = datetime.now(timezone.utc) - timedelta(seconds=1)
        db_session.commit()

        with pytest.raises(Exception):
            svc.redeem_invite(db_session, b, q_invite.invite_code)

    def test_redeem_unknown_code_fails(self, db_session):
        b = make_student(db_session)
        with pytest.raises(Exception):
            svc.redeem_invite(db_session, b, "ZZZZZZ")

    def test_redeem_own_code_fails(self, db_session, classroom):
        a = _enrolled_student(db_session, classroom)
        q_invite = svc.create_invite(db_session, a, scope_type="lesson", scope_ref="L0125", classroom_id=classroom.id)
        with pytest.raises(Exception):
            svc.redeem_invite(db_session, a, q_invite.invite_code)

    def test_redeem_requires_same_classroom_membership(self, db_session):
        """PRD §2: "不論老師有沒有開放配對，同班同學可以用邀請碼直接約一場"
        — a student NOT in the invite's classroom must not be able to
        redeem it."""
        teacher = make_teacher(db_session)
        school = make_school(db_session)
        room1 = make_classroom(db_session, school, teacher, name="班級1", feature_settings={"pk_human": True})
        room2 = make_classroom(db_session, school, teacher, name="班級2", feature_settings={"pk_human": True})
        a = _enrolled_student(db_session, room1)
        outsider = _enrolled_student(db_session, room2)  # real student, just the WRONG classroom
        q_invite = svc.create_invite(db_session, a, scope_type="lesson", scope_ref="L0125", classroom_id=room1.id)

        with pytest.raises(Exception):
            svc.redeem_invite(db_session, outsider, q_invite.invite_code)


class TestCancelQueue:
    def test_cancel_marks_waiting_row_cancelled(self, db_session, classroom):
        a = _enrolled_student(db_session, classroom)
        q = svc.create_queue_entry(db_session, a, scope_type="grade_pool", scope_ref="4", classroom_id=classroom.id)
        svc.cancel_queue(db_session, q)
        db_session.refresh(q)
        assert q.status == "cancelled"

    def test_cancel_an_already_matched_row_is_a_noop(self, db_session, classroom):
        a = _enrolled_student(db_session, classroom)
        b = _enrolled_student(db_session, classroom)
        qa = svc.create_queue_entry(db_session, a, scope_type="grade_pool", scope_ref="4", classroom_id=classroom.id)
        qb = svc.create_queue_entry(db_session, b, scope_type="grade_pool", scope_ref="4", classroom_id=classroom.id)
        svc.attempt_match(db_session, qb)
        db_session.refresh(qa)
        svc.cancel_queue(db_session, qa)
        db_session.refresh(qa)
        assert qa.status == "matched"  # not overwritten to cancelled


class TestPollQueueSuggestAi:
    def test_suggest_ai_false_before_10_seconds(self, db_session, classroom):
        a = _enrolled_student(db_session, classroom)
        q = svc.create_queue_entry(db_session, a, scope_type="grade_pool", scope_ref="4", classroom_id=classroom.id)
        state = svc.poll_queue(db_session, q)
        assert state["suggest_ai"] is False

    def test_suggest_ai_true_after_10_seconds_waiting(self, db_session, classroom):
        a = _enrolled_student(db_session, classroom)
        q = svc.create_queue_entry(db_session, a, scope_type="grade_pool", scope_ref="4", classroom_id=classroom.id)
        q.created_at = datetime.now(timezone.utc) - timedelta(seconds=11)
        db_session.commit()
        state = svc.poll_queue(db_session, q)
        assert state["suggest_ai"] is True

    def test_poll_never_auto_creates_a_match_by_itself(self, db_session, classroom):
        """PRD §9.2: "伺服器不會自己建立任何 pk_matches" — a lone waiting
        student (no one else to match with) must stay waiting indefinitely,
        even long past the 10s suggestion threshold."""
        a = _enrolled_student(db_session, classroom)
        q = svc.create_queue_entry(db_session, a, scope_type="grade_pool", scope_ref="4", classroom_id=classroom.id)
        q.created_at = datetime.now(timezone.utc) - timedelta(seconds=60)
        db_session.commit()
        state = svc.poll_queue(db_session, q)
        assert state["status"] == "waiting"
        assert db_session.query(PkMatch).count() == 0


class TestPkHumanFeatureGate:
    """PRD §7.4 (2026-10-16 revision): 真人 PK is OFF by default per
    classroom and must be enforced on every human-PK entry path — queueing,
    creating an invite, AND redeeming one (a teacher can flip it off
    between those two moments). Uses the lowest-privilege real student
    accounts this file already builds via `_enrolled_student`, with a
    positive control (an otherwise-identical enabled classroom) alongside
    every negative case — a 403 proves nothing if the route 403s everyone.
    """

    def _classroom(self, db, *, pk_human: bool):
        teacher = make_teacher(db)
        school = make_school(db)
        return make_classroom(db, school, teacher, feature_settings={"pk_human": pk_human})

    def test_queue_entry_blocked_when_disabled(self, db_session):
        room = self._classroom(db_session, pk_human=False)
        a = _enrolled_student(db_session, room)
        with pytest.raises(Exception):
            svc.create_queue_entry(db_session, a, scope_type="grade_pool", scope_ref="4", classroom_id=room.id)

    def test_queue_entry_allowed_when_enabled(self, db_session):
        """Positive control for the test above."""
        room = self._classroom(db_session, pk_human=True)
        a = _enrolled_student(db_session, room)
        q = svc.create_queue_entry(db_session, a, scope_type="grade_pool", scope_ref="4", classroom_id=room.id)
        assert q.status == "waiting"

    def test_queue_entry_blocked_on_a_brand_new_classroom_with_empty_settings(self, db_session):
        """PRD: "default 真人 PK 是 disable" — a classroom that never had
        its settings touched at all (feature_settings == {}) must behave
        the same as explicit pk_human=False, not silently allow."""
        teacher = make_teacher(db_session)
        school = make_school(db_session)
        room = make_classroom(db_session, school, teacher)  # no feature_settings passed -> DB default {}
        a = _enrolled_student(db_session, room)
        with pytest.raises(Exception):
            svc.create_queue_entry(db_session, a, scope_type="grade_pool", scope_ref="4", classroom_id=room.id)

    def test_create_invite_blocked_when_disabled(self, db_session):
        room = self._classroom(db_session, pk_human=False)
        a = _enrolled_student(db_session, room)
        with pytest.raises(Exception):
            svc.create_invite(db_session, a, scope_type="lesson", scope_ref="L0125", classroom_id=room.id)

    def test_create_invite_allowed_when_enabled(self, db_session):
        room = self._classroom(db_session, pk_human=True)
        a = _enrolled_student(db_session, room)
        q = svc.create_invite(db_session, a, scope_type="lesson", scope_ref="L0125", classroom_id=room.id)
        assert q.invite_code is not None

    def test_redeem_invite_blocked_if_disabled_after_the_invite_was_created(self, db_session):
        """The teacher-flips-it-off-mid-session case: the invite was
        legitimately created while enabled, but disabled before redemption."""
        room = self._classroom(db_session, pk_human=True)
        a = _enrolled_student(db_session, room)
        b = _enrolled_student(db_session, room)
        invite = svc.create_invite(db_session, a, scope_type="lesson", scope_ref="L0125", classroom_id=room.id)

        room.feature_settings = {"pk_human": False}
        db_session.commit()

        with pytest.raises(Exception):
            svc.redeem_invite(db_session, b, invite.invite_code)

    def test_redeem_invite_allowed_when_still_enabled(self, db_session):
        """Positive control for the test above."""
        room = self._classroom(db_session, pk_human=True)
        a = _enrolled_student(db_session, room)
        b = _enrolled_student(db_session, room)
        invite = svc.create_invite(db_session, a, scope_type="lesson", scope_ref="L0125", classroom_id=room.id)

        _, match = svc.redeem_invite(db_session, b, invite.invite_code)
        assert match is not None


class TestOpenQueueCap:
    """Resource-exhaustion guard, same spirit as team_arena's
    MAX_OPEN_HOSTED_ROOMS: a student could otherwise call POST /queue or
    POST /invite forever with no upper bound. MAX_OPEN_QUEUE_ENTRIES caps
    how many of a student's own "waiting" rows (plain queue entries AND
    invites — both are "I started something, waiting for someone else")
    may exist at once; a row nobody is coming back for doesn't count.
    """

    def test_rejects_queue_entry_once_the_student_hits_the_cap(self, db_session, classroom):
        a = _enrolled_student(db_session, classroom)
        for _ in range(svc.MAX_OPEN_QUEUE_ENTRIES):
            svc.create_queue_entry(db_session, a, scope_type="grade_pool", scope_ref="4", classroom_id=classroom.id)

        with pytest.raises(Exception) as exc:
            svc.create_queue_entry(db_session, a, scope_type="grade_pool", scope_ref="4", classroom_id=classroom.id)
        assert exc.value.status_code == 429

    def test_rejects_invite_once_the_student_hits_the_cap(self, db_session, classroom):
        """The cap is shared across BOTH entry points — an invite is just
        a queue row with invite_code set, same resource being piled up."""
        a = _enrolled_student(db_session, classroom)
        for _ in range(svc.MAX_OPEN_QUEUE_ENTRIES):
            svc.create_queue_entry(db_session, a, scope_type="grade_pool", scope_ref="4", classroom_id=classroom.id)

        with pytest.raises(Exception) as exc:
            svc.create_invite(db_session, a, scope_type="lesson", scope_ref="L0125", classroom_id=classroom.id)
        assert exc.value.status_code == 429

    def test_under_cap_still_succeeds(self, db_session, classroom):
        """Positive control: one entry under the cap must not be blocked
        by the same guard that rejects at-cap students above."""
        a = _enrolled_student(db_session, classroom)
        for _ in range(svc.MAX_OPEN_QUEUE_ENTRIES - 1):
            svc.create_queue_entry(db_session, a, scope_type="grade_pool", scope_ref="4", classroom_id=classroom.id)

        q = svc.create_queue_entry(db_session, a, scope_type="grade_pool", scope_ref="4", classroom_id=classroom.id)
        assert q.status == "waiting"

    def test_another_students_entries_do_not_count(self, db_session, classroom):
        a = _enrolled_student(db_session, classroom)
        other = _enrolled_student(db_session, classroom)
        for _ in range(svc.MAX_OPEN_QUEUE_ENTRIES):
            svc.create_queue_entry(db_session, other, scope_type="grade_pool", scope_ref="4", classroom_id=classroom.id)

        q = svc.create_queue_entry(db_session, a, scope_type="grade_pool", scope_ref="4", classroom_id=classroom.id)
        assert q.status == "waiting"

    def test_matched_entries_do_not_count(self, db_session, classroom):
        a = _enrolled_student(db_session, classroom)
        for _ in range(svc.MAX_OPEN_QUEUE_ENTRIES):
            q = svc.create_queue_entry(db_session, a, scope_type="grade_pool", scope_ref="4", classroom_id=classroom.id)
            q.status = "matched"
        db_session.commit()

        q = svc.create_queue_entry(db_session, a, scope_type="grade_pool", scope_ref="4", classroom_id=classroom.id)
        assert q.status == "waiting"

    def test_abandoned_plain_queue_entry_past_the_idle_window_does_not_count(self, db_session, classroom):
        a = _enrolled_student(db_session, classroom)
        for _ in range(svc.MAX_OPEN_QUEUE_ENTRIES):
            q = svc.create_queue_entry(db_session, a, scope_type="grade_pool", scope_ref="4", classroom_id=classroom.id)
            q.created_at = datetime.now(timezone.utc) - timedelta(minutes=svc.INVITE_LIFETIME_MINUTES + 1)
        db_session.commit()

        q = svc.create_queue_entry(db_session, a, scope_type="grade_pool", scope_ref="4", classroom_id=classroom.id)
        assert q.status == "waiting"

    def test_invite_past_its_own_expiry_does_not_count(self, db_session, classroom):
        a = _enrolled_student(db_session, classroom)
        for _ in range(svc.MAX_OPEN_QUEUE_ENTRIES):
            q = svc.create_invite(db_session, a, scope_type="lesson", scope_ref="L0125", classroom_id=classroom.id)
            q.invite_expires_at = datetime.now(timezone.utc) - timedelta(seconds=1)
        db_session.commit()

        q = svc.create_invite(db_session, a, scope_type="lesson", scope_ref="L0125", classroom_id=classroom.id)
        assert q.invite_code is not None

    def test_a_fresh_invite_still_counts_even_when_old_enough_a_plain_entry_would_not(self, db_session, classroom):
        """An invite's own `invite_expires_at` (5 min) governs it, not the
        generic idle window applied to plain queue rows — a fresh invite
        must still count toward the cap."""
        a = _enrolled_student(db_session, classroom)
        for _ in range(svc.MAX_OPEN_QUEUE_ENTRIES):
            svc.create_invite(db_session, a, scope_type="lesson", scope_ref="L0125", classroom_id=classroom.id)

        with pytest.raises(Exception) as exc:
            svc.create_queue_entry(db_session, a, scope_type="grade_pool", scope_ref="4", classroom_id=classroom.id)
        assert exc.value.status_code == 429
