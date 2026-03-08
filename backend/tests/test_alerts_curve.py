"""
Tests for #86 (classroom alerts) and #93 (student learning curve) endpoints.

Coverage:
- Each alert type detection (inactive, low_performance, declining)
- No alert when student is active and performing well
- Priority: inactive overrides low_performance check
- Learning curve ordering (ascending by date)
- Learning curve only includes scored+completed sessions
- Rolling average calculation verified via ordering
- Empty data returns empty results
- 403 for unauthorized teacher access to learning curve
"""
import sys
import os

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import pytest
from datetime import datetime, timedelta, timezone
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, event
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.main import app
from app.database import get_db
from app.models import Base
from app.models.user import User, Role, UserRole
from app.models.school import School, Classroom, ClassroomStudent
from app.models.session import LearningSession
from app.auth.dependencies import get_current_user


# ── In-memory SQLite test DB ──────────────────────────────────────────────────

engine = create_engine(
    "sqlite://",
    connect_args={"check_same_thread": False},
    poolclass=StaticPool,
)


@event.listens_for(engine, "connect")
def _set_sqlite_pragma(dbapi_connection, connection_record):
    cursor = dbapi_connection.cursor()
    cursor.execute("PRAGMA foreign_keys=ON")
    cursor.close()


TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

SEED_ROLES = [
    {"name": "system_admin", "display_name": "System Admin", "scope_level": "platform"},
    {"name": "teacher", "display_name": "Teacher", "scope_level": "school"},
    {"name": "student", "display_name": "Student", "scope_level": "school"},
]


def _override_get_db():
    db = TestingSessionLocal()
    try:
        yield db
    finally:
        db.close()


# ── Module-level fixtures ─────────────────────────────────────────────────────


@pytest.fixture(scope="module", autouse=True)
def setup_db():
    Base.metadata.create_all(bind=engine)
    session = TestingSessionLocal()
    for role_data in SEED_ROLES:
        session.add(Role(**role_data))
    session.commit()
    session.close()

    app.dependency_overrides[get_db] = _override_get_db
    yield
    app.dependency_overrides.pop(get_db, None)
    Base.metadata.drop_all(bind=engine)


@pytest.fixture(scope="module")
def client():
    with TestClient(app) as c:
        yield c


# ── Helper functions ──────────────────────────────────────────────────────────


def _utc_now() -> datetime:
    return datetime.now(timezone.utc)


def _days_ago(n: int) -> datetime:
    return _utc_now() - timedelta(days=n)


def _new_db():
    return TestingSessionLocal()


def _make_user(db, email: str, name: str) -> User:
    user = User(
        email=email,
        name=name,
        password_hash="hashed",
        is_active=True,
    )
    db.add(user)
    db.flush()
    return user


def _make_school(db, name: str = "Test School") -> School:
    school = School(name=name)
    db.add(school)
    db.flush()
    return school


def _make_classroom(db, teacher_id: int, school_id: int, name: str = "班級A") -> Classroom:
    classroom = Classroom(
        name=name,
        teacher_id=teacher_id,
        school_id=school_id,
        grade=5,
        is_active=True,
    )
    db.add(classroom)
    db.flush()
    return classroom


def _enroll(db, classroom_id: int, student_id: int):
    db.add(ClassroomStudent(classroom_id=classroom_id, student_id=student_id))
    db.flush()


def _make_session(
    db,
    student_id: int,
    classroom_id: int,
    score: float | None,
    started_at: datetime,
    status: str = "completed",
) -> LearningSession:
    sess = LearningSession(
        student_id=student_id,
        classroom_id=classroom_id,
        story_slug="1",
        status=status,
        overall_score=score,
        started_at=started_at,
        completed_at=started_at + timedelta(minutes=10) if status == "completed" else None,
    )
    db.add(sess)
    db.flush()
    return sess


def _get_as(client, url: str, user: User):
    """Make a GET request with the given user injected as current_user."""
    app.dependency_overrides[get_current_user] = lambda: user
    try:
        return client.get(url)
    finally:
        del app.dependency_overrides[get_current_user]


# ── Tests: Alerts ─────────────────────────────────────────────────────────────


