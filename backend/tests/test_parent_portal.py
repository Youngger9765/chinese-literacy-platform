"""Tests for the Parent Portal API (issue #95).

Covers:
- POST /api/parents/invite-codes          — teacher generates invite code
- GET  /api/parents/invite-codes/student/{id} — teacher lists codes
- POST /api/parents/link                  — parent redeems code
- GET  /api/parents/children              — parent lists linked children
- GET  /api/parents/children/{id}/dashboard — parent views child dashboard

Run with:
    cd backend
    python -m pytest tests/test_parent_portal.py -v
"""

import sys
import os
import uuid

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, event
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.main import app
from app.database import get_db
from app.models import Base
from app.models.user import Role
from app.models.school import School, Classroom, ClassroomStudent

# ---------------------------------------------------------------------------
# Test DB setup
# ---------------------------------------------------------------------------

engine = create_engine(
    "sqlite://",
    connect_args={"check_same_thread": False},
    poolclass=StaticPool,
)


@event.listens_for(engine, "connect")
def _sqlite_fk(dbapi_conn, _):
    cur = dbapi_conn.cursor()
    cur.execute("PRAGMA foreign_keys=ON")
    cur.close()


TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

SEED_ROLES = [
    {"name": "system_admin", "display_name": "System Admin", "scope_level": "platform"},
    {"name": "teacher", "display_name": "Teacher", "scope_level": "school"},
    {"name": "student", "display_name": "Student", "scope_level": "school"},
    {"name": "parent", "display_name": "Parent", "scope_level": "platform"},
]


def _seed_roles(session):
    for r in SEED_ROLES:
        session.add(Role(**r))
    session.commit()


def _override_db():
    db = TestingSessionLocal()
    try:
        yield db
    finally:
        db.close()


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


@pytest.fixture(scope="module", autouse=True)
def setup_db():
    Base.metadata.create_all(bind=engine)
    session = TestingSessionLocal()
    _seed_roles(session)
    session.close()
    app.dependency_overrides[get_db] = _override_db
    yield
    app.dependency_overrides.pop(get_db, None)
    Base.metadata.drop_all(bind=engine)


@pytest.fixture(scope="module")
def client():
    with TestClient(app) as c:
        yield c


