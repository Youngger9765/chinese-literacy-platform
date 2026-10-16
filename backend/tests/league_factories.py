"""Shared ORM factory helpers for league tests (test_league_*.py).

Not a test module itself (doesn't match pytest's test_*.py / *_test.py
collection patterns) — factored-out boilerplate for building users /
schools / classrooms / enrollments / lesson completions.
"""
from __future__ import annotations

from datetime import datetime

from app.models.organization import Organization
from app.models.school import Classroom, ClassroomStudent, ClassroomTeacher, School
from app.models.session import LearningSession
from app.models.user import User

_counter = {"n": 10_000}


def _next_id() -> int:
    _counter["n"] += 1
    return _counter["n"]


def make_org(db, *, name: str | None = None) -> Organization:
    org = Organization(name=name or f"機構-{_next_id()}")
    db.add(org)
    db.flush()
    return org


def make_teacher(db, *, name: str = "老師") -> User:
    uid = _next_id()
    user = User(id=uid, email=f"teacher{uid}@test.invalid", password_hash="x", name=name)
    db.add(user)
    db.flush()
    return user


def make_student(db, *, name: str = "學生") -> User:
    uid = _next_id()
    user = User(id=uid, email=f"student{uid}@student.lingoleap.local", password_hash="x", name=name)
    db.add(user)
    db.flush()
    return user


def make_school(db, *, name: str = "測試國小", org: Organization | None = None) -> School:
    school = School(id=_next_id(), name=name, organization_id=org.id if org else None)
    db.add(school)
    db.flush()
    return school


def make_classroom(
    db,
    school: School,
    teacher: User,
    *,
    name: str = "測試班級",
    grade: int | None = 4,
    feature_settings: dict | None = None,
) -> Classroom:
    """``feature_settings``: PK mode's per-classroom toggles (issue #3586,
    e.g. {"pk_human": True}) — None leaves the column at its DB default
    ({} -> every feature defaults OFF per
    services/pk/classroom_features.FEATURE_DEFAULTS), explicitly passed
    gives tests control without every OTHER caller of this shared factory
    needing to know PK mode exists."""
    classroom = Classroom(
        id=_next_id(),
        school_id=school.id,
        teacher_id=teacher.id,
        name=name,
        grade=grade,
        **({"feature_settings": feature_settings} if feature_settings is not None else {}),
    )
    db.add(classroom)
    db.flush()
    db.add(ClassroomTeacher(classroom_id=classroom.id, teacher_id=teacher.id, role="primary"))
    db.flush()
    return classroom


def add_co_teacher(db, classroom: Classroom, teacher: User) -> None:
    db.add(ClassroomTeacher(classroom_id=classroom.id, teacher_id=teacher.id, role="assistant"))
    db.flush()


def enroll_student(db, classroom: Classroom, student: User) -> ClassroomStudent:
    cs = ClassroomStudent(classroom_id=classroom.id, student_id=student.id)
    db.add(cs)
    db.flush()
    return cs


def complete_lesson(
    db,
    student: User,
    story_slug: str,
    *,
    started_at: datetime,
    completed_at: datetime,
    session_mode: str = "self_study",
    classroom_id: int | None = None,
) -> LearningSession:
    """Simulate a student completing one lesson (the `learning_sessions` row
    league_scoring.py reads directly)."""
    session = LearningSession(
        student_id=student.id,
        classroom_id=classroom_id,
        status="completed",
        session_mode=session_mode,
        story_slug=story_slug,
        started_at=started_at,
        completed_at=completed_at,
    )
    db.add(session)
    db.flush()
    return session
