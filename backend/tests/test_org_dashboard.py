"""
Tests for GET /api/organizations/{org_id}/dashboard endpoint.

Covers:
- test_dashboard_org_owner: org-scoped user sees stats
- test_dashboard_system_admin: system_admin sees stats
- test_dashboard_non_member_forbidden: user not in org → 403
- test_dashboard_teacher_forbidden: school-scoped teacher → 403
- test_dashboard_empty_org: no schools → all zeros
- test_dashboard_school_stats: per-school breakdown verified

Run with:
    cd /Users/young/project/chinese-literacy-platform-issue-233/backend
    python -m pytest tests/test_org_dashboard.py -v
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
from app.models.user import Role, UserRole
from app.models.school import School, Classroom, ClassroomStudent
from app.models.session import LearningSession
from app.models.organization import Organization


# ---------------------------------------------------------------------------
# Test database setup
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
    {"name": "org_owner", "display_name": "Org Owner", "scope_level": "organization"},
    {"name": "org_admin", "display_name": "Org Admin", "scope_level": "organization"},
    {"name": "principal", "display_name": "Principal", "scope_level": "school"},
    {"name": "director", "display_name": "Director", "scope_level": "school"},
    {"name": "teacher", "display_name": "Teacher", "scope_level": "school"},
    {"name": "homeroom_teacher", "display_name": "Homeroom Teacher", "scope_level": "school"},
    {"name": "student", "display_name": "Student", "scope_level": "school"},
]


def _seed_roles(session):
    for role_data in SEED_ROLES:
        session.add(Role(**role_data))
    session.commit()


def _override_get_db():
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

    app.dependency_overrides[get_db] = _override_get_db
    yield
    app.dependency_overrides.pop(get_db, None)
    Base.metadata.drop_all(bind=engine)


@pytest.fixture(scope="module")
def client():
    with TestClient(app) as c:
        yield c


def auth_header(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


def _reset_rate_limiter():
    from app.routes.auth import rate_limiter
    rate_limiter.reset()


def _register_user(client, suffix: str) -> dict:
    _reset_rate_limiter()
    unique = uuid.uuid4().hex[:8]
    email = f"{suffix}_{unique}@example.com"
    password = "SecurePass123!"
    resp = client.post("/api/auth/register", json={
        "email": email,
        "password": password,
        "name": f"{suffix.title()} {unique}",
    })
    assert resp.status_code == 201
    verification_token = resp.json().get("verification_token")
    if verification_token:
        client.get(f"/api/auth/verify-email?token={verification_token}")
    login_resp = client.post("/api/auth/login", json={"email": email, "password": password})
    token = login_resp.json()["access_token"]
    me_resp = client.get("/api/users/me", headers=auth_header(token))
    return {"token": token, "user_id": me_resp.json()["id"]}


def _create_user_direct(suffix: str) -> int:
    """Create a user directly in DB (no rate limit)."""
    from app.auth.password import hash_password
    db = TestingSessionLocal()
    from app.models.user import User as UserModel
    unique = uuid.uuid4().hex[:8]
    user = UserModel(
        email=f"{suffix}_{unique}@example.com",
        password_hash=hash_password("SecurePass123!"),
        name=f"{suffix.title()} {unique}",
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    user_id = user.id
    db.close()
    return user_id


def _assign_role(user_id: int, role_name: str, scope_type: str, scope_id: str | None = None):
    db = TestingSessionLocal()
    role = db.query(Role).filter(Role.name == role_name).first()
    user_role = UserRole(
        user_id=user_id,
        role_id=role.id,
        scope_type=scope_type,
        scope_id=scope_id,
    )
    db.add(user_role)
    db.commit()
    db.close()


def _create_org(name: str) -> str:
    """Create an org directly and return its ID."""
    db = TestingSessionLocal()
    org = Organization(name=name, display_name=name)
    db.add(org)
    db.commit()
    db.refresh(org)
    org_id = org.id
    db.close()
    return org_id


def _create_school(org_id: str, name: str) -> int:
    db = TestingSessionLocal()
    school = School(name=name, organization_id=org_id)
    db.add(school)
    db.commit()
    db.refresh(school)
    school_id = school.id
    db.close()
    return school_id


def _create_classroom(school_id: int, teacher_id: int, name: str = "Class A") -> int:
    db = TestingSessionLocal()
    classroom = Classroom(school_id=school_id, teacher_id=teacher_id, name=name)
    db.add(classroom)
    db.commit()
    db.refresh(classroom)
    classroom_id = classroom.id
    db.close()
    return classroom_id


def _enroll_student(classroom_id: int, student_id: int):
    db = TestingSessionLocal()
    cs = ClassroomStudent(classroom_id=classroom_id, student_id=student_id)
    db.add(cs)
    db.commit()
    db.close()


def _create_session(student_id: int, classroom_id: int, status: str = "in_progress") -> int:
    db = TestingSessionLocal()
    session = LearningSession(
        student_id=student_id,
        classroom_id=classroom_id,
        status=status,
    )
    db.add(session)
    db.commit()
    db.refresh(session)
    session_id = session.id
    db.close()
    return session_id


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------


class TestDashboardSystemAdmin:
    def test_dashboard_system_admin(self, client):
        admin = _register_user(client, "dash_sysadmin")
        _assign_role(admin["user_id"], "system_admin", "platform", None)

        org_id = _create_org("Admin Dashboard Org")
        school_id = _create_school(org_id, "Test School Alpha")

        teacher = _register_user(client, "dash_teacher_alpha")
        _assign_role(teacher["user_id"], "teacher", "school", str(school_id))

        student = _register_user(client, "dash_student_alpha")
        classroom_id = _create_classroom(school_id, teacher["user_id"])
        _enroll_student(classroom_id, student["user_id"])
        _create_session(student["user_id"], classroom_id, "completed")
        _create_session(student["user_id"], classroom_id, "in_progress")

        resp = client.get(
            f"/api/organizations/{org_id}/dashboard",
            headers=auth_header(admin["token"]),
        )
        assert resp.status_code == 200
        data = resp.json()

        assert data["total_schools"] == 1
        assert data["total_teachers"] == 1
        assert data["total_students"] == 1
        assert data["total_sessions"] == 2
        assert data["completed_sessions"] == 1
        assert len(data["school_stats"]) == 1


class TestDashboardOrgMember:
    def test_dashboard_org_owner(self, client):
        org_id = _create_org("Org Owner Test Org")

        owner = _register_user(client, "dash_org_owner")
        _assign_role(owner["user_id"], "org_owner", "organization", org_id)

        resp = client.get(
            f"/api/organizations/{org_id}/dashboard",
            headers=auth_header(owner["token"]),
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["total_schools"] == 0
        assert data["school_stats"] == []

    def test_dashboard_org_admin(self, client):
        org_id = _create_org("Org Admin Test Org")

        org_admin = _register_user(client, "dash_org_admin")
        _assign_role(org_admin["user_id"], "org_admin", "organization", org_id)

        resp = client.get(
            f"/api/organizations/{org_id}/dashboard",
            headers=auth_header(org_admin["token"]),
        )
        assert resp.status_code == 200
        assert resp.json()["total_schools"] == 0


class TestDashboardAccessControl:
    def test_dashboard_non_member_forbidden(self, client):
        org_id = _create_org("Forbidden Org")
        stranger = _register_user(client, "dash_stranger")

        resp = client.get(
            f"/api/organizations/{org_id}/dashboard",
            headers=auth_header(stranger["token"]),
        )
        assert resp.status_code == 403

    def test_dashboard_teacher_forbidden(self, client):
        org_id = _create_org("Teacher Forbidden Org")
        school_id = _create_school(org_id, "Teacher Forbidden School")

        teacher = _register_user(client, "dash_teacher_forbidden")
        _assign_role(teacher["user_id"], "teacher", "school", str(school_id))

        resp = client.get(
            f"/api/organizations/{org_id}/dashboard",
            headers=auth_header(teacher["token"]),
        )
        assert resp.status_code == 403

    def test_dashboard_unauthenticated(self, client):
        org_id = _create_org("Unauth Org")
        resp = client.get(f"/api/organizations/{org_id}/dashboard")
        assert resp.status_code == 401

    def test_dashboard_nonexistent_org(self, client):
        admin = _register_user(client, "dash_sysadmin2")
        _assign_role(admin["user_id"], "system_admin", "platform", None)

        resp = client.get(
            "/api/organizations/nonexistent-uuid/dashboard",
            headers=auth_header(admin["token"]),
        )
        assert resp.status_code == 404


class TestDashboardEmptyOrg:
    def test_dashboard_empty_org(self, client):
        admin = _register_user(client, "dash_sysadmin3")
        _assign_role(admin["user_id"], "system_admin", "platform", None)

        org_id = _create_org("Empty Org")

        resp = client.get(
            f"/api/organizations/{org_id}/dashboard",
            headers=auth_header(admin["token"]),
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["total_schools"] == 0
        assert data["total_teachers"] == 0
        assert data["total_students"] == 0
        assert data["total_sessions"] == 0
        assert data["completed_sessions"] == 0
        assert data["school_stats"] == []


class TestDashboardSchoolStats:
    def test_dashboard_school_stats_breakdown(self, client):
        admin = _register_user(client, "dash_sysadmin4")
        _assign_role(admin["user_id"], "system_admin", "platform", None)

        org_id = _create_org("Multi-School Org")

        # School 1: 2 teachers, 3 students, 4 sessions (2 completed)
        school1_id = _create_school(org_id, "School One")
        teacher1a_id = _create_user_direct("dash_t1a")
        _assign_role(teacher1a_id, "teacher", "school", str(school1_id))
        teacher1b_id = _create_user_direct("dash_t1b")
        _assign_role(teacher1b_id, "teacher", "school", str(school1_id))

        classroom1 = _create_classroom(school1_id, teacher1a_id, "Class 1A")
        student1_id = _create_user_direct("dash_s1")
        student2_id = _create_user_direct("dash_s2")
        student3_id = _create_user_direct("dash_s3")
        _enroll_student(classroom1, student1_id)
        _enroll_student(classroom1, student2_id)
        _enroll_student(classroom1, student3_id)
        _create_session(student1_id, classroom1, "completed")
        _create_session(student2_id, classroom1, "completed")
        _create_session(student3_id, classroom1, "in_progress")
        _create_session(student1_id, classroom1, "in_progress")

        # School 2: 1 teacher, 1 student, 1 session
        school2_id = _create_school(org_id, "School Two")
        teacher2_id = _create_user_direct("dash_t2")
        _assign_role(teacher2_id, "teacher", "school", str(school2_id))
        classroom2 = _create_classroom(school2_id, teacher2_id, "Class 2A")
        student4_id = _create_user_direct("dash_s4")
        _enroll_student(classroom2, student4_id)
        _create_session(student4_id, classroom2, "completed")

        resp = client.get(
            f"/api/organizations/{org_id}/dashboard",
            headers=auth_header(admin["token"]),
        )
        assert resp.status_code == 200
        data = resp.json()

        assert data["total_schools"] == 2
        assert data["total_teachers"] == 3
        assert data["total_students"] == 4
        assert data["total_sessions"] == 5
        assert data["completed_sessions"] == 3

        stats_by_name = {s["school_name"]: s for s in data["school_stats"]}
        s1 = stats_by_name["School One"]
        assert s1["teacher_count"] == 2
        assert s1["student_count"] == 3
        assert s1["session_count"] == 4

        s2 = stats_by_name["School Two"]
        assert s2["teacher_count"] == 1
        assert s2["student_count"] == 1
        assert s2["session_count"] == 1