def auth_header(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


def _register(client, prefix: str) -> tuple[int, str]:
    """Register a user; return (id, token)."""
    email = f"{prefix}_{uuid.uuid4().hex[:6]}@test.com"
    password = "Test1234!"
    r = client.post("/api/auth/register", json={"email": email, "password": password, "name": prefix})
    assert r.status_code == 201, r.text
    verification_token = r.json().get("verification_token")
    if verification_token:
        client.get(f"/api/auth/verify-email?token={verification_token}")
    login_r = client.post("/api/auth/login", json={"email": email, "password": password})
    token = login_r.json()["access_token"]
    me = client.get("/api/users/me", headers=auth_header(token))
    return me.json()["id"], token


def _make_classroom_with_student(teacher_id: int, student_id: int) -> None:
    """Create a school + classroom + enroll student directly in DB."""
    db = TestingSessionLocal()
    school = School(name="Test School")
    db.add(school)
    db.flush()
    classroom = Classroom(
        school_id=school.id,
        teacher_id=teacher_id,
        name="Test Class",
        join_code=uuid.uuid4().hex[:6].upper(),
    )
    db.add(classroom)
    db.flush()
    enrollment = ClassroomStudent(classroom_id=classroom.id, student_id=student_id)
    db.add(enrollment)
    db.commit()
    db.close()


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------


class TestGenerateInviteCode:
    """Teacher generates a parent invite code for a student."""

    def test_teacher_can_generate_code(self, client):
        teacher_id, teacher_token = _register(client, "teacher_gen")
        student_id, _ = _register(client, "student_gen")
        _make_classroom_with_student(teacher_id, student_id)

        r = client.post(
            f"/api/parents/invite-codes?student_id={student_id}",
            headers=auth_header(teacher_token),
        )
        assert r.status_code == 201, r.text
        data = r.json()
        assert data["student_id"] == student_id
        assert len(data["code"]) == 8
        assert data["used"] is False

    def test_non_teacher_cannot_generate_code(self, client):
        _, teacher_token = _register(client, "teacher_gen2")
        student_id, _ = _register(client, "student_gen2")
        # Not enrolled in teacher's classroom — teacher has no classroom for this student

        r = client.post(
            f"/api/parents/invite-codes?student_id={student_id}",
            headers=auth_header(teacher_token),
        )
        assert r.status_code == 403, r.text

    def test_unknown_student_returns_404(self, client):
        _, teacher_token = _register(client, "teacher_gen3")
        r = client.post(
            "/api/parents/invite-codes?student_id=999999",
            headers=auth_header(teacher_token),
        )
        assert r.status_code == 404, r.text

    def test_unauthenticated_returns_401(self, client):
        r = client.post("/api/parents/invite-codes?student_id=1")
        assert r.status_code == 401, r.text


class TestListInviteCodes:
    """Teacher lists invite codes for a student."""

    def test_list_returns_generated_code(self, client):
        teacher_id, teacher_token = _register(client, "teacher_list")
        student_id, _ = _register(client, "student_list")
        _make_classroom_with_student(teacher_id, student_id)

        # Generate one code
        client.post(
            f"/api/parents/invite-codes?student_id={student_id}",
            headers=auth_header(teacher_token),
        )

        r = client.get(
            f"/api/parents/invite-codes/student/{student_id}",
            headers=auth_header(teacher_token),
        )
        assert r.status_code == 200, r.text
        items = r.json()["items"]
        assert len(items) >= 1

    def test_non_teacher_gets_403(self, client):
        _, other_token = _register(client, "other_list")
        student_id, _ = _register(client, "student_list2")

        r = client.get(
            f"/api/parents/invite-codes/student/{student_id}",
            headers=auth_header(other_token),
        )
        assert r.status_code == 403, r.text


class TestRedeemCode:
    """Parent redeems an invite code."""

    def test_parent_can_redeem_code(self, client):
        teacher_id, teacher_token = _register(client, "teacher_redeem")
        student_id, _ = _register(client, "student_redeem")
        _make_classroom_with_student(teacher_id, student_id)

        # Generate code
        gen_r = client.post(
            f"/api/parents/invite-codes?student_id={student_id}",
            headers=auth_header(teacher_token),
        )
        code = gen_r.json()["code"]

        # Redeem
        _, parent_token = _register(client, "parent_redeem")
        r = client.post(
            "/api/parents/link",
            json={"code": code},
            headers=auth_header(parent_token),
        )
        assert r.status_code == 201, r.text
        data = r.json()
        assert data["student_id"] == student_id

    def test_cannot_redeem_same_code_twice(self, client):
        teacher_id, teacher_token = _register(client, "teacher_double")
        student_id, _ = _register(client, "student_double")
        _make_classroom_with_student(teacher_id, student_id)

        gen_r = client.post(
            f"/api/parents/invite-codes?student_id={student_id}",
            headers=auth_header(teacher_token),
        )
        code = gen_r.json()["code"]

        _, parent_token = _register(client, "parent_double")
        client.post("/api/parents/link", json={"code": code}, headers=auth_header(parent_token))

        # Second redemption should fail
        r = client.post("/api/parents/link", json={"code": code}, headers=auth_header(parent_token))
        assert r.status_code == 400, r.text

    def test_invalid_code_returns_400(self, client):
        _, parent_token = _register(client, "parent_invalid")
        r = client.post(
            "/api/parents/link",
            json={"code": "BADCODE1"},
            headers=auth_header(parent_token),
        )
        assert r.status_code == 400, r.text

    def test_student_cannot_link_to_self(self, client):
        teacher_id, teacher_token = _register(client, "teacher_self")
        student_id, student_token = _register(client, "student_self")
        _make_classroom_with_student(teacher_id, student_id)

        gen_r = client.post(
            f"/api/parents/invite-codes?student_id={student_id}",
            headers=auth_header(teacher_token),
        )
        code = gen_r.json()["code"]

        r = client.post("/api/parents/link", json={"code": code}, headers=auth_header(student_token))
        assert r.status_code == 400, r.text


class TestListChildren:
    """Parent lists linked children."""

    def test_linked_child_appears_in_list(self, client):
        teacher_id, teacher_token = _register(client, "teacher_cl")
        student_id, _ = _register(client, "student_cl")
        _make_classroom_with_student(teacher_id, student_id)

        gen_r = client.post(
            f"/api/parents/invite-codes?student_id={student_id}",
            headers=auth_header(teacher_token),
        )
        code = gen_r.json()["code"]

        _, parent_token = _register(client, "parent_cl")
        client.post("/api/parents/link", json={"code": code}, headers=auth_header(parent_token))

        r = client.get("/api/parents/children", headers=auth_header(parent_token))
        assert r.status_code == 200, r.text
        children = r.json()["children"]
        assert any(c["student_id"] == student_id for c in children)

    def test_unlinked_parent_sees_empty_list(self, client):
        _, parent_token = _register(client, "parent_empty")
        r = client.get("/api/parents/children", headers=auth_header(parent_token))
        assert r.status_code == 200, r.text
        assert r.json()["children"] == []


class TestChildDashboard:
    """Parent accesses child's progress dashboard."""

    def test_linked_parent_can_access_dashboard(self, client):
        teacher_id, teacher_token = _register(client, "teacher_dash")
        student_id, _ = _register(client, "student_dash")
        _make_classroom_with_student(teacher_id, student_id)

        gen_r = client.post(
            f"/api/parents/invite-codes?student_id={student_id}",
            headers=auth_header(teacher_token),
        )
        code = gen_r.json()["code"]

        _, parent_token = _register(client, "parent_dash")
        client.post("/api/parents/link", json={"code": code}, headers=auth_header(parent_token))

        r = client.get(
            f"/api/parents/children/{student_id}/dashboard",
            headers=auth_header(parent_token),
        )
        assert r.status_code == 200, r.text
        data = r.json()
        assert "total_sessions" in data
        assert "streak_days" in data
        assert "daily_activity" in data

    def test_unlinked_user_cannot_access_dashboard(self, client):
        _, other_token = _register(client, "other_dash")
        student_id, _ = _register(client, "student_dash2")

        r = client.get(
            f"/api/parents/children/{student_id}/dashboard",
            headers=auth_header(other_token),
        )
        assert r.status_code == 403, r.text