def test_inactive_alert_no_sessions(client):
    """Student with no sessions should trigger inactive alert."""
    db = _new_db()
    try:
        teacher = _make_user(db, "t_inactive1@test.com", "Teacher")
        school = _make_school(db)
        classroom = _make_classroom(db, teacher.id, school.id)
        student = _make_user(db, "s_inactive1@test.com", "Student")
        _enroll(db, classroom.id, student.id)
        db.commit()

        resp = _get_as(client, f"/api/teacher/classrooms/{classroom.id}/alerts", teacher)
        assert resp.status_code == 200
        alerts = resp.json()
        assert len(alerts) == 1
        assert alerts[0]["alert_type"] == "inactive"
        assert alerts[0]["student_id"] == student.id
        assert alerts[0]["last_session_date"] is None
    finally:
        db.close()


def test_inactive_alert_old_session(client):
    """Student with last session 20 days ago should trigger inactive alert."""
    db = _new_db()
    try:
        teacher = _make_user(db, "t_inactive2@test.com", "Teacher2")
        school = _make_school(db)
        classroom = _make_classroom(db, teacher.id, school.id)
        student = _make_user(db, "s_inactive2@test.com", "Student2")
        _enroll(db, classroom.id, student.id)
        _make_session(db, student.id, classroom.id, score=80.0, started_at=_days_ago(20))
        db.commit()

        resp = _get_as(client, f"/api/teacher/classrooms/{classroom.id}/alerts", teacher)
        assert resp.status_code == 200
        alerts = resp.json()
        assert len(alerts) == 1
        assert alerts[0]["alert_type"] == "inactive"
        assert "20" in alerts[0]["detail"]
    finally:
        db.close()


def test_no_alert_active_good_scores(client):
    """Active student with good scores should not trigger any alert."""
    db = _new_db()
    try:
        teacher = _make_user(db, "t_good@test.com", "TeacherGood")
        school = _make_school(db)
        classroom = _make_classroom(db, teacher.id, school.id)
        student = _make_user(db, "s_good@test.com", "StudentGood")
        _enroll(db, classroom.id, student.id)
        _make_session(db, student.id, classroom.id, score=80.0, started_at=_days_ago(5))
        _make_session(db, student.id, classroom.id, score=85.0, started_at=_days_ago(1))
        db.commit()

        resp = _get_as(client, f"/api/teacher/classrooms/{classroom.id}/alerts", teacher)
        assert resp.status_code == 200
        assert resp.json() == []
    finally:
        db.close()


def test_low_performance_alert(client):
    """Student with average score below 50 should trigger low_performance alert."""
    db = _new_db()
    try:
        teacher = _make_user(db, "t_lowperf@test.com", "TeacherLP")
        school = _make_school(db)
        classroom = _make_classroom(db, teacher.id, school.id)
        student = _make_user(db, "s_lowperf@test.com", "StudentLP")
        _enroll(db, classroom.id, student.id)
        _make_session(db, student.id, classroom.id, score=30.0, started_at=_days_ago(5))
        _make_session(db, student.id, classroom.id, score=40.0, started_at=_days_ago(2))
        db.commit()

        resp = _get_as(client, f"/api/teacher/classrooms/{classroom.id}/alerts", teacher)
        assert resp.status_code == 200
        alerts = resp.json()
        assert len(alerts) == 1
        assert alerts[0]["alert_type"] == "low_performance"
        # avg of 30+40 = 35
        assert "35" in alerts[0]["detail"]
    finally:
        db.close()


def test_declining_alert(client):
    """Three strictly decreasing scores in last 3 sessions triggers declining alert."""
    db = _new_db()
    try:
        teacher = _make_user(db, "t_decline@test.com", "TeacherDecline")
        school = _make_school(db)
        classroom = _make_classroom(db, teacher.id, school.id)
        student = _make_user(db, "s_decline@test.com", "StudentDecline")
        _enroll(db, classroom.id, student.id)
        # Sessions in ascending time order; last 3 scores decline: 80→70→60
        _make_session(db, student.id, classroom.id, score=90.0, started_at=_days_ago(10))
        _make_session(db, student.id, classroom.id, score=80.0, started_at=_days_ago(7))
        _make_session(db, student.id, classroom.id, score=70.0, started_at=_days_ago(4))
        _make_session(db, student.id, classroom.id, score=60.0, started_at=_days_ago(1))
        db.commit()

        resp = _get_as(client, f"/api/teacher/classrooms/{classroom.id}/alerts", teacher)
        assert resp.status_code == 200
        alerts = resp.json()
        assert len(alerts) == 1
        assert alerts[0]["alert_type"] == "declining"
        assert "80" in alerts[0]["detail"]
        assert "70" in alerts[0]["detail"]
        assert "60" in alerts[0]["detail"]
    finally:
        db.close()


