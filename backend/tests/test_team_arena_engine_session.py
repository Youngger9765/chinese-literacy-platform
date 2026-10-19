"""TDD for team_arena.engine — session create/join (PRD §10, §13 AC1)."""
from __future__ import annotations

import pytest
from fastapi import HTTPException

from app.services.team_arena import engine as svc
from league_factories import (
    enroll_student,
    make_classroom,
    make_school,
    make_student,
    make_teacher,
)


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
def school(db_session):
    return make_school(db_session)


@pytest.fixture()
def teacher(db_session):
    return make_teacher(db_session)


@pytest.fixture()
def classroom_enabled(db_session, school, teacher):
    room = make_classroom(db_session, school, teacher, feature_settings={"team_arena": True})
    db_session.commit()
    return room


@pytest.fixture()
def classroom_disabled(db_session, school, teacher):
    room = make_classroom(db_session, school, teacher)
    db_session.commit()
    return room


class TestCreateSessionFeatureGate:
    """PRD §13 AC1: 班級沒打開 team_arena -> POST /sessions 回 403."""

    def test_disabled_classroom_rejected(self, db_session, classroom_disabled, teacher):
        with pytest.raises(HTTPException) as exc:
            svc.create_session(
                db_session, teacher, classroom_id=classroom_disabled.id,
                scope_type="grade_pool", scope_ref="4",
            )
        assert exc.value.status_code == 403

    def test_enabled_classroom_allowed(self, db_session, classroom_enabled, teacher):
        session = svc.create_session(
            db_session, teacher, classroom_id=classroom_enabled.id,
            scope_type="grade_pool", scope_ref="4",
        )
        assert session.status == "lobby"
        assert session.code and len(session.code) == 6


class TestCreateSessionOwnership:
    def test_non_owning_teacher_rejected(self, db_session, classroom_enabled, school):
        other_teacher = make_teacher(db_session, name="別班老師")
        db_session.commit()
        with pytest.raises(HTTPException) as exc:
            svc.create_session(
                db_session, other_teacher, classroom_id=classroom_enabled.id,
                scope_type="grade_pool", scope_ref="4",
            )
        assert exc.value.status_code == 403

    def test_unknown_classroom_404(self, db_session, teacher):
        with pytest.raises(HTTPException) as exc:
            svc.create_session(
                db_session, teacher, classroom_id=999_999,
                scope_type="grade_pool", scope_ref="4",
            )
        assert exc.value.status_code == 404


class TestCreateSessionSettingsDefaults:
    def test_defaults_applied(self, db_session, classroom_enabled, teacher):
        session = svc.create_session(
            db_session, teacher, classroom_id=classroom_enabled.id,
            scope_type="grade_pool", scope_ref="4",
        )
        assert session.settings["turns_per_player"] == 2
        assert session.settings["answer_seconds"] == 30
        assert session.settings["reading_speed"] == "standard"

    def test_custom_settings_persisted(self, db_session, classroom_enabled, teacher):
        session = svc.create_session(
            db_session, teacher, classroom_id=classroom_enabled.id,
            scope_type="grade_pool", scope_ref="4",
            turns_per_player=3, answer_seconds=45, reading_speed="slow",
            story_pack_key="tang-dynasty",
        )
        assert session.settings["turns_per_player"] == 3
        assert session.settings["answer_seconds"] == 45
        assert session.settings["reading_speed"] == "slow"
        assert session.settings["story_pack_key"] == "tang-dynasty"

    def test_invalid_scope_rejected(self, db_session, classroom_enabled, teacher):
        with pytest.raises(HTTPException):
            svc.create_session(
                db_session, teacher, classroom_id=classroom_enabled.id,
                scope_type="not-a-scope", scope_ref="4",
            )


class TestJoinSession:
    def test_classroom_member_can_join(self, db_session, classroom_enabled, teacher):
        student = make_student(db_session)
        enroll_student(db_session, classroom_enabled, student)
        db_session.commit()

        session = svc.create_session(
            db_session, teacher, classroom_id=classroom_enabled.id,
            scope_type="grade_pool", scope_ref="4",
        )
        result = svc.join_session(db_session, student, session.code)
        assert result.id == session.id
        assert student.id in result.scoreboard.get("roster", [])

    def test_non_member_rejected(self, db_session, classroom_enabled, teacher):
        outsider = make_student(db_session, name="外班學生")
        db_session.commit()
        session = svc.create_session(
            db_session, teacher, classroom_id=classroom_enabled.id,
            scope_type="grade_pool", scope_ref="4",
        )
        with pytest.raises(HTTPException) as exc:
            svc.join_session(db_session, outsider, session.code)
        assert exc.value.status_code == 403

    def test_unknown_code_404(self, db_session):
        student = make_student(db_session)
        db_session.commit()
        with pytest.raises(HTTPException) as exc:
            svc.join_session(db_session, student, "ZZZZZZ")
        assert exc.value.status_code == 404

    def test_double_join_is_idempotent(self, db_session, classroom_enabled, teacher):
        student = make_student(db_session)
        enroll_student(db_session, classroom_enabled, student)
        db_session.commit()
        session = svc.create_session(
            db_session, teacher, classroom_id=classroom_enabled.id,
            scope_type="grade_pool", scope_ref="4",
        )
        svc.join_session(db_session, student, session.code)
        svc.join_session(db_session, student, session.code)
        result = svc.join_session(db_session, student, session.code)
        assert result.scoreboard["roster"].count(student.id) == 1

    def test_join_after_started_rejected(self, db_session, classroom_enabled, teacher):
        students = []
        for _ in range(4):
            s = make_student(db_session)
            enroll_student(db_session, classroom_enabled, s)
            students.append(s)
        db_session.commit()
        session = svc.create_session(
            db_session, teacher, classroom_id=classroom_enabled.id,
            scope_type="grade_pool", scope_ref="4",
        )
        for s in students:
            svc.join_session(db_session, s, session.code)
        svc.assign_teams(db_session, session, teacher, action="auto")
        svc.control(db_session, session, teacher, action="start")

        late_student = make_student(db_session)
        enroll_student(db_session, classroom_enabled, late_student)
        db_session.commit()
        with pytest.raises(HTTPException) as exc:
            svc.join_session(db_session, late_student, session.code)
        assert exc.value.status_code == 409
