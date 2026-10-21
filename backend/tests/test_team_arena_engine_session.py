"""TDD for team_arena.engine v2 — room create/join, PRD §0 v2 改版 A/B/C/K."""
from __future__ import annotations

import pytest
from fastapi import HTTPException

from app.services.team_arena import engine as svc
from league_factories import enroll_student, make_classroom, make_school, make_student, make_teacher


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


def _student_with_grade(db, grade=4, name="學生"):
    """No StudentProfile factory exists in league_factories — the engine's
    fallback path (resolve via ANY enrolled classroom's grade) is the
    simplest one to exercise from shared test fixtures, so every test here
    goes through it rather than hand-building a StudentProfile row."""
    teacher = make_teacher(db)
    school = make_school(db)
    room = make_classroom(db, school, teacher, grade=grade)
    student = make_student(db, name=name)
    enroll_student(db, room, student)
    db.commit()
    return student


class TestResolveHostGrade:
    def test_resolves_from_enrolled_classroom(self, db_session):
        host = _student_with_grade(db_session, grade=4)
        assert svc._resolve_host_grade(db_session, host) == "4"

    def test_no_classroom_no_profile_raises_400(self, db_session):
        host = make_student(db_session)
        db_session.commit()
        with pytest.raises(HTTPException) as exc:
            svc._resolve_host_grade(db_session, host)
        assert exc.value.status_code == 400


class TestResolvePoolGrade:
    """issue #3663 round 3 (#3673): team_arena used to have its own copy of
    `resolve_pool_grade` missing the out-of-range guard pk/escape_room's
    shared `game_core.scope` copy already had — `scope_ref="99"` would
    silently resolve to the nearest available grade instead of failing
    closed. Now `svc.resolve_pool_grade` IS that shared function
    (re-exported, same as pk/escape_room's engines already do), so this
    locks the behavior at the exact name team_arena calls it by."""

    def test_rejects_an_out_of_range_grade(self, monkeypatch):
        from app.services.game_core import scope as scope_svc

        monkeypatch.setattr(scope_svc, "get_available_grades", lambda: [4, 5, 6])
        with pytest.raises(HTTPException) as exc:
            svc.resolve_pool_grade("99")
        assert exc.value.status_code == 400

    def test_still_resolves_nearest_grade_for_an_in_range_value(self, monkeypatch):
        from app.services.game_core import scope as scope_svc

        monkeypatch.setattr(scope_svc, "get_available_grades", lambda: [4, 6])
        assert svc.resolve_pool_grade("3") == "4"


class TestCreateSession:
    def test_defaults_applied_and_host_auto_seated(self, db_session):
        host = _student_with_grade(db_session, grade=4)
        session = svc.create_session(db_session, host)

        assert session.status == "lobby"
        assert session.classroom_id is None  # PRD rule B
        assert session.teacher_id == host.id  # v2: host id
        assert len(session.code) == 6
        assert session.settings["team_size"] == 5
        assert session.settings["turns_per_player"] == 2
        assert session.settings["answer_seconds"] == 30
        assert session.settings["scope_ref"] == "4"

        from app.models.team_arena import TeamArenaMember
        seated = db_session.query(TeamArenaMember).filter(TeamArenaMember.session_id == session.id).all()
        assert len(seated) == 1
        assert seated[0].student_id == host.id
        assert seated[0].side == 0  # default side "a"

    def test_custom_settings_and_side(self, db_session):
        host = _student_with_grade(db_session, grade=4)
        session = svc.create_session(
            db_session, host, team_size=3, turns_per_player=1, answer_seconds=45, side="b",
        )
        assert session.settings["team_size"] == 3
        assert session.settings["turns_per_player"] == 1
        assert session.settings["answer_seconds"] == 45

        from app.models.team_arena import TeamArenaMember
        seated = db_session.query(TeamArenaMember).filter(TeamArenaMember.session_id == session.id).first()
        assert seated.side == 1  # "b"

    def test_invalid_team_size_rejected(self, db_session):
        host = _student_with_grade(db_session, grade=4)
        with pytest.raises(HTTPException) as exc:
            svc.create_session(db_session, host, team_size=6)
        assert exc.value.status_code == 400

    def test_host_without_grade_rejected(self, db_session):
        host = make_student(db_session)
        db_session.commit()
        with pytest.raises(HTTPException) as exc:
            svc.create_session(db_session, host)
        assert exc.value.status_code == 400