def test_inactive_takes_priority_over_low_performance(client):
    """Inactive flag is returned; low_performance is skipped for inactive students."""
    db = _new_db()
    try:
        teacher = _make_user(db, "t_pri@test.com", "TeacherPri")
        school = _make_school(db)
        classroom = _make_classroom(db, teacher.id, school.id)
        student = _make_user(db, "s_pri@test.com", "StudentPri")
        _enroll(db, classroom.id, student.id)
        # Old session with low score — qualifies for both inactive and low_performance
        _make_session(db, student.id, classroom.id, score=20.0, started_at=_days_ago(30))
        db.commit()

        resp = _get_as(client, f"/api/teacher/classrooms/{classroom.id}/alerts", teacher)
        alerts = resp.json()
        assert len(alerts) == 1
        assert alerts[0]["alert_type"] == "inactive"
    finally:
        db.close()


def test_no_declining_alert_with_less_than_3_sessions(client):
    """Fewer than 3 scored sessions should not trigger declining alert."""
    db = _new_db()
    try:
        teacher = _make_user(db, "t_2sess@test.com", "Teacher2Sess")
        school = _make_school(db)
        classroom = _make_classroom(db, teacher.id, school.id)
        student = _make_user(db, "s_2sess@test.com", "Student2Sess")
        _enroll(db, classroom.id, student.id)
        _make_session(db, student.id, classroom.id, score=80.0, started_at=_days_ago(5))
        _make_session(db, student.id, classroom.id, score=70.0, started_at=_days_ago(1))
        db.commit()

        resp = _get_as(client, f"/api/teacher/classrooms/{classroom.id}/alerts", teacher)
        assert resp.json() == []
    finally:
        db.close()


def test_empty_classroom_returns_no_alerts(client):
    """Classroom with no students should return empty alerts list."""
    db = _new_db()
    try:
        teacher = _make_user(db, "t_empty@test.com", "TeacherEmpty")
        school = _make_school(db)
        classroom = _make_classroom(db, teacher.id, school.id)
        db.commit()

        resp = _get_as(client, f"/api/teacher/classrooms/{classroom.id}/alerts", teacher)
        assert resp.status_code == 200
        assert resp.json() == []
    finally:
        db.close()


# ── Tests: Learning Curve ─────────────────────────────────────────────────────


def test_learning_curve_ordered_ascending(client):
    """Learning curve data should be ordered oldest-first."""
    db = _new_db()
    try:
        teacher = _make_user(db, "t_curve1@test.com", "TeacherCurve1")
        school = _make_school(db)
        classroom = _make_classroom(db, teacher.id, school.id)
        student = _make_user(db, "s_curve1@test.com", "StudentCurve1")
        _enroll(db, classroom.id, student.id)
        # Insert in reverse chronological order
        _make_session(db, student.id, classroom.id, score=90.0, started_at=_days_ago(1))
        _make_session(db, student.id, classroom.id, score=70.0, started_at=_days_ago(10))
        _make_session(db, student.id, classroom.id, score=80.0, started_at=_days_ago(5))
        db.commit()

        resp = _get_as(client, f"/api/teacher/students/{student.id}/learning-curve", teacher)
        assert resp.status_code == 200
        data = resp.json()["data"]
        assert len(data) == 3
        # Scores should be ascending by date: 70 → 80 → 90
        assert [pt["score"] for pt in data] == [70.0, 80.0, 90.0]
    finally:
        db.close()


