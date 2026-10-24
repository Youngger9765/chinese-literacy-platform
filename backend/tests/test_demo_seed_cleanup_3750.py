"""Regression lock for issue #3750 — 跨班賽季顯示「全班 1,698 人已參與」。

Root cause (confirmed on staging, not guessed): `seed_demo_students` was built
idempotent *per email* ("same email → reuse, don't create a new account"),
but `frontend/tests/e2e/full-qa.spec.ts` and `frontend/tests/e2e/demo-path.spec.ts`
called `POST /api/admin/seed/demo-students` with a `Date.now()`-based prefix —
a brand new email every run — which defeats that idempotency on purpose.
Both specs always hit the same shared classroom (`classroom_id: 1`), and
nothing ever cleaned the accounts up. Over ~4.5 months of repeated e2e/QA
runs against staging this accumulated 1,927 throwaway
`*@testdata.lingoleap.dev` accounts permanently enrolled in that one
classroom (confirmed via the real staging API — only 1 of the 1,928
enrolled "students" was the real demo account). `league_service.roster_size`
was never wrong about *counting* — it faithfully counted a classroom that
had, in fact, been inflated to 1,928 enrollments. 跨班賽季 (league) was simply
the first feature to print that count directly in front of a real user.

This file locks the fix: `cleanup_demo_students` removes those throwaway
enrollments (current `ClassroomStudent` rows AND any already-locked
`LeagueTeamRosterMember` rows from a previously-registered league team),
scoped to one classroom, without touching the real student's enrollment,
another classroom's data, or the `User`/`LearningSession` rows themselves
(many other tables reference `users.id` without `ON DELETE CASCADE`, so
deleting those accounts outright is out of scope for this bug — see PR
description).

This test is RED against the code as of issue #3750 (no `cleanup_demo_students`
exists yet) and GREEN once it is implemented.
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

import pytest

from app.models.league import LeagueSeason, LeagueTeam, LeagueTeamRosterMember, SEASON_INVITATIONAL
from app.models.school import ClassroomStudent
from app.models.user import User
from app.services.league_scoring import weights_snapshot_for_version
from app.services import league_service as league_svc
from league_factories import (
    enroll_student,
    make_classroom,
    make_org,
    make_school,
    make_student,
    make_teacher,
)

# Import target lazily per-test so a missing symbol fails with a clear
# assertion message instead of a collection-time ImportError nuking the
# whole test file (keeps the "red" readable while #3750 is unfixed).
try:
    from app.services.test_seed_service import (
        DemoSeedCapExceeded,
        cleanup_demo_students,
        seed_demo_students,
    )
except ImportError:  # pragma: no cover - exercised only before the fix lands
    DemoSeedCapExceeded = None
    cleanup_demo_students = None
    seed_demo_students = None

from app.schemas.admin_seed import DemoStudentSeedRequest

_TEST_SEED_DOMAIN = "testdata.lingoleap.dev"
NOW = datetime(2026, 10, 24, 12, 0, 0, tzinfo=timezone.utc)


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


def _make_fake_seed_student(db, n: int) -> User:
    """A throwaway account shaped exactly like what the defeated-idempotency
    e2e calls actually created on staging (e2e<digits>@testdata.lingoleap.dev)."""
    user = User(
        email=f"e2e{n:06d}01@{_TEST_SEED_DOMAIN}",
        name=f"E2e{n:06d}學生01",
        password_hash="x",
        is_active=True,
    )
    db.add(user)
    db.flush()
    return user


def _register_team(db, classroom, *, grade=3):
    """Mirrors league_service._register_team without going through the full
    invitation-accept flow — this test is about roster cleanup, not the
    invitation state machine (already covered by test_league_service.py)."""
    season = LeagueSeason(
        kind=SEASON_INVITATIONAL,
        name="跨班邀請賽：測試",
        game_start=NOW - timedelta(days=1),
        game_end=NOW + timedelta(days=6),
        weights_snapshot=weights_snapshot_for_version(league_svc.DEFAULT_WEIGHTS_VERSION),
        created_by=classroom.teacher_id,
    )
    db.add(season)
    db.flush()

    team = LeagueTeam(
        season_id=season.id, classroom_id=classroom.id, grade=grade, registered_by=classroom.teacher_id
    )
    db.add(team)
    db.flush()

    student_ids = [
        r[0]
        for r in db.query(ClassroomStudent.student_id)
        .filter(ClassroomStudent.classroom_id == classroom.id)
        .all()
    ]
    for sid in student_ids:
        db.add(LeagueTeamRosterMember(team_id=team.id, season_id=season.id, student_id=sid))
    db.flush()
    db.commit()
    return season, team


class TestCleanupDemoStudents:
    def test_characterizes_the_bug_roster_is_inflated_before_cleanup(self, db_session):
        """Pin the mechanism: a classroom with 1 real student + 5 defeated-
        idempotency seed accounts locks a 6-person roster — exactly the shape
        that showed up as "全班 1,698 人" on staging (there it was 1 real + 1,927
        fake; this test uses a smaller number for speed)."""
        org = make_org(db_session)
        school = make_school(db_session, org=org)
        teacher = make_teacher(db_session)
        classroom = make_classroom(db_session, school, teacher, name="三年甲班")
        real_student = make_student(db_session, name="小明")
        enroll_student(db_session, classroom, real_student)
        for i in range(5):
            enroll_student(db_session, classroom, _make_fake_seed_student(db_session, i))
        db_session.commit()

        season, team = _register_team(db_session, classroom)
        board = league_svc.get_season_board(db_session, season)
        row = next(r for r in board if r["team_id"] == team.id)
        assert row["roster_size"] == 6, (
            "setup didn't reproduce the bug shape — expected a locked roster of "
            "1 real + 5 fake accounts, same mechanism as #3750's 1 + 1,927"
        )

    def test_cleanup_removes_fake_accounts_and_fixes_locked_roster(self, db_session):
        assert cleanup_demo_students is not None, (
            "app.services.test_seed_service.cleanup_demo_students does not exist yet "
            "— this is the function issue #3750 asks for. Implement it, then this "
            "test (and the rest of this file) should go green."
        )
        org = make_org(db_session)
        school = make_school(db_session, org=org)
        teacher = make_teacher(db_session)
        classroom = make_classroom(db_session, school, teacher, name="三年甲班")
        real_student = make_student(db_session, name="小明")
        enroll_student(db_session, classroom, real_student)
        fake_students = [_make_fake_seed_student(db_session, i) for i in range(5)]
        for fs in fake_students:
            enroll_student(db_session, classroom, fs)
        db_session.commit()

        season, team = _register_team(db_session, classroom)

        result = cleanup_demo_students(db_session, classroom.id, dry_run=False)

        assert result.dry_run is False
        assert result.classroom_students_removed == 5
        assert result.league_roster_rows_removed == 5

        # Live enrollment: only the real student remains.
        remaining = (
            db_session.query(ClassroomStudent)
            .filter(ClassroomStudent.classroom_id == classroom.id)
            .all()
        )
        assert [r.student_id for r in remaining] == [real_student.id]

        # The already-locked roster for the existing team is fixed too —
        # this is the part that actually unblocks the stuck "全班 1,698 人"
        # display, since roster_size reads league_team_roster_members, not
        # live classroom_students.
        board = league_svc.get_season_board(db_session, season)
        row = next(r for r in board if r["team_id"] == team.id)
        assert row["roster_size"] == 1
        assert row["participant_count"] == 0

        # The real student's own User row is untouched.
        assert db_session.query(User).filter(User.id == real_student.id).first() is not None
        # The fake accounts' User rows are intentionally left alone (out of
        # scope — see module docstring); only their classroom membership /
        # locked roster slot is removed.
        for fs in fake_students:
            assert db_session.query(User).filter(User.id == fs.id).first() is not None

    def test_cleanup_is_idempotent(self, db_session):
        assert cleanup_demo_students is not None
        org = make_org(db_session)
        school = make_school(db_session, org=org)
        teacher = make_teacher(db_session)
        classroom = make_classroom(db_session, school, teacher)
        enroll_student(db_session, classroom, _make_fake_seed_student(db_session, 1))
        db_session.commit()

        first = cleanup_demo_students(db_session, classroom.id, dry_run=False)
        assert first.classroom_students_removed == 1

        second = cleanup_demo_students(db_session, classroom.id, dry_run=False)
        assert second.classroom_students_removed == 0
        assert second.league_roster_rows_removed == 0

    def test_cleanup_does_not_touch_a_different_classroom(self, db_session):
        assert cleanup_demo_students is not None
        org = make_org(db_session)
        school = make_school(db_session, org=org)
        teacher_a = make_teacher(db_session, name="A老師")
        teacher_b = make_teacher(db_session, name="B老師")
        classroom_a = make_classroom(db_session, school, teacher_a, name="A班")
        classroom_b = make_classroom(db_session, school, teacher_b, name="B班")
        enroll_student(db_session, classroom_a, _make_fake_seed_student(db_session, 1))
        fake_in_b = _make_fake_seed_student(db_session, 2)
        enroll_student(db_session, classroom_b, fake_in_b)
        db_session.commit()

        result = cleanup_demo_students(db_session, classroom_a.id, dry_run=False)
        assert result.classroom_students_removed == 1

        # classroom_b's own fake enrollment must survive cleaning classroom_a.
        still_there = (
            db_session.query(ClassroomStudent)
            .filter(
                ClassroomStudent.classroom_id == classroom_b.id,
                ClassroomStudent.student_id == fake_in_b.id,
            )
            .first()
        )
        assert still_there is not None

    def test_real_students_never_match_the_seed_domain_filter(self, db_session):
        """Negative control for the filter itself (overclaim-bias.md: a
        negative assertion needs a positive control). A classroom with ONLY
        real-looking students must report nothing to clean, EVEN with
        dry_run=False (actually attempting the delete, not just previewing)."""
        assert cleanup_demo_students is not None
        org = make_org(db_session)
        school = make_school(db_session, org=org)
        teacher = make_teacher(db_session)
        classroom = make_classroom(db_session, school, teacher)
        enroll_student(db_session, classroom, make_student(db_session, name="真學生一"))
        enroll_student(db_session, classroom, make_student(db_session, name="真學生二"))
        db_session.commit()

        result = cleanup_demo_students(db_session, classroom.id, dry_run=False)
        assert result.classroom_students_removed == 0
        assert result.league_roster_rows_removed == 0

    def test_real_staging_demo_accounts_are_never_removed(self, db_session):
        """#3750 reviewer requirement (team-lead): prove by name that the
        ACTUAL real accounts seen on staging (student@test.com /
        teacher@test.com / admin@test.com, and the real 小明/小華 pair at
        @test.com) survive a real (non-dry-run) cleanup untouched — not
        just an abstract "real-looking" email."""
        assert cleanup_demo_students is not None
        org = make_org(db_session)
        school = make_school(db_session, org=org)
        teacher = make_teacher(db_session)
        classroom = make_classroom(db_session, school, teacher, name="三年甲班")

        real_accounts = []
        for email, name in [
            ("student@test.com", "小明"),
            ("student2@test.com", "小華"),
        ]:
            user = User(email=email, name=name, password_hash="x", is_active=True)
            db_session.add(user)
            db_session.flush()
            enroll_student(db_session, classroom, user)
            real_accounts.append(user)
        fake = _make_fake_seed_student(db_session, 1)
        enroll_student(db_session, classroom, fake)
        db_session.commit()

        result = cleanup_demo_students(db_session, classroom.id, dry_run=False)

        assert result.classroom_students_removed == 1, (
            "only the one @testdata.lingoleap.dev account should be removed"
        )
        remaining_emails = {
            row[0]
            for row in db_session.query(User.email)
            .join(ClassroomStudent, ClassroomStudent.student_id == User.id)
            .filter(ClassroomStudent.classroom_id == classroom.id)
            .all()
        }
        assert remaining_emails == {"student@test.com", "student2@test.com"}

    def test_dry_run_is_the_default_and_performs_no_deletion(self, db_session):
        """#3750 reviewer requirement (team-lead): the endpoint must be
        list-only unless a caller explicitly opts into deleting. Calling
        with no `dry_run` argument at all must not mutate anything."""
        assert cleanup_demo_students is not None
        org = make_org(db_session)
        school = make_school(db_session, org=org)
        teacher = make_teacher(db_session)
        classroom = make_classroom(db_session, school, teacher, name="三年甲班")
        real_student = make_student(db_session, name="小明")
        enroll_student(db_session, classroom, real_student)
        fake_students = [_make_fake_seed_student(db_session, i) for i in range(5)]
        for fs in fake_students:
            enroll_student(db_session, classroom, fs)
        db_session.commit()
        season, team = _register_team(db_session, classroom)

        # No dry_run kwarg at all — must behave as a safe preview.
        preview = cleanup_demo_students(db_session, classroom.id)

        assert preview.dry_run is True
        assert preview.classroom_students_removed == 5, (
            "dry run must still report the CORRECT count, just not act on it"
        )
        assert preview.league_roster_rows_removed == 5

        # Nothing was actually deleted: live enrollment unchanged...
        still_enrolled = (
            db_session.query(ClassroomStudent)
            .filter(ClassroomStudent.classroom_id == classroom.id)
            .count()
        )
        assert still_enrolled == 6, "dry_run must not touch ClassroomStudent at all"
        # ...and the locked league roster is still the inflated 6, not 1.
        board = league_svc.get_season_board(db_session, season)
        row = next(r for r in board if r["team_id"] == team.id)
        assert row["roster_size"] == 6, "dry_run must not touch LeagueTeamRosterMember at all"

        # A subsequent dry_run=False call still finds and removes the same 5.
        real_result = cleanup_demo_students(db_session, classroom.id, dry_run=False)
        assert real_result.classroom_students_removed == 5
        assert real_result.league_roster_rows_removed == 5

    def test_unknown_classroom_raises(self, db_session):
        assert cleanup_demo_students is not None
        with pytest.raises(ValueError):
            cleanup_demo_students(db_session, 999999)


class TestSeedDemoStudentsCapGuard:
    """#3750 defense-in-depth: even a caller that (re-)introduces a
    unique-every-call prefix can no longer grow one classroom's throwaway
    roster without bound — seed_demo_students now refuses once a classroom
    already carries _MAX_DEMO_STUDENTS_PER_CLASSROOM seeded accounts."""

    def test_repeated_unique_prefixes_eventually_trip_the_cap(self, db_session):
        assert seed_demo_students is not None
        org = make_org(db_session)
        school = make_school(db_session, org=org)
        teacher = make_teacher(db_session)
        classroom = make_classroom(db_session, school, teacher)
        db_session.commit()

        from app.services.test_seed_service import _MAX_DEMO_STUDENTS_PER_CLASSROOM

        # Simulate the exact defeated-idempotency pattern: a fresh prefix
        # every call, one account per call — same as the real e2e specs.
        calls = 0
        with pytest.raises(DemoSeedCapExceeded):
            for i in range(_MAX_DEMO_STUDENTS_PER_CLASSROOM + 5):
                seed_demo_students(
                    db_session,
                    DemoStudentSeedRequest(classroom_id=classroom.id, count=1, prefix=f"uniq{i}"),
                )
                calls += 1

        assert calls <= _MAX_DEMO_STUDENTS_PER_CLASSROOM, (
            "the cap should trip at or before the configured limit, not after it"
        )

    def test_reusing_the_same_prefix_never_trips_the_cap(self, db_session):
        """The normal/intended usage (fixed prefix, idempotent reuse) is
        unaffected — this is the behavior change this fix asks e2e specs to
        adopt, so it must work cleanly."""
        assert seed_demo_students is not None
        org = make_org(db_session)
        school = make_school(db_session, org=org)
        teacher = make_teacher(db_session)
        classroom = make_classroom(db_session, school, teacher)
        db_session.commit()

        for _ in range(10):
            result = seed_demo_students(
                db_session,
                DemoStudentSeedRequest(classroom_id=classroom.id, count=1, prefix="e2e-smoke"),
            )
            assert result.students_created == 1

        enrolled = (
            db_session.query(ClassroomStudent)
            .filter(ClassroomStudent.classroom_id == classroom.id)
            .count()
        )
        assert enrolled == 1, "reusing the same prefix must stay idempotent, not accumulate"

    def test_reusing_a_prefix_in_an_already_full_classroom_is_not_rejected(self, db_session):
        """Code review on #3757: the cap counted every requested id as new.
        Staging's classroom 1 still carries ~29 seeded accounts (> the cap),
        so once merged every e2e reseed of its own fixed prefix -- which adds
        zero rows -- got a 409 and the smoke specs broke. Only accounts this
        call would actually add may count against the cap."""
        assert seed_demo_students is not None
        org = make_org(db_session)
        school = make_school(db_session, org=org)
        teacher = make_teacher(db_session)
        classroom = make_classroom(db_session, school, teacher)
        db_session.commit()

        from app.services.test_seed_service import _MAX_DEMO_STUDENTS_PER_CLASSROOM

        seed_demo_students(
            db_session,
            DemoStudentSeedRequest(classroom_id=classroom.id, count=1, prefix="e2e-smoke"),
        )
        for i in range(_MAX_DEMO_STUDENTS_PER_CLASSROOM + 5):
            classroom_member = _make_fake_seed_student(db_session, 900 + i)
            db_session.add(ClassroomStudent(classroom_id=classroom.id, student_id=classroom_member.id))
        db_session.commit()

        # Same fixed prefix again: adds nothing, must not be rejected.
        result = seed_demo_students(
            db_session,
            DemoStudentSeedRequest(classroom_id=classroom.id, count=1, prefix="e2e-smoke"),
        )
        assert result.students_created == 1

        # A brand-new prefix in the same over-cap classroom is still refused.
        with pytest.raises(DemoSeedCapExceeded):
            seed_demo_students(
                db_session,
                DemoStudentSeedRequest(classroom_id=classroom.id, count=1, prefix="fresh-prefix"),
            )
