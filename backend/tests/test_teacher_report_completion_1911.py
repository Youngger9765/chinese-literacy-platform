"""
TDD tests for #1911 — teacher per-session report completion criteria mismatch.

Root cause: progress table shows 已完成 when session.status == 'completed',
but report page shows 尚未完成 when reading_result/full_reading_result/comprehension_result
are all null — a session can be completed without these JSONB fields populated.

Fix: TeacherSessionReportResponse must expose is_complete (= status == 'completed')
so the frontend uses the same completion criterion as the progress table.

Run with:
    cd backend && python -m pytest tests/test_teacher_report_completion_1911.py -v
"""

import sys
import os
import uuid
from datetime import datetime, timezone

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, event
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.main import app
from app.database import get_db
from app.models import Base
from app.models.user import Role, UserRole
from app.models.school import School, Classroom, ClassroomStudent
from app.models.session import LearningSession


# ---------------------------------------------------------------------------
# Patch str-based server_defaults that SQLite can't parse
# ---------------------------------------------------------------------------

def _patch_str_server_defaults():
    from sqlalchemy.sql.schema import DefaultClause
    for table in Base.metadata.sorted_tables:
        for column in table.columns:
            sd = column.server_default
            if sd is None:
                continue
            arg = getattr(sd, "arg", None)
            if isinstance(arg, str) and "::" in arg:
                column.server_default = None


_patch_str_server_defaults()


# ---------------------------------------------------------------------------
# DB setup
# ---------------------------------------------------------------------------

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
    {"name": "org_admin", "display_name": "Organization Admin", "scope_level": "organization"},
    {"name": "principal", "display_name": "Principal", "scope_level": "school"},
    {"name": "director", "display_name": "Director", "scope_level": "school"},
    {"name": "teacher", "display_name": "Teacher", "scope_level": "school"},
    {"name": "homeroom_teacher", "display_name": "Homeroom Teacher", "scope_level": "school"},
    {"name": "student", "display_name": "Student", "scope_level": "school"},
    {"name": "parent", "display_name": "Parent", "scope_level": "school"},
]


def _seed_roles(session):
    for role_data in SEED_ROLES:
        session.add(Role(**role_data))
    session.commit()


def _seed_school(session) -> int:
    school = School(name="1911 Test School")
    session.add(school)
    session.commit()
    session.refresh(school)
    return school.id


def _override_get_db():
    db = TestingSessionLocal()
    try:
        yield db
    finally:
        db.close()


_test_school_id: int = 0


@pytest.fixture(scope="module", autouse=True)
def setup_db():
    global _test_school_id
    Base.metadata.create_all(bind=engine)
    session = TestingSessionLocal()
    _seed_roles(session)
    _test_school_id = _seed_school(session)
    session.close()

    from app.routes.auth import rate_limiter
    rate_limiter.reset()
    try:
        from app.auth.rate_limiter import general_rate_limiter
        general_rate_limiter.reset()
    except (ImportError, AttributeError):
        pass

    app.dependency_overrides[get_db] = _override_get_db
    yield
    app.dependency_overrides.pop(get_db, None)
    Base.metadata.drop_all(bind=engine)


@pytest.fixture(scope="module")
def client():
    with TestClient(app) as c:
        yield c


