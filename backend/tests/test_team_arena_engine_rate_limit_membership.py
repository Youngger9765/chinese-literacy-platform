"""TDD for team_arena.engine.is_authenticated_session_member — the
membership check GlobalRateLimitMiddleware calls to exempt /state and
/answer polling from the per-IP limit (PRD §7 "限流" row). Mirrors
test_live_quiz_engine.py's coverage of is_authenticated_member_by_code,
scoped to this module's own function.
"""
from __future__ import annotations

import pytest

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


@pytest.fixture()
def session_with_member(db_session):
    school = make_school(db_session)
    teacher = make_teacher(db_session)
    room = make_classroom(db_session, school, teacher, feature_settings={"team_arena": True})
    db_session.commit()
    student = make_student(db_session)
    enroll_student(db_session, room, student)
    db_session.commit()
    session = svc.create_session(
        db_session, teacher, classroom_id=room.id, scope_type="grade_pool", scope_ref="4",
    )
    svc.join_session(db_session, student, session.code)
    return session, teacher, student


class TestIsAuthenticatedSessionMember:
    def test_teacher_is_a_member(self, db_session, session_with_member):
        session, teacher, _student = session_with_member
        assert svc.is_authenticated_session_member(db_session, session.code, teacher.id) is True

    def test_joined_student_is_a_member(self, db_session, session_with_member):
        session, _teacher, student = session_with_member
        assert svc.is_authenticated_session_member(db_session, session.code, student.id) is True

    def test_stranger_is_not_a_member(self, db_session, session_with_member):
        session, _teacher, _student = session_with_member
        stranger = make_student(db_session, name="路人")
        db_session.commit()
        assert svc.is_authenticated_session_member(db_session, session.code, stranger.id) is False

    def test_unknown_code_is_not_a_member(self, db_session):
        assert svc.is_authenticated_session_member(db_session, "ZZZZZZ", 999_999) is False

    def test_lowercase_code_still_matches(self, db_session, session_with_member):
        """Rate-limit middleware sees the raw URL path segment, which could
        be lowercase even though stored codes are uppercase (same .upper()
        normalization get_session_by_code already applies)."""
        session, teacher, _student = session_with_member
        assert svc.is_authenticated_session_member(db_session, session.code.lower(), teacher.id) is True

    def test_reused_code_resolves_to_the_same_latest_session_the_route_would(self, db_session):
        """Automated security review (post-push, #3632): this must resolve
        to the SAME session `_get_session_by_code` (what the actual route
        uses) would pick — the newest row with that code — not aggregate
        membership across EVERY historical session that ever held it. A
        member of an OLD, already-ended session must not be treated as a
        member of a NEW session that later reused the exact same code."""
        school = make_school(db_session)
        teacher = make_teacher(db_session)
        room = make_classroom(db_session, school, teacher, feature_settings={"team_arena": True})
        db_session.commit()
        old_member = make_student(db_session, name="舊場次的學生")
        new_member = make_student(db_session, name="新場次的學生")
        db_session.commit()

        from app.models.team_arena import TeamArenaSession

        old_session = TeamArenaSession(
            classroom_id=room.id, teacher_id=teacher.id, code="REUSED",
            status="ended", scoreboard={"roster": [old_member.id]},
        )
        db_session.add(old_session)
        db_session.commit()

        new_session = TeamArenaSession(
            classroom_id=room.id, teacher_id=teacher.id, code="REUSED",
            status="lobby", scoreboard={"roster": [new_member.id]},
        )
        db_session.add(new_session)
        db_session.commit()

        resolved = svc.get_session_by_code(db_session, "REUSED")
        assert resolved.id == new_session.id, "sanity: the route itself must resolve to the NEWEST row"

        assert svc.is_authenticated_session_member(db_session, "REUSED", new_member.id) is True
        assert svc.is_authenticated_session_member(db_session, "REUSED", old_member.id) is False
