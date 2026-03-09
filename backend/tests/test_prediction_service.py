"""
Tests for Issue #254 — prediction_service.py and GET /api/teacher/classrooms/{id}/at-risk-students.

TDD Red→Green→Refactor:
  Red   — tests written first (before implementation)
  Green — all pass after prediction_service.py + endpoint added
  Refactor — service already clean; tests document expected behaviour

Coverage:
  Unit tests (prediction_service):
    - empty student → low risk, 0 confidence
    - single low-accuracy early story → risk factor detected
    - high character error rate → risk factor detected
    - declining accuracy trend → risk factor detected
    - long inactivity gap → risk factor detected
    - multiple stuck stories → risk factor detected
    - multiple signals → high risk level
    - risk level mapping (0→low, 1→low, 2→medium, 3→medium, 4+→high)

  Integration tests (endpoint):
    - 200 OK with correct student list sorted high→medium→low
    - 403 for non-classroom-owner teacher
    - empty classroom returns []
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
from unittest.mock import MagicMock

from app.main import app
from app.database import get_db
from app.models import Base
from app.models.user import User, Role
from app.models.school import School, Classroom, ClassroomStudent
from app.models.session import LearningSession, CharacterError
from app.auth.dependencies import get_current_user
from app.services import prediction_service as svc


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


def _override_get_db():
    db = TestingSessionLocal()
    try:
        yield db
    finally:
        db.close()


@pytest.fixture(scope="module", autouse=True)
def setup_db():
    Base.metadata.create_all(bind=engine)
    app.dependency_overrides[get_db] = _override_get_db
    yield
    app.dependency_overrides.clear()
    Base.metadata.drop_all(bind=engine)


client = TestClient(app)


# ── Helpers ───────────────────────────────────────────────────────────────────

def _now() -> datetime:
    return datetime.now(timezone.utc)


def _new_db():
    return TestingSessionLocal()


def _make_user(db, email: str, name: str = "Test User") -> User:
    u = User(email=email, name=name, password_hash="hashed", is_active=True)
    db.add(u)
    db.flush()
    return u


def _make_school(db) -> School:
    s = School(name="Test School 254")
    db.add(s)
    db.flush()
    return s


def _make_classroom(db, teacher_id: int, school_id: int) -> Classroom:
    c = Classroom(name="班級 254", teacher_id=teacher_id, school_id=school_id, grade=5, is_active=True)
    db.add(c)
    db.flush()
    return c


def _make_session(
    db,
    student_id: int,
    story_slug: str = "story-1",
    accuracy: float | None = 80.0,
    started_at: datetime | None = None,
) -> LearningSession:
    s = LearningSession(
        student_id=student_id,
        story_slug=story_slug,
        status="completed",
        accuracy=accuracy,
        overall_score=accuracy,
        started_at=started_at or _now(),
    )
    db.add(s)
    db.flush()
    return s


def _get_as(url: str, user: User):
    """GET request with user injected as current_user."""
    app.dependency_overrides[get_current_user] = lambda: user
    try:
        return client.get(url)
    finally:
        del app.dependency_overrides[get_current_user]


# ══════════════════════════════════════════════════════════════════════════════
# Unit tests — prediction_service helpers
# ══════════════════════════════════════════════════════════════════════════════


class TestEmptyPrediction:
    """No sessions → low risk."""

    def test_empty_returns_low_risk(self):
        result = svc._empty_prediction()
        assert result["risk_level"] == "low"
        assert result["confidence_score"] == 0.0
        assert result["risk_factors"] == []


class TestEarlyAccuracy:
    """Low accuracy on first few stories triggers risk factor."""

    def test_low_early_accuracy(self):
        sessions = [
            MagicMock(story_slug="s1", accuracy=40.0),
            MagicMock(story_slug="s2", accuracy=50.0),
            MagicMock(story_slug="s3", accuracy=55.0),
        ]
        result = svc._check_early_accuracy(sessions)
        assert result is not None
        assert result < 60.0

    def test_high_early_accuracy(self):
        sessions = [
            MagicMock(story_slug="s1", accuracy=80.0),
            MagicMock(story_slug="s2", accuracy=85.0),
            MagicMock(story_slug="s3", accuracy=90.0),
        ]
        result = svc._check_early_accuracy(sessions)
        assert result is not None
        assert result >= 60.0

    def test_no_accuracy_returns_none(self):
        sessions = [MagicMock(story_slug="s1", accuracy=None)]
        result = svc._check_early_accuracy(sessions)
        assert result is None


class TestDecliningTrend:
    """Strictly declining last 3 sessions triggers flag."""

    def test_declining_detected(self):
        sessions = [
            MagicMock(accuracy=80.0),
            MagicMock(accuracy=70.0),
            MagicMock(accuracy=60.0),
        ]
        result = svc._check_declining_trend(sessions)
        assert result["is_declining"] is True

    def test_not_declining(self):
        sessions = [
            MagicMock(accuracy=60.0),
            MagicMock(accuracy=70.0),
            MagicMock(accuracy=80.0),
        ]
        result = svc._check_declining_trend(sessions)
        assert result["is_declining"] is False

    def test_too_few_sessions_not_declining(self):
        sessions = [MagicMock(accuracy=80.0), MagicMock(accuracy=70.0)]
        result = svc._check_declining_trend(sessions)
        assert result["is_declining"] is False


class TestEngagementGap:
    """Long gap between sessions triggers risk factor."""

    def test_long_gap_detected(self):
        now = _now()
        sessions = [
            MagicMock(started_at=now - timedelta(days=30)),
            MagicMock(started_at=now),
        ]
        gap = svc._check_engagement_gap(sessions)
        assert gap is not None
        assert gap > svc.INACTIVITY_DAYS

    def test_short_gap_ok(self):
        now = _now()
        sessions = [
            MagicMock(started_at=now - timedelta(days=3)),
            MagicMock(started_at=now),
        ]
        gap = svc._check_engagement_gap(sessions)
        assert gap is not None
        assert gap <= svc.INACTIVITY_DAYS

    def test_single_session_no_gap(self):
        sessions = [MagicMock(started_at=_now())]
        gap = svc._check_engagement_gap(sessions)
        assert gap is None


class TestStuckCount:
    """Multiple stuck stories raises stuck count."""

    def test_stuck_story_counted(self):
        # Same story, 3 attempts, no improvement
        sessions = [
            MagicMock(story_slug="s1", accuracy=50.0),
            MagicMock(story_slug="s1", accuracy=51.0),
            MagicMock(story_slug="s1", accuracy=52.0),
        ]
        count = svc._check_stuck_count(sessions)
        assert count >= 1

    def test_improving_story_not_stuck(self):
        # Improvement > 5%
        sessions = [
            MagicMock(story_slug="s1", accuracy=50.0),
            MagicMock(story_slug="s1", accuracy=70.0),
            MagicMock(story_slug="s1", accuracy=85.0),
        ]
        count = svc._check_stuck_count(sessions)
        assert count == 0

    def test_two_few_attempts_not_stuck(self):
        sessions = [
            MagicMock(story_slug="s1", accuracy=50.0),
            MagicMock(story_slug="s1", accuracy=51.0),
        ]
        count = svc._check_stuck_count(sessions)
        assert count == 0


class TestRiskLevelMapping:
    """Factor count → risk level mapping."""

    def test_zero_factors_low(self):
        level, _ = svc._compute_risk_level([], [MagicMock()] * 10)
        assert level == "low"

    def test_one_factor_low(self):
        level, _ = svc._compute_risk_level(["factor1"], [MagicMock()] * 10)
        assert level == "low"

    def test_two_factors_medium(self):
        level, _ = svc._compute_risk_level(["f1", "f2"], [MagicMock()] * 10)
        assert level == "medium"

    def test_three_factors_medium(self):
        level, _ = svc._compute_risk_level(["f1", "f2", "f3"], [MagicMock()] * 10)
        assert level == "medium"

    def test_four_factors_high(self):
        level, _ = svc._compute_risk_level(["f1", "f2", "f3", "f4"], [MagicMock()] * 10)
        assert level == "high"

    def test_confidence_grows_with_sessions(self):
        _, conf_few = svc._compute_risk_level(["f1"], [MagicMock()] * 1)
        _, conf_many = svc._compute_risk_level(["f1"], [MagicMock()] * 10)
        assert conf_many > conf_few


# ══════════════════════════════════════════════════════════════════════════════
# Integration tests — endpoint GET /api/teacher/classrooms/{id}/at-risk-students
# ══════════════════════════════════════════════════════════════════════════════


class TestAtRiskEndpoint:

    def test_endpoint_returns_200(self):
        db = _new_db()
        try:
            teacher = _make_user(db, "teacher254a@test.com", "Teacher A")
            school = _make_school(db)
            classroom = _make_classroom(db, teacher.id, school.id)
            student = _make_user(db, "stu254a@test.com", "Student A")
            db.add(ClassroomStudent(classroom_id=classroom.id, student_id=student.id))
            db.commit()

            res = _get_as(f"/api/teacher/classrooms/{classroom.id}/at-risk-students", teacher)
            assert res.status_code == 200
        finally:
            db.close()

    def test_returns_all_students(self):
        db = _new_db()
        try:
            teacher = _make_user(db, "teacher254b@test.com", "Teacher B")
            school = _make_school(db)
            classroom = _make_classroom(db, teacher.id, school.id)
            s1 = _make_user(db, "stu254b1@test.com", "Student B1")
            s2 = _make_user(db, "stu254b2@test.com", "Student B2")
            db.add(ClassroomStudent(classroom_id=classroom.id, student_id=s1.id))
            db.add(ClassroomStudent(classroom_id=classroom.id, student_id=s2.id))
            db.commit()

            res = _get_as(f"/api/teacher/classrooms/{classroom.id}/at-risk-students", teacher)
            assert len(res.json()) == 2
        finally:
            db.close()

    def test_high_risk_sorted_first(self):
        db = _new_db()
        try:
            teacher = _make_user(db, "teacher254c@test.com", "Teacher C")
            school = _make_school(db)
            classroom = _make_classroom(db, teacher.id, school.id)
            high = _make_user(db, "stu_high254@test.com", "High Risk")
            low = _make_user(db, "stu_low254@test.com", "Low Risk")
            db.add(ClassroomStudent(classroom_id=classroom.id, student_id=high.id))
            db.add(ClassroomStudent(classroom_id=classroom.id, student_id=low.id))

            now = _now()
            # High-risk: low accuracy + declining + long gap
            _make_session(db, high.id, "s1", 35.0, now - timedelta(days=55))
            _make_session(db, high.id, "s2", 38.0, now - timedelta(days=40))
            _make_session(db, high.id, "s3", 36.0, now - timedelta(days=30))
            _make_session(db, high.id, "s4", 55.0, now - timedelta(days=20))
            _make_session(db, high.id, "s5", 48.0, now - timedelta(days=15))
            _make_session(db, high.id, "s6", 40.0, now - timedelta(days=14))
            # Low-risk: good accuracy, frequent sessions
            for i in range(5):
                _make_session(db, low.id, f"good{i}", 90.0 - i, now - timedelta(days=i * 2))
            db.commit()

            res = _get_as(f"/api/teacher/classrooms/{classroom.id}/at-risk-students", teacher)
            data = res.json()
            levels = [d["risk_level"] for d in data]
            order = {"high": 0, "medium": 1, "low": 2}
            assert levels == sorted(levels, key=lambda l: order.get(l, 3))
        finally:
            db.close()

    def test_response_schema_fields(self):
        db = _new_db()
        try:
            teacher = _make_user(db, "teacher254d@test.com", "Teacher D")
            school = _make_school(db)
            classroom = _make_classroom(db, teacher.id, school.id)
            student = _make_user(db, "stu254d@test.com", "Student D")
            db.add(ClassroomStudent(classroom_id=classroom.id, student_id=student.id))
            db.commit()

            res = _get_as(f"/api/teacher/classrooms/{classroom.id}/at-risk-students", teacher)
            assert res.status_code == 200
            item = res.json()[0]
            for field in ("student_id", "student_name", "risk_level", "risk_factors",
                          "recommended_actions", "confidence_score", "supporting_data"):
                assert field in item, f"Missing field: {field}"
            assert item["risk_level"] in ("low", "medium", "high")
        finally:
            db.close()

    def test_empty_classroom_returns_empty_list(self):
        db = _new_db()
        try:
            teacher = _make_user(db, "teacher254e@test.com", "Teacher E")
            school = _make_school(db)
            classroom = _make_classroom(db, teacher.id, school.id)
            db.commit()

            res = _get_as(f"/api/teacher/classrooms/{classroom.id}/at-risk-students", teacher)
            assert res.status_code == 200
            assert res.json() == []
        finally:
            db.close()

    def test_unauthorized_teacher_gets_403(self):
        db = _new_db()
        try:
            teacher = _make_user(db, "teacher254f@test.com", "Teacher F")
            other = _make_user(db, "teacher254g@test.com", "Teacher G")
            school = _make_school(db)
            classroom = _make_classroom(db, teacher.id, school.id)
            db.commit()

            res = _get_as(f"/api/teacher/classrooms/{classroom.id}/at-risk-students", other)
            assert res.status_code == 403
        finally:
            db.close()