@pytest.fixture(scope="module")
def school_id():
    return _test_school_id


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def auth_header(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


def _register_and_login(client, prefix: str) -> dict:
    unique = uuid.uuid4().hex[:8]
    email = f"{prefix}_{unique}@example.com"
    password = "SecurePass123!"
    name = f"{prefix.title()} {unique}"
    resp = client.post("/api/auth/register", json={"email": email, "password": password, "name": name})
    assert resp.status_code == 201
    token_resp = resp.json().get("verification_token")
    if token_resp:
        client.get(f"/api/auth/verify-email?token={token_resp}")
    login = client.post("/api/auth/login", json={"email": email, "password": password})
    token = login.json()["access_token"]
    me = client.get("/api/users/me", headers=auth_header(token))
    user_id = me.json()["id"]

    _mk = TestingSessionLocal()
    try:
        _trole = _mk.query(Role).filter(Role.name == "teacher").first()
        if _trole and not _mk.query(UserRole).filter(
            UserRole.user_id == user_id, UserRole.role_id == _trole.id,
            UserRole.scope_type == "school", UserRole.scope_id == str(_test_school_id),
        ).first():
            _mk.add(UserRole(user_id=user_id, role_id=_trole.id,
                             scope_type="school", scope_id=str(_test_school_id)))
            _mk.commit()
    finally:
        _mk.close()

    return {"email": email, "token": token, "user_id": user_id}


def _create_classroom(client, teacher_token: str, school_id: int, name: str) -> int:
    resp = client.post(
        "/api/classrooms",
        json={"name": name, "school_id": school_id},
        headers=auth_header(teacher_token),
    )
    assert resp.status_code == 201
    return resp.json()["id"]


def _enroll_student(client, teacher_token: str, classroom_id: int, student_id: int):
    resp = client.post(
        f"/api/classrooms/{classroom_id}/students",
        json={"student_id": student_id},
        headers=auth_header(teacher_token),
    )
    assert resp.status_code in (200, 201)


def _seed_session(student_id: int, status: str, overall_score=None,
                  reading_result=None, full_reading_result=None,
                  comprehension_result=None) -> int:
    """Insert a LearningSession directly. Returns session_id."""
    db = TestingSessionLocal()
    session = LearningSession(
        student_id=student_id,
        story_slug="test-slug-1911",
        status=status,
        overall_score=overall_score,
        started_at=datetime.now(timezone.utc),
        completed_at=datetime.now(timezone.utc) if status == "completed" else None,
        reading_result=reading_result,
        full_reading_result=full_reading_result,
        comprehension_result=comprehension_result,
        full_reading_attempts=[],
    )
    db.add(session)
    db.commit()
    db.refresh(session)
    sid = session.id
    db.close()
    return sid


# ===========================================================================
# Test 1: session_marked_complete_returns_is_complete_true
#
# A session with status='completed' but all JSONB result fields null must
# return is_complete=True in the report endpoint. This is the core #1911 fix.
# ===========================================================================

def test_session_marked_complete_returns_is_complete_true(client, school_id):
    """
    When a session has status='completed', the report endpoint must return
    is_complete=True regardless of whether JSONB result fields are populated.

    This is the primary regression guard for #1911.
    """
    teacher = _register_and_login(client, "teacher1911a")
    student = _register_and_login(client, "student1911a")

    classroom_id = _create_classroom(client, teacher["token"], school_id, "Class 1911-A")
    _enroll_student(client, teacher["token"], classroom_id, student["user_id"])

    # Session is complete but all JSONB result fields are null
    # (mimics sessions that get marked complete without reading data)
    session_id = _seed_session(
        student_id=student["user_id"],
        status="completed",
        overall_score=70.0,
        # reading_result, full_reading_result, comprehension_result all None
    )

    resp = client.get(
        f"/api/teacher/students/{student['user_id']}/sessions/{session_id}/report",
        headers=auth_header(teacher["token"]),
    )

    assert resp.status_code == 200, f"Expected 200, got {resp.status_code}: {resp.text}"
    data = resp.json()

    # THE KEY ASSERTION: is_complete must be present and True
    assert "is_complete" in data, (
        "TeacherSessionReportResponse must include 'is_complete' field. "
        "Frontend uses this to decide whether to show report or '尚未完成' message."
    )
    assert data["is_complete"] is True, (
        f"Session with status='completed' must return is_complete=True, "
        f"got is_complete={data.get('is_complete')}"
    )


# ===========================================================================
# Test 2: completed session with overall_score → reading summary accessible
# ===========================================================================

def test_session_marked_complete_with_overall_score_returns_reading_summary(client, school_id):
    """
    A session with status='completed' and overall_score populated should
    return is_complete=True and the overall_score. Backend must not gate
    report access on JSONB result fields being non-null.
    """
    teacher = _register_and_login(client, "teacher1911b")
    student = _register_and_login(client, "student1911b")

    classroom_id = _create_classroom(client, teacher["token"], school_id, "Class 1911-B")
    _enroll_student(client, teacher["token"], classroom_id, student["user_id"])

    session_id = _seed_session(
        student_id=student["user_id"],
        status="completed",
        overall_score=85.5,
    )

    resp = client.get(
        f"/api/teacher/students/{student['user_id']}/sessions/{session_id}/report",
        headers=auth_header(teacher["token"]),
    )

    assert resp.status_code == 200
    data = resp.json()
    assert data["is_complete"] is True
    assert data["overall_score"] == pytest.approx(85.5)
    assert data["status"] == "completed"


# ===========================================================================
# Test 3: in_progress session → is_complete=False
# ===========================================================================

def test_session_not_complete_returns_is_complete_false(client, school_id):
    """
    When a session has status='in_progress', the report endpoint must return
    is_complete=False. Regression guard: incomplete sessions must show empty
    state, not a fabricated report.
    """
    teacher = _register_and_login(client, "teacher1911c")
    student = _register_and_login(client, "student1911c")

    classroom_id = _create_classroom(client, teacher["token"], school_id, "Class 1911-C")
    _enroll_student(client, teacher["token"], classroom_id, student["user_id"])

    session_id = _seed_session(
        student_id=student["user_id"],
        status="in_progress",
    )

    resp = client.get(
        f"/api/teacher/students/{student['user_id']}/sessions/{session_id}/report",
        headers=auth_header(teacher["token"]),
    )

    assert resp.status_code == 200
    data = resp.json()
    assert "is_complete" in data
    assert data["is_complete"] is False, (
        f"Session with status='in_progress' must return is_complete=False, "
        f"got is_complete={data.get('is_complete')}"
    )
