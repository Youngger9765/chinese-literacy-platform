"""
Tests for #256 teacher notification center endpoints.

Coverage:
- GET /teacher/notifications returns aggregated alerts with is_read=False initially
- POST /teacher/notifications/mark-read marks specific keys as read
- POST /teacher/notifications/mark-all-read marks all as read
- Unread count decreases after marking read
- Badge count (unread) reflects correct number
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


# ── Fixtures ──────────────────────────────────────────────────────────────────


@pytest.fixture(autouse=True)
def setup_db():
    Base.metadata.create_all(bind=engine)
    yield
    Base.metadata.drop_all(bind=engine)


@pytest.fixture
def db():
    session = TestingSessionLocal()
    try:
        yield session
    finally:
        session.close()


@pytest.fixture
def client(db):
    app.dependency_overrides[get_db] = _override_get_db
    with TestClient(app) as c:
        yield c
    app.dependency_overrides.clear()


@pytest.fixture
def teacher_and_classroom(db):
    """Create teacher + school + classroom + inactive student."""
    from app.models.school import School

    # Seed roles
    for r in SEED_ROLES:
        db.add(Role(**r))
    db.flush()

    teacher_role = db.query(Role).filter_by(name="teacher").first()
    student_role = db.query(Role).filter_by(name="student").first()

    school = School(name="Test School", join_code="TST01")
    db.add(school)
    db.flush()

    teacher = User(
        name="Test Teacher",
        email="teacher@test.com",
        username="teacher_test",
        password_hash="hashed",
        is_active=True,
    )
    db.add(teacher)
    db.flush()

    db.add(UserRole(user_id=teacher.id, role_id=teacher_role.id, scope_type="school", scope_id=str(school.id)))
    db.flush()

    classroom = Classroom(
        name="5A",
        school_id=school.id,
        teacher_id=teacher.id,
        grade=5,
        is_active=True,
    )
    db.add(classroom)
    db.flush()

    # Inactive student (no sessions)
    student = User(
        name="Inactive Student",
        email="student@test.com",
        username="student_test",
        password_hash="hashed",
        is_active=True,
    )
    db.add(student)
    db.flush()

    db.add(UserRole(user_id=student.id, role_id=student_role.id, scope_type="school", scope_id=str(school.id)))
    db.add(ClassroomStudent(classroom_id=classroom.id, student_id=student.id))
    db.flush()
    db.commit()

    return {"teacher": teacher, "classroom": classroom, "student": student}


def _auth_override(user):
    app.dependency_overrides[get_current_user] = lambda: user


# ── Tests ─────────────────────────────────────────────────────────────────────


def test_get_notifications_returns_unread_alerts(client, teacher_and_classroom):
    """GET /teacher/notifications returns alerts with is_read=False for fresh teacher."""
    teacher = teacher_and_classroom["teacher"]
    _auth_override(teacher)

    resp = client.get("/api/teacher/notifications")
    assert resp.status_code == 200

    data = resp.json()
    assert "total" in data
    assert "unread" in data
    assert "items" in data

    # Inactive student should generate an alert
    assert data["total"] >= 1
    assert data["unread"] >= 1

    item = data["items"][0]
    assert item["is_read"] is False
    assert item["alert_type"] == "inactive"
    assert item["student_name"] == "Inactive Student"


def test_mark_single_notification_read(client, teacher_and_classroom):
    """POST /teacher/notifications/mark-read decreases unread count."""
    teacher = teacher_and_classroom["teacher"]
    _auth_override(teacher)

    # Fetch to get alert key
    resp = client.get("/api/teacher/notifications")
    assert resp.status_code == 200
    data = resp.json()
    assert data["unread"] >= 1

    alert_key = data["items"][0]["alert_key"]

    # Mark as read
    mark_resp = client.post(
        "/api/teacher/notifications/mark-read",
        json={"alert_keys": [alert_key]},
    )
    assert mark_resp.status_code == 200
    assert mark_resp.json()["marked"] == 1

    # Fetch again — unread should be 0
    resp2 = client.get("/api/teacher/notifications")
    assert resp2.status_code == 200
    data2 = resp2.json()
    assert data2["unread"] == 0
    read_item = next((i for i in data2["items"] if i["alert_key"] == alert_key), None)
    assert read_item is not None
    assert read_item["is_read"] is True


def test_mark_all_notifications_read(client, teacher_and_classroom):
    """POST /teacher/notifications/mark-all-read sets unread to 0."""
    teacher = teacher_and_classroom["teacher"]
    _auth_override(teacher)

    resp = client.post("/api/teacher/notifications/mark-all-read", json={})
    assert resp.status_code == 200

    resp2 = client.get("/api/teacher/notifications")
    assert resp2.status_code == 200
    data = resp2.json()
    assert data["unread"] == 0


def test_mark_read_idempotent(client, teacher_and_classroom):
    """Marking the same alert read twice should not error and marked=0 on second call."""
    teacher = teacher_and_classroom["teacher"]
    _auth_override(teacher)

    resp = client.get("/api/teacher/notifications")
    alert_key = resp.json()["items"][0]["alert_key"]

    client.post("/api/teacher/notifications/mark-read", json={"alert_keys": [alert_key]})
    resp2 = client.post("/api/teacher/notifications/mark-read", json={"alert_keys": [alert_key]})
    assert resp2.status_code == 200
    assert resp2.json()["marked"] == 0


def test_empty_classrooms_returns_empty(client, db):
    """Teacher with no classrooms gets empty notification list."""
    from app.models.school import School

    for r in SEED_ROLES:
        db.add(Role(**r))
    db.flush()

    teacher_role = db.query(Role).filter_by(name="teacher").first()
    school = School(name="Empty School", join_code="EMP01")
    db.add(school)
    db.flush()

    teacher = User(
        name="Empty Teacher",
        email="empty@test.com",
        username="empty_teacher",
        password_hash="hashed",
        is_active=True,
    )
    db.add(teacher)
    db.flush()
    db.add(UserRole(user_id=teacher.id, role_id=teacher_role.id, scope_type="school", scope_id=str(school.id)))
    db.commit()

    _auth_override(teacher)
    resp = client.get("/api/teacher/notifications")
    assert resp.status_code == 200
    data = resp.json()
    assert data["total"] == 0
    assert data["unread"] == 0
    assert data["items"] == []