def test_learning_curve_empty_when_no_completed_sessions(client):
    """No completed sessions → empty data array."""
    db = _new_db()
    try:
        teacher = _make_user(db, "t_nocurve@test.com", "TeacherNoCurve")
        school = _make_school(db)
        classroom = _make_classroom(db, teacher.id, school.id)
        student = _make_user(db, "s_nocurve@test.com", "StudentNoCurve")
        _enroll(db, classroom.id, student.id)
        _make_session(
            db, student.id, classroom.id, score=None, started_at=_days_ago(2), status="in_progress"
        )
        db.commit()

        resp = _get_as(client, f"/api/teacher/students/{student.id}/learning-curve", teacher)
        assert resp.status_code == 200
        assert resp.json()["data"] == []
    finally:
        db.close()


def test_learning_curve_only_includes_scored_sessions(client):
    """Sessions without a score should be excluded from the curve."""
    db = _new_db()
    try:
        teacher = _make_user(db, "t_scored@test.com", "TeacherScored")
        school = _make_school(db)
        classroom = _make_classroom(db, teacher.id, school.id)
        student = _make_user(db, "s_scored@test.com", "StudentScored")
        _enroll(db, classroom.id, student.id)

        _make_session(db, student.id, classroom.id, score=75.0, started_at=_days_ago(5))
        # Completed but no score
        sess_no_score = LearningSession(
            student_id=student.id,
            classroom_id=classroom.id,
            story_slug="2",
            status="completed",
            overall_score=None,
            started_at=_days_ago(3),
            completed_at=_days_ago(3) + timedelta(minutes=10),
        )
        db.add(sess_no_score)
        _make_session(db, student.id, classroom.id, score=85.0, started_at=_days_ago(1))
        db.commit()

        resp = _get_as(client, f"/api/teacher/students/{student.id}/learning-curve", teacher)
        data = resp.json()["data"]
        assert len(data) == 2
        assert [pt["score"] for pt in data] == [75.0, 85.0]
    finally:
        db.close()


def test_learning_curve_rolling_average_ordering(client):
    """Backend returns 5 ascending sessions; rolling avg logic can be verified client-side."""
    db = _new_db()
    try:
        teacher = _make_user(db, "t_rolling@test.com", "TeacherRolling")
        school = _make_school(db)
        classroom = _make_classroom(db, teacher.id, school.id)
        student = _make_user(db, "s_rolling@test.com", "StudentRolling")
        _enroll(db, classroom.id, student.id)

        scores = [60.0, 70.0, 80.0, 90.0, 100.0]
        for i, score in enumerate(scores):
            _make_session(
                db,
                student.id,
                classroom.id,
                score=score,
                started_at=_days_ago(len(scores) - i),
            )
        db.commit()

        resp = _get_as(client, f"/api/teacher/students/{student.id}/learning-curve", teacher)
        data = resp.json()["data"]
        assert len(data) == 5

        returned_scores = [pt["score"] for pt in data]
        assert returned_scores == [60.0, 70.0, 80.0, 90.0, 100.0]

        # Verify rolling average (window=5) matches expected values
        expected_rolling = [60.0, 65.0, 70.0, 75.0, 80.0]
        for i, expected in enumerate(expected_rolling):
            window = returned_scores[max(0, i - 4): i + 1]
            computed = sum(window) / len(window)
            assert abs(computed - expected) < 0.01, f"Rolling avg at idx {i}: got {computed}, expected {expected}"
    finally:
        db.close()


def test_learning_curve_forbidden_for_non_owner(client):
    """Teacher who does not own the classroom should get 403."""
    db = _new_db()
    try:
        teacher1 = _make_user(db, "t_owner@test.com", "TeacherOwner")
        teacher2 = _make_user(db, "t_other@test.com", "TeacherOther")
        school = _make_school(db)
        classroom = _make_classroom(db, teacher1.id, school.id)
        student = _make_user(db, "s_403@test.com", "Student403")
        _enroll(db, classroom.id, student.id)
        _make_session(db, student.id, classroom.id, score=75.0, started_at=_days_ago(2))
        db.commit()

        # teacher2 should not access teacher1's student
        resp = _get_as(client, f"/api/teacher/students/{student.id}/learning-curve", teacher2)
        assert resp.status_code == 403
    finally:
        db.close()
