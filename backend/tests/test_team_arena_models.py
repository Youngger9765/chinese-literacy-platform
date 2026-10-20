"""TDD for app.models.team_arena v2 — PRD §0 v2 改版,
docs/prd/2026-10-18-team-arena-prd.md.

Same SQLite-only testing precedent every model test in this repo uses
(conftest.py patches JSONB -> JSON). v2's ONE real schema change
(`classroom_id` nullable) is itself exercised here; everything else is the
same table shape v1 shipped, reinterpreted at the application layer (see
models/team_arena.py's own docstring).
"""
from __future__ import annotations

import pytest
from sqlalchemy.exc import IntegrityError

from app.models.team_arena import TeamArenaAnswer, TeamArenaMember, TeamArenaSession
from league_factories import make_student, make_teacher


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


class TestTeamArenaSessionShape:
    def test_classroom_id_is_nullable(self, db_session):
        """PRD §0 v2 "資料表變更": a v2 room belongs to no classroom —
        this is the one real schema change (migration 988d8bc90428)."""
        host = make_student(db_session)
        db_session.commit()
        session = TeamArenaSession(classroom_id=None, teacher_id=host.id, code="AB12CD", status="lobby")
        db_session.add(session)
        db_session.commit()
        db_session.refresh(session)

        assert session.classroom_id is None
        assert session.teacher_id == host.id  # v2: stores the HOST's id
        assert session.status == "lobby"
        assert session.settings == {}
        assert session.scoreboard == {}
        assert session.turn_no == 0
        assert session.state_version == 0

    def test_invalid_status_rejected(self, db_session):
        host = make_student(db_session)
        db_session.commit()
        session = TeamArenaSession(classroom_id=None, teacher_id=host.id, code="AB12CD", status="not-a-status")
        db_session.add(session)
        with pytest.raises(IntegrityError):
            db_session.commit()


class TestTeamArenaMemberShape:
    def _session(self, db_session) -> TeamArenaSession:
        host = make_student(db_session)
        db_session.commit()
        session = TeamArenaSession(classroom_id=None, teacher_id=host.id, code="Q1W2E3")
        db_session.add(session)
        db_session.commit()
        return session

    def test_create_with_fixed_lane_value(self, db_session):
        """v2: `lane` is unused, every row writes the fixed value
        "support" (engine._FIXED_LANE) — this test locks that the existing
        CHECK constraint still accepts it."""
        session = self._session(db_session)
        student = make_student(db_session)
        db_session.commit()

        member = TeamArenaMember(
            session_id=session.id, student_id=student.id, match_no=0, side=0,
            lane="support", rotation_order=0,
        )
        db_session.add(member)
        db_session.commit()
        db_session.refresh(member)

        assert member.grade_pool_override is False
        assert member.question_queue == {}
        assert member.last_seen_at is None

    def test_invalid_lane_rejected(self, db_session):
        session = self._session(db_session)
        student = make_student(db_session)
        db_session.commit()

        member = TeamArenaMember(
            session_id=session.id, student_id=student.id, match_no=0, side=0,
            lane="top-lane", rotation_order=0,
        )
        db_session.add(member)
        with pytest.raises(IntegrityError):
            db_session.commit()

    def test_invalid_side_rejected(self, db_session):
        session = self._session(db_session)
        student = make_student(db_session)
        db_session.commit()

        member = TeamArenaMember(
            session_id=session.id, student_id=student.id, match_no=0, side=2,
            lane="support", rotation_order=0,
        )
        db_session.add(member)
        with pytest.raises(IntegrityError):
            db_session.commit()

    def test_same_student_twice_in_same_session_rejected(self, db_session):
        """PRD §9.1 (unchanged by v2): 唯一 (session_id, student_id)."""
        session = self._session(db_session)
        student = make_student(db_session)
        db_session.commit()

        db_session.add(TeamArenaMember(
            session_id=session.id, student_id=student.id, match_no=0, side=0,
            lane="support", rotation_order=0,
        ))
        db_session.commit()

        db_session.add(TeamArenaMember(
            session_id=session.id, student_id=student.id, match_no=0, side=1,
            lane="support", rotation_order=0,
        ))
        with pytest.raises(IntegrityError):
            db_session.commit()

    def test_question_queue_can_hold_queue_and_weapons_used_dict(self, db_session):
        """v2 repurposes this one JSON column — PRD §0: "武器使用次數存在
        既有的 JSON 欄位，不加欄位"."""
        session = self._session(db_session)
        student = make_student(db_session)
        db_session.commit()

        member = TeamArenaMember(
            session_id=session.id, student_id=student.id, match_no=0, side=0,
            lane="support", rotation_order=0,
            question_queue={
                "queue": [{"round_index": 0, "round_type": "choice", "payload": {"stem": "x"}}],
                "weapons_used": {"call_teammate": False, "eliminate": True, "hint": False},
            },
        )
        db_session.add(member)
        db_session.commit()
        db_session.refresh(member)

        assert member.question_queue["weapons_used"]["eliminate"] is True
        assert len(member.question_queue["queue"]) == 1


class TestTeamArenaAnswerShape:
    """v2: role="assist" is now a teammate's 呼叫隊友 suggestion, never a
    scored answer — the column SHAPE is unchanged (still just a string
    choice + a bool correct), only the meaning differs (see
    models/team_arena.py module docstring)."""

    def _session(self, db_session) -> TeamArenaSession:
        host = make_student(db_session)
        db_session.commit()
        session = TeamArenaSession(classroom_id=None, teacher_id=host.id, code="Q1W2E3")
        db_session.add(session)
        db_session.commit()
        return session

    def test_same_member_same_turn_twice_rejected(self, db_session):
        session = self._session(db_session)
        student = make_student(db_session)
        db_session.commit()
        member = TeamArenaMember(
            session_id=session.id, student_id=student.id, match_no=0, side=0,
            lane="support", rotation_order=0,
        )
        db_session.add(member)
        db_session.commit()

        db_session.add(TeamArenaAnswer(
            session_id=session.id, member_id=member.id, turn_no=0, role="active",
            choice="A", correct=True,
        ))
        db_session.commit()

        db_session.add(TeamArenaAnswer(
            session_id=session.id, member_id=member.id, turn_no=0, role="assist",
            choice="B", correct=False,
        ))
        with pytest.raises(IntegrityError):
            db_session.commit()

    def test_invalid_role_rejected(self, db_session):
        session = self._session(db_session)
        student = make_student(db_session)
        db_session.commit()
        member = TeamArenaMember(
            session_id=session.id, student_id=student.id, match_no=0, side=0,
            lane="support", rotation_order=0,
        )
        db_session.add(member)
        db_session.commit()

        db_session.add(TeamArenaAnswer(
            session_id=session.id, member_id=member.id, turn_no=0, role="observer",
            choice="A", correct=True,
        ))
        with pytest.raises(IntegrityError):
            db_session.commit()
