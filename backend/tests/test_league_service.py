"""Tests for app.services.league_service — invitation lifecycle (invite
code, accept/decline/revoke), roster locking, class-average boards, season
result snapshots, and the student-facing "my team" summary.

Completions in these tests use session_mode="assignment" (always counts,
no grade-floor lookup needed) so the grade-floor/lesson-catalogue behavior
already covered in test_league_scoring.py doesn't need to be re-mocked here.
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

import pytest

from app.services import league_service as svc
from league_factories import (
    add_co_teacher,
    complete_lesson,
    enroll_student,
    make_classroom,
    make_org,
    make_school,
    make_student,
    make_teacher,
)


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


NOW = datetime(2026, 10, 15, 12, 0, 0, tzinfo=timezone.utc)


def _two_classrooms_same_org(db, *, org=None):
    org = org or make_org(db)
    school = make_school(db, org=org)
    teacher_a = make_teacher(db, name="A老師")
    teacher_b = make_teacher(db, name="B老師")
    classroom_a = make_classroom(db, school, teacher_a, name="A班", grade=5)
    classroom_b = make_classroom(db, school, teacher_b, name="B班", grade=5)
    return teacher_a, teacher_b, classroom_a, classroom_b


class TestCreateInvitation:
    def test_only_classroom_owner_can_create(self, db_session):
        _, teacher_b, classroom_a, _ = _two_classrooms_same_org(db_session)
        db_session.commit()
        with pytest.raises(svc.LeagueError) as exc:
            svc.create_invitation(
                db_session, creator=teacher_b, inviter_classroom=classroom_a,
                inviter_team_grade=5, game_start=NOW + timedelta(days=1),
                game_end=NOW + timedelta(days=2),
            )
        assert exc.value.status_code == 403

    def test_assistant_co_teacher_cannot_create(self, db_session):
        teacher_a, _, classroom_a, _ = _two_classrooms_same_org(db_session)
        assistant = make_teacher(db_session, name="助教")
        add_co_teacher(db_session, classroom_a, assistant)
        db_session.commit()
        with pytest.raises(svc.LeagueError) as exc:
            svc.create_invitation(
                db_session, creator=assistant, inviter_classroom=classroom_a,
                inviter_team_grade=5, game_start=NOW + timedelta(days=1),
                game_end=NOW + timedelta(days=2),
            )
        assert exc.value.status_code == 403

    def test_window_end_must_be_after_start(self, db_session):
        teacher_a, _, classroom_a, _ = _two_classrooms_same_org(db_session)
        db_session.commit()
        with pytest.raises(svc.LeagueError):
            svc.create_invitation(
                db_session, creator=teacher_a, inviter_classroom=classroom_a,
                inviter_team_grade=5, game_start=NOW, game_end=NOW - timedelta(hours=1),
            )

    def test_generates_a_unique_pending_code(self, db_session):
        teacher_a, _, classroom_a, _ = _two_classrooms_same_org(db_session)
        db_session.commit()
        invitation = svc.create_invitation(
            db_session, creator=teacher_a, inviter_classroom=classroom_a,
            inviter_team_grade=5, game_start=NOW + timedelta(days=1),
            game_end=NOW + timedelta(days=2),
        )
        assert invitation.status == "pending"
        assert len(invitation.code) == 8


class TestAcceptInvitation:
    def _pending(self, db, teacher_a, classroom_a, *, grade=5):
        return svc.create_invitation(
            db, creator=teacher_a, inviter_classroom=classroom_a,
            inviter_team_grade=grade, game_start=NOW + timedelta(days=1),
            game_end=NOW + timedelta(days=2),
        )

    def test_only_invitee_classroom_owner_can_accept(self, db_session):
        teacher_a, teacher_b, classroom_a, classroom_b = _two_classrooms_same_org(db_session)
        invitation = self._pending(db_session, teacher_a, classroom_a)
        db_session.commit()
        stranger = make_teacher(db_session, name="路人老師")
        with pytest.raises(svc.LeagueError) as exc:
            svc.accept_invitation(
                db_session, code=invitation.code, acceptor=stranger,
                invitee_classroom=classroom_b, invitee_team_grade=5, now=NOW,
            )
        assert exc.value.status_code == 403

    def test_cross_org_is_denied(self, db_session):
        teacher_a, _, classroom_a, _ = _two_classrooms_same_org(db_session)
        invitation = self._pending(db_session, teacher_a, classroom_a)
        other_org_school = make_school(db_session, org=make_org(db_session))
        teacher_c = make_teacher(db_session, name="C老師")
        classroom_c = make_classroom(db_session, other_org_school, teacher_c, grade=5)
        db_session.commit()
        with pytest.raises(svc.LeagueError) as exc:
            svc.accept_invitation(
                db_session, code=invitation.code, acceptor=teacher_c,
                invitee_classroom=classroom_c, invitee_team_grade=5, now=NOW,
            )
        assert exc.value.status_code == 403

    def test_org_null_is_denied(self, db_session):
        teacher_a, _, classroom_a, _ = _two_classrooms_same_org(db_session)
        invitation = self._pending(db_session, teacher_a, classroom_a)
        orgless_school = make_school(db_session, org=None)
        teacher_d = make_teacher(db_session, name="D老師")
        classroom_d = make_classroom(db_session, orgless_school, teacher_d, grade=5)
        db_session.commit()
        with pytest.raises(svc.LeagueError) as exc:
            svc.accept_invitation(
                db_session, code=invitation.code, acceptor=teacher_d,
                invitee_classroom=classroom_d, invitee_team_grade=5, now=NOW,
            )
        assert exc.value.status_code == 403

    def test_cannot_accept_own_invitation(self, db_session):
        teacher_a, _, classroom_a, _ = _two_classrooms_same_org(db_session)
        invitation = self._pending(db_session, teacher_a, classroom_a)
        db_session.commit()
        with pytest.raises(svc.LeagueError):
            svc.accept_invitation(
                db_session, code=invitation.code, acceptor=teacher_a,
                invitee_classroom=classroom_a, invitee_team_grade=5, now=NOW,
            )

    def test_accept_creates_season_with_two_teams_and_locked_rosters(self, db_session):
        teacher_a, teacher_b, classroom_a, classroom_b = _two_classrooms_same_org(db_session)
        students_a = [make_student(db_session) for _ in range(3)]
        students_b = [make_student(db_session) for _ in range(2)]
        for s in students_a:
            enroll_student(db_session, classroom_a, s)
        for s in students_b:
            enroll_student(db_session, classroom_b, s)
        invitation = self._pending(db_session, teacher_a, classroom_a)
        db_session.commit()

        updated = svc.accept_invitation(
            db_session, code=invitation.code, acceptor=teacher_b,
            invitee_classroom=classroom_b, invitee_team_grade=5, now=NOW,
        )
        assert updated.status == "accepted"
        season = updated.season
        assert season is not None
        assert len(season.teams) == 2
        rosters = {t.classroom_id: len(t.roster) for t in season.teams}
        assert rosters[classroom_a.id] == 3
        assert rosters[classroom_b.id] == 2

    def test_roster_is_locked_not_live(self, db_session):
        # A student enrolled AFTER acceptance must not appear on the roster.
        teacher_a, teacher_b, classroom_a, classroom_b = _two_classrooms_same_org(db_session)
        early_student = make_student(db_session)
        enroll_student(db_session, classroom_a, early_student)
        invitation = self._pending(db_session, teacher_a, classroom_a)
        db_session.commit()
        updated = svc.accept_invitation(
            db_session, code=invitation.code, acceptor=teacher_b,
            invitee_classroom=classroom_b, invitee_team_grade=5, now=NOW,
        )
        late_student = make_student(db_session)
        enroll_student(db_session, classroom_a, late_student)
        db_session.commit()

        team_a = next(t for t in updated.season.teams if t.classroom_id == classroom_a.id)
        roster_ids = {m.student_id for m in team_a.roster}
        assert roster_ids == {early_student.id}
        assert late_student.id not in roster_ids

    def test_double_accept_by_same_classroom_is_idempotent(self, db_session):
        teacher_a, teacher_b, classroom_a, classroom_b = _two_classrooms_same_org(db_session)
        invitation = self._pending(db_session, teacher_a, classroom_a)
        db_session.commit()
        first = svc.accept_invitation(
            db_session, code=invitation.code, acceptor=teacher_b,
            invitee_classroom=classroom_b, invitee_team_grade=5, now=NOW,
        )
        season_id_first = first.season.id
        second = svc.accept_invitation(
            db_session, code=invitation.code, acceptor=teacher_b,
            invitee_classroom=classroom_b, invitee_team_grade=5, now=NOW,
        )
        assert second.season.id == season_id_first  # no duplicate season created

    def test_different_classroom_cannot_reuse_an_already_accepted_code(self, db_session):
        teacher_a, teacher_b, classroom_a, classroom_b = _two_classrooms_same_org(db_session)
        invitation = self._pending(db_session, teacher_a, classroom_a)
        db_session.commit()
        svc.accept_invitation(
            db_session, code=invitation.code, acceptor=teacher_b,
            invitee_classroom=classroom_b, invitee_team_grade=5, now=NOW,
        )
        teacher_c = make_teacher(db_session, name="C老師")
        # Reuse classroom_a's own school/org so the same-org check can't be
        # what trips this — the rejection must be "code already used", not
        # an org mismatch.
        classroom_c = make_classroom(db_session, classroom_a.school, teacher_c, grade=5)
        db_session.commit()
        with pytest.raises(svc.LeagueError) as exc:
            svc.accept_invitation(
                db_session, code=invitation.code, acceptor=teacher_c,
                invitee_classroom=classroom_c, invitee_team_grade=5, now=NOW,
            )
        assert exc.value.status_code == 409

    def test_expired_invitation_is_rejected(self, db_session):
        teacher_a, teacher_b, classroom_a, classroom_b = _two_classrooms_same_org(db_session)
        invitation = self._pending(db_session, teacher_a, classroom_a)
        db_session.commit()
        later = invitation.game_start + timedelta(hours=1)
        with pytest.raises(svc.LeagueError) as exc:
            svc.accept_invitation(
                db_session, code=invitation.code, acceptor=teacher_b,
                invitee_classroom=classroom_b, invitee_team_grade=5, now=later,
            )
        assert exc.value.status_code == 409
        db_session.refresh(invitation)
        assert invitation.status == "expired"

    def test_revoked_invitation_cannot_be_accepted(self, db_session):
        teacher_a, teacher_b, classroom_a, classroom_b = _two_classrooms_same_org(db_session)
        invitation = self._pending(db_session, teacher_a, classroom_a)
        db_session.commit()
        svc.revoke_invitation(db_session, invitation)
        with pytest.raises(svc.LeagueError) as exc:
            svc.accept_invitation(
                db_session, code=invitation.code, acceptor=teacher_b,
                invitee_classroom=classroom_b, invitee_team_grade=5, now=NOW,
            )
        assert exc.value.status_code == 409

    def test_declined_invitation_cannot_be_accepted_later(self, db_session):
        teacher_a, teacher_b, classroom_a, classroom_b = _two_classrooms_same_org(db_session)
        invitation = self._pending(db_session, teacher_a, classroom_a)
        db_session.commit()
        svc.decline_invitation(db_session, invitation=invitation, responder=teacher_b, now=NOW)
        with pytest.raises(svc.LeagueError) as exc:
            svc.accept_invitation(
                db_session, code=invitation.code, acceptor=teacher_b,
                invitee_classroom=classroom_b, invitee_team_grade=5, now=NOW,
            )
        assert exc.value.status_code == 409


class TestSeasonBoard:
    def _season_with_scores(self, db):
        teacher_a, teacher_b, classroom_a, classroom_b = _two_classrooms_same_org(db)
        a_students = [make_student(db) for _ in range(2)]
        b_students = [make_student(db) for _ in range(2)]
        for s in a_students:
            enroll_student(db, classroom_a, s)
        for s in b_students:
            enroll_student(db, classroom_b, s)

        invitation = svc.create_invitation(
            db, creator=teacher_a, inviter_classroom=classroom_a, inviter_team_grade=5,
            game_start=NOW, game_end=NOW + timedelta(days=2),
        )
        db.commit()
        updated = svc.accept_invitation(
            db, code=invitation.code, acceptor=teacher_b, invitee_classroom=classroom_b,
            invitee_team_grade=5, now=NOW - timedelta(hours=1),
        )
        season = updated.season

        # Classroom A: only 1 of 2 students scores anything (the other is 0).
        complete_lesson(
            db, a_students[0], "100", started_at=NOW + timedelta(minutes=1, hours=-1),
            completed_at=NOW + timedelta(hours=1), session_mode="assignment",
        )
        # Classroom B: both students score.
        complete_lesson(
            db, b_students[0], "200", started_at=NOW + timedelta(minutes=1, hours=-1),
            completed_at=NOW + timedelta(hours=1), session_mode="assignment",
        )
        complete_lesson(
            db, b_students[1], "201", started_at=NOW + timedelta(minutes=1, hours=-1),
            completed_at=NOW + timedelta(hours=1), session_mode="assignment",
        )
        db.commit()
        db.refresh(season)
        return season, classroom_a, classroom_b

    def test_average_includes_zero_scorers_in_the_denominator(self, db_session):
        season, classroom_a, _ = self._season_with_scores(db_session)
        board = svc.get_season_board(db_session, season)
        row_a = next(r for r in board if r["classroom_id"] == classroom_a.id)
        # One student scored 10+2=12, the other 0 -> average = 6.0, not 12.0
        assert row_a["average_points"] == pytest.approx(6.0)
        assert row_a["roster_size"] == 2
        assert row_a["participant_count"] == 1

    def test_board_sorted_descending_by_average(self, db_session):
        season, classroom_a, classroom_b = self._season_with_scores(db_session)
        board = svc.get_season_board(db_session, season)
        assert board[0]["classroom_id"] == classroom_b.id  # higher average (both scored)
        assert board[0]["rank"] == 1
        assert board[1]["rank"] == 2

    def test_no_per_student_fields_in_board_response(self, db_session):
        season, _, _ = self._season_with_scores(db_session)
        board = svc.get_season_board(db_session, season)
        banned = {"student_id", "name", "email", "user_id"}
        for row in board:
            assert banned.isdisjoint(row.keys())


class TestSeasonFinalization:
    def test_does_not_finalize_before_game_end(self, db_session):
        season, _, _ = TestSeasonBoard()._season_with_scores(db_session)
        result = svc.finalize_season_if_ended(
            db_session, season, now=season.game_start + timedelta(hours=2)
        )
        assert result.result_snapshot is None

    def test_finalizes_and_freezes_after_game_end(self, db_session):
        season, classroom_a, _ = TestSeasonBoard()._season_with_scores(db_session)
        after_end = season.game_end + timedelta(minutes=1)
        result = svc.finalize_season_if_ended(db_session, season, now=after_end)
        assert result.result_snapshot is not None
        frozen_board = result.result_snapshot["board"]

        # A late completion after game_end must NOT change the frozen result.
        team_a = next(t for t in season.teams if t.classroom_id == classroom_a.id)
        late_student = team_a.roster[0].student
        complete_lesson(
            db_session, late_student, "999",
            started_at=after_end + timedelta(days=1, minutes=-10),
            completed_at=after_end + timedelta(days=1), session_mode="assignment",
        )
        db_session.commit()

        cached = svc.get_season_board_cached(db_session, result, now=after_end + timedelta(days=2))
        assert cached == frozen_board


class TestMyTeamSummaryAndHistory:
    def test_summary_has_no_classmate_individual_scores(self, db_session):
        season, classroom_a, _ = TestSeasonBoard()._season_with_scores(db_session)
        team_a = next(t for t in season.teams if t.classroom_id == classroom_a.id)
        viewer = team_a.roster[0].student
        summary = svc.get_my_team_summary(db_session, viewer, season)
        dumped_keys = set(summary.keys())
        assert "classmates" not in dumped_keys
        assert "roster" not in dumped_keys
        assert {"my_points", "class_average_points", "participant_count", "roster_size"} <= dumped_keys

    def test_non_member_gets_404(self, db_session):
        season, _, _ = TestSeasonBoard()._season_with_scores(db_session)
        outsider = make_student(db_session)
        db_session.commit()
        with pytest.raises(svc.LeagueError) as exc:
            svc.get_my_team_summary(db_session, outsider, season)
        assert exc.value.status_code == 404

    def test_list_my_seasons_returns_only_seasons_the_student_is_on(self, db_session):
        season, classroom_a, _ = TestSeasonBoard()._season_with_scores(db_session)
        team_a = next(t for t in season.teams if t.classroom_id == classroom_a.id)
        member = team_a.roster[0].student
        outsider = make_student(db_session)
        db_session.commit()

        assert [s.id for s in svc.list_my_seasons(db_session, member)] == [season.id]
        assert svc.list_my_seasons(db_session, outsider) == []


class TestTeamAnomalies:
    def test_flags_too_fast_completion_for_teacher_view(self, db_session):
        teacher_a, teacher_b, classroom_a, classroom_b = _two_classrooms_same_org(db_session)
        student = make_student(db_session)
        enroll_student(db_session, classroom_a, student)
        invitation = svc.create_invitation(
            db_session, creator=teacher_a, inviter_classroom=classroom_a, inviter_team_grade=5,
            game_start=NOW, game_end=NOW + timedelta(days=2),
        )
        db_session.commit()
        updated = svc.accept_invitation(
            db_session, code=invitation.code, acceptor=teacher_b, invitee_classroom=classroom_b,
            invitee_team_grade=5, now=NOW - timedelta(hours=1),
        )
        complete_lesson(
            db_session, student, "100", started_at=NOW + timedelta(hours=1, seconds=-60),
            completed_at=NOW + timedelta(hours=1), session_mode="assignment",
        )
        db_session.commit()

        team_a = next(t for t in updated.season.teams if t.classroom_id == classroom_a.id)
        anomalies = svc.get_team_anomalies(db_session, team_a, updated.season)
        assert len(anomalies) == 1
        assert anomalies[0]["student_id"] == student.id
        assert anomalies[0]["anomalies"][0]["reason"] == "too_fast"