class TestJoinSession:
    def test_any_student_can_join_regardless_of_classroom(self, db_session):
        """PRD rule B: "拿到代碼的全平台任何學生都能加入" — the joiner is a
        student with NO relationship to the host's classroom at all."""
        host = _student_with_grade(db_session, grade=4)
        session = svc.create_session(db_session, host)

        stranger = make_student(db_session, name="陌生同學")
        db_session.commit()
        joined = svc.join_session(db_session, stranger, session.code, side="b")
        assert joined.code == session.code

    def test_join_full_side_rejected(self, db_session):
        host = _student_with_grade(db_session, grade=4)
        session = svc.create_session(db_session, host, team_size=2, side="a")
        s2 = make_student(db_session, name="s2")
        db_session.commit()
        svc.join_session(db_session, s2, session.code, side="a")  # fills side a (2/2)

        s3 = make_student(db_session, name="s3")
        db_session.commit()
        with pytest.raises(HTTPException) as exc:
            svc.join_session(db_session, s3, session.code, side="a")
        assert exc.value.status_code == 409

    def test_join_after_start_rejected_for_new_student(self, db_session):
        host = _student_with_grade(db_session, grade=4)
        session = svc.create_session(db_session, host, team_size=2, side="a")
        others = [make_student(db_session, name=f"s{i}") for i in range(3)]
        db_session.commit()
        svc.join_session(db_session, others[0], session.code, side="a")
        svc.join_session(db_session, others[1], session.code, side="b")
        svc.join_session(db_session, others[2], session.code, side="b")
        svc.control(db_session, session, host, action="start")

        newcomer = make_student(db_session, name="late")
        db_session.commit()
        with pytest.raises(HTTPException) as exc:
            svc.join_session(db_session, newcomer, session.code, side="a")
        assert exc.value.status_code == 409

    def test_rejoin_after_start_is_idempotent(self, db_session):
        """Explicit DELIVERY requirement: rejoin after start must keep
        working for rostered students."""
        host = _student_with_grade(db_session, grade=4)
        session = svc.create_session(db_session, host, team_size=2, side="a")
        others = [make_student(db_session, name=f"s{i}") for i in range(3)]
        db_session.commit()
        svc.join_session(db_session, others[0], session.code, side="a")
        svc.join_session(db_session, others[1], session.code, side="b")
        svc.join_session(db_session, others[2], session.code, side="b")
        svc.control(db_session, session, host, action="start")

        # Host AND a rostered student can both call join again post-start
        # without error (page refresh / tablet slept).
        again = svc.join_session(db_session, host, session.code, side="b")
        assert again.status == "playing"
        again2 = svc.join_session(db_session, others[0], session.code, side="b")
        assert again2.status == "playing"

    def test_unknown_code_404(self, db_session):
        stranger = make_student(db_session)
        db_session.commit()
        with pytest.raises(HTTPException) as exc:
            svc.join_session(db_session, stranger, "ZZZZZZ", side="a")
        assert exc.value.status_code == 404


class TestStartGate:
    def test_cannot_start_until_both_sides_full(self, db_session):
        """PRD rule C: "兩隊都滿額開房的人才能按開始"."""
        host = _student_with_grade(db_session, grade=4)
        session = svc.create_session(db_session, host, team_size=3, side="a")
        with pytest.raises(HTTPException) as exc:
            svc.control(db_session, session, host, action="start")
        assert exc.value.status_code == 409

    def test_only_host_can_start(self, db_session):
        host = _student_with_grade(db_session, grade=4)
        session = svc.create_session(db_session, host, team_size=2, side="a")
        others = [make_student(db_session, name=f"s{i}") for i in range(3)]
        db_session.commit()
        svc.join_session(db_session, others[0], session.code, side="a")
        svc.join_session(db_session, others[1], session.code, side="b")
        svc.join_session(db_session, others[2], session.code, side="b")

        with pytest.raises(HTTPException) as exc:
            svc.control(db_session, session, others[0], action="start")
        assert exc.value.status_code == 403

    def test_starts_once_both_sides_full(self, db_session):
        host = _student_with_grade(db_session, grade=4)
        session = svc.create_session(db_session, host, team_size=2, side="a")
        others = [make_student(db_session, name=f"s{i}") for i in range(3)]
        db_session.commit()
        svc.join_session(db_session, others[0], session.code, side="a")
        svc.join_session(db_session, others[1], session.code, side="b")
        svc.join_session(db_session, others[2], session.code, side="b")

        started = svc.control(db_session, session, host, action="start")
        assert started.status == "playing"
        assert started.settings["total_turns"] == session.settings["turns_per_player"] * 2
