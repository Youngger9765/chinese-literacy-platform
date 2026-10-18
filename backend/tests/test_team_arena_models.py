"""TDD for app.models.team_arena — PRD §9.1 (table shapes, uniqueness).

⚠️ These three tables have NO alembic migration (see models/team_arena.py
module docstring — Young has not approved creating them for real yet).
This test only ever exercises `Base.metadata.create_all()` against an
in-memory SQLite engine, same as every other model test in this repo
(conftest.py already patches JSONB -> JSON for exactly this reason) — it
proves the model SHAPE is sound, it does not and must not touch any real
database or alembic revision.
"""
from __future__ import annotations

import pytest
from sqlalchemy.exc import IntegrityError

from app.models.team_arena import TeamArenaAnswer, TeamArenaMember, TeamArenaSession
from league_factories import make_classroom, make_school, make_student, make_teacher


@pytest.fixture()
def db_session():
    from sqlalchemy import create_engine
    from sqlalchemy.orm import sessionmaker

    import app.models  # noqa: F401  (registers every model on Base.metadata)
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
def classroom(db_session):
    teacher = make_teacher(db_session)
    school = make_school(db_session)
    room = make_classroom(db_session, school, teacher)
    db_session.commit()
    return room, teacher


class TestTeamArenaSessionShape:
    def test_create_with_defaults(self, db_session, classroom):
        room, teacher = classroom
        session = TeamArenaSession(
            classroom_id=room.id, teacher_id=teacher.id, code="AB12CD", status="lobby"
        )
        db_session.add(session)
        db_session.commit()
        db_session.refresh(session)

        assert session.id is not None
        assert session.status == "lobby"
        assert session.settings == {}
        assert session.scoreboard == {}
        assert session.turn_no == 0
        assert session.state_version == 0
        assert session.created_at is not None
        assert session.ended_at is None

    def test_invalid_status_rejected(self, db_session, classroom):
        room, teacher = classroom
        session = TeamArenaSession(
            classroom_id=room.id, teacher_id=teacher.id, code="AB12CD", status="not-a-status"
        )
        db_session.add(session)
        with pytest.raises(IntegrityError):
            db_session.commit()


class TestTeamArenaMemberShape:
    def test_create_with_lane_and_rotation_order(self, db_session, classroom):
        room, teacher = classroom
        student = make_student(db_session)
        db_session.commit()
        session = TeamArenaSession(classroom_id=room.id, teacher_id=teacher.id, code="Q1W2E3")
        db_session.add(session)
        db_session.commit()

        member = TeamArenaMember(
            session_id=session.id,
            student_id=student.id,
            match_no=0,
            side=0,
            lane="zhuyin",
            rotation_order=0,
        )
        db_session.add(member)
        db_session.commit()
        db_session.refresh(member)

        assert member.grade_pool_override is False
        assert member.question_queue == []
        assert member.last_seen_at is None

    def test_invalid_lane_rejected(self, db_session, classroom):
        room, teacher = classroom
        student = make_student(db_session)
        db_session.commit()
        session = TeamArenaSession(classroom_id=room.id, teacher_id=teacher.id, code="Q1W2E3")
        db_session.add(session)
        db_session.commit()

        member = TeamArenaMember(
            session_id=session.id,
            student_id=student.id,
            match_no=0,
            side=0,
            lane="top-lane",
            rotation_order=0,
        )
        db_session.add(member)
        with pytest.raises(IntegrityError):
            db_session.commit()

    def test_invalid_side_rejected(self, db_session, classroom):
        room, teacher = classroom
        student = make_student(db_session)
        db_session.commit()
        session = TeamArenaSession(classroom_id=room.id, teacher_id=teacher.id, code="Q1W2E3")
        db_session.add(session)
        db_session.commit()

        member = TeamArenaMember(
            session_id=session.id,
            student_id=student.id,
            match_no=0,
            side=2,
            lane="zhuyin",
            rotation_order=0,
        )
        db_session.add(member)
        with pytest.raises(IntegrityError):
            db_session.commit()

    def test_same_student_twice_in_same_session_rejected(self, db_session, classroom):
        """PRD §9.1: 唯一 (session_id, student_id) — one seat per student
        per session."""
        room, teacher = classroom
        student = make_student(db_session)
        db_session.commit()
        session = TeamArenaSession(classroom_id=room.id, teacher_id=teacher.id, code="Q1W2E3")
        db_session.add(session)
        db_session.commit()

        db_session.add(
            TeamArenaMember(
                session_id=session.id, student_id=student.id, match_no=0, side=0,
                lane="zhuyin", rotation_order=0,
            )
        )
        db_session.commit()

        db_session.add(
            TeamArenaMember(
                session_id=session.id, student_id=student.id, match_no=0, side=1,
                lane="comprehension", rotation_order=1,
            )
        )
        with pytest.raises(IntegrityError):
            db_session.commit()


class TestTeamArenaAnswerShape:
    def _make_member(self, db_session, room, teacher, student):
        session = TeamArenaSession(classroom_id=room.id, teacher_id=teacher.id, code="Q1W2E3")
        db_session.add(session)
        db_session.commit()
        member = TeamArenaMember(
            session_id=session.id, student_id=student.id, match_no=0, side=0,
            lane="zhuyin", rotation_order=0,
        )
        db_session.add(member)
        db_session.commit()
        return session, member

    def test_create_active_answer(self, db_session, classroom):
        room, teacher = classroom
        student = make_student(db_session)
        db_session.commit()
        session, member = self._make_member(db_session, room, teacher, student)

        answer = TeamArenaAnswer(
            session_id=session.id, member_id=member.id, turn_no=0, role="active",
            choice="A", correct=True, elapsed_ms=1200, speed_bonus=15,
        )
        db_session.add(answer)
        db_session.commit()
        db_session.refresh(answer)
        assert answer.created_at is not None

    def test_invalid_role_rejected(self, db_session, classroom):
        room, teacher = classroom
        student = make_student(db_session)
        db_session.commit()
        session, member = self._make_member(db_session, room, teacher, student)

        answer = TeamArenaAnswer(
            session_id=session.id, member_id=member.id, turn_no=0, role="spectator",
            correct=False,
        )
        db_session.add(answer)
        with pytest.raises(IntegrityError):
            db_session.commit()

    def test_second_answer_same_turn_rejected(self, db_session, classroom):
        """PRD §9.1 唯一 (session_id, member_id, turn_no) — this IS §13
        AC4's "同回合第二次作答回 409" enforced at the DB layer."""
        room, teacher = classroom
        student = make_student(db_session)
        db_session.commit()
        session, member = self._make_member(db_session, room, teacher, student)

        db_session.add(
            TeamArenaAnswer(
                session_id=session.id, member_id=member.id, turn_no=0, role="active",
                choice="A", correct=True,
            )
        )
        db_session.commit()

        db_session.add(
            TeamArenaAnswer(
                session_id=session.id, member_id=member.id, turn_no=0, role="active",
                choice="B", correct=False,
            )
        )
        with pytest.raises(IntegrityError):
            db_session.commit()

    def test_same_member_different_turn_is_fine(self, db_session, classroom):
        room, teacher = classroom
        student = make_student(db_session)
        db_session.commit()
        session, member = self._make_member(db_session, room, teacher, student)

        db_session.add(
            TeamArenaAnswer(
                session_id=session.id, member_id=member.id, turn_no=0, role="active",
                correct=True,
            )
        )
        db_session.commit()
        db_session.add(
            TeamArenaAnswer(
                session_id=session.id, member_id=member.id, turn_no=1, role="active",
                correct=False,
            )
        )
        db_session.commit()  # must not raise
