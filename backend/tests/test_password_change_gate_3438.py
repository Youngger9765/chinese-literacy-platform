"""
Tests for backend-enforced forced-password-change gate (#3438).

Background: #3412/#3415 fixed a *frontend* route-guard ordering bug, but a
security review found the forced-password-change step had no backend
enforcement at all -- `must_change_password` was computed once at
POST /auth/login and never checked again. A student holding a teacher-issued
password (printed on a one-time credential card, or freshly reset) could call
any of the ~127 endpoints that depend on `get_current_user` directly with that
token, bypassing the frontend redirect to /change-password entirely.

This file locks three things, each confirmed RED against the pre-fix code:
  1. GET /api/users/me now reports `must_change_password` (previously absent
     from the schema entirely -- the frontend had no authoritative source).
  2. `get_current_user` itself blocks every endpoint except
     POST /auth/change-password and GET /users/me with 403 while a student's
     password change is pending -- a genuine backend gate, not a frontend
     redirect a client can simply not follow.
  3. The SAME token regains access immediately after a successful password
     change (no new login required) -- the gate reads live data, not a
     stale claim baked into the token at issue time.

Teachers and admins (no `student_profile`) are a positive control: never
gated, confirmed explicitly.

Run with:
    cd backend && python -m pytest tests/test_password_change_gate_3438.py -q
"""

import os
import sys
import uuid

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, event
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.database import get_db
from app.main import app
from app.models import Base
from app.models.organization import Organization
from app.models.school import ClassroomStudent, School
from app.models.user import Role, StudentProfile, User, UserRole


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
    {"name": "org_admin", "display_name": "Org Admin", "scope_level": "organization"},
    {"name": "org_owner", "display_name": "Org Owner", "scope_level": "organization"},
    {"name": "teacher", "display_name": "Teacher", "scope_level": "school"},
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


def _reset_rate_limiters() -> None:
    try:
        from app.routes.auth import rate_limiter

        rate_limiter.reset()
    except (ImportError, AttributeError):
        pass
    try:
        from app.auth.rate_limiter import general_rate_limiter

        general_rate_limiter.reset()
    except (ImportError, AttributeError):
        pass


def _register_user(client, suffix: str) -> dict:
    """Register + verify a normal account (default role is 'teacher')."""
    unique = uuid.uuid4().hex[:8]
    email = f"{suffix}_{unique}@example.com"
    password = "TestOnlyPassword123!"
    resp = client.post(
        "/api/auth/register",
        json={"email": email, "password": password, "name": f"{suffix.title()} {unique}"},
    )
    assert resp.status_code == 201, resp.text

    verification_token = resp.json().get("verification_token")
    if verification_token:
        verify_resp = client.get(f"/api/auth/verify-email?token={verification_token}")
        assert verify_resp.status_code == 200

    _reset_rate_limiters()
    login_resp = client.post("/api/auth/login", json={"email": email, "password": password})
    assert login_resp.status_code == 200, login_resp.text
    token = login_resp.json()["access_token"]
    me_resp = client.get("/api/users/me", headers=auth_header(token))
    assert me_resp.status_code == 200
    return {"email": email, "token": token, "user_id": me_resp.json()["id"], "password": password}


def _create_org_and_school(org_id: str) -> int:
    db = TestingSessionLocal()
    try:
        if db.query(Organization).filter(Organization.id == org_id).first() is None:
            db.add(Organization(id=org_id, name=f"Org {org_id} {uuid.uuid4().hex[:6]}"))
            db.commit()
        school = School(name=f"School {org_id} {uuid.uuid4().hex[:6]}", organization_id=org_id)
        db.add(school)
        db.commit()
        db.refresh(school)
        return school.id
    finally:
        db.close()


def _assign_role(user_id: int, role_name: str, *, scope_type: str, scope_id: str | None = None) -> None:
    db = TestingSessionLocal()
    try:
        role = db.query(Role).filter(Role.name == role_name).first()
        assert role is not None
        if role_name == "student":
            teacher_role = db.query(Role).filter(Role.name == "teacher").first()
            assert teacher_role is not None
            (
                db.query(UserRole)
                .filter(
                    UserRole.user_id == user_id,
                    UserRole.role_id == teacher_role.id,
                    UserRole.is_active.is_(True),
                )
                .update({UserRole.is_active: False}, synchronize_session=False)
            )
        db.add(
            UserRole(
                user_id=user_id,
                role_id=role.id,
                scope_type=scope_type,
                scope_id=scope_id,
            )
        )
        db.commit()
    finally:
        db.close()


def _make_admin(user_id: int) -> None:
    _assign_role(user_id, "system_admin", scope_type="platform", scope_id=None)


def _create_pending_student(client, suffix: str) -> dict:
    """Create a student whose teacher-issued password has never been changed.

    Mirrors what classroom_password.reset_student_password / the batch-create
    flow produce: a real User + StudentProfile(password_changed=False), with
    a password we know (so we can log in), gated via the real /auth/login
    endpoint exactly like the client would.
    """
    unique = uuid.uuid4().hex[:8]
    email = f"{suffix}_{unique}@student.lingoleap.local"
    password = "TeacherIssuedPw1"
    school_id = _create_org_and_school(f"org-{unique}")

    db = TestingSessionLocal()
    try:
        from app.auth.password import hash_password

        user = User(
            email=email,
            password_hash=hash_password(password),
            name=f"{suffix.title()} {unique}",
            is_active=True,
            email_verified=True,
        )
        db.add(user)
        db.flush()
        db.add(StudentProfile(user_id=user.id, school_id=school_id, student_number=None, password_changed=False))
        db.commit()
        user_id = user.id
    finally:
        db.close()

    _assign_role(user_id, "student", scope_type="school", scope_id=str(school_id))

    _reset_rate_limiters()
    login_resp = client.post("/api/auth/login", json={"email": email, "password": password})
    assert login_resp.status_code == 200, login_resp.text
    body = login_resp.json()
    return {
        "email": email,
        "token": body["access_token"],
        "user_id": user_id,
        "password": password,
        "login_body": body,
    }


# ===========================================================================
# must_change_password surfaced on the authoritative sources
# ===========================================================================


class TestMustChangePasswordSurfaced:
    def test_login_response_flags_pending_change(self, client):
        student = _create_pending_student(client, "gate_login")
        assert student["login_body"]["must_change_password"] is True

    def test_users_me_reflects_pending_change(self, client):
        """#3438: GET /users/me must expose must_change_password -- this is
        the ONLY source AuthContext trusts after the initial login (page
        reload, new tab, background refresh all go through here, not login).
        """
        student = _create_pending_student(client, "gate_me")
        resp = client.get("/api/users/me", headers=auth_header(student["token"]))
        assert resp.status_code == 200
        assert resp.json()["must_change_password"] is True

    def test_users_me_reflects_already_changed(self, client, teacher=None):
        """A normal (non-pending) account must show must_change_password=False,
        not just omit the field -- a missing/undefined field is exactly the
        ambiguity the frontend fail-closed rule exists to avoid.
        """
        teacher = _register_user(client, "gate_normal")
        resp = client.get("/api/users/me", headers=auth_header(teacher["token"]))
        assert resp.status_code == 200
        assert resp.json()["must_change_password"] is False


# ===========================================================================
# Backend enforcement -- the real gate, not a frontend redirect
# ===========================================================================


class TestBackendEnforcement:
    def test_blocked_endpoint_returns_403_with_clear_code_while_pending(self, client):
        """#3438 core fix: any authenticated endpoint other than the two
        exempt ones must reject a pending-password-change token with 403 and
        an identifiable code -- not silently serve real data.

        POST /auth/complete-onboarding is a good probe: it requires nothing
        but get_current_user (no role check), so a 403 here can only be this
        gate, never incidental RBAC.
        """
        student = _create_pending_student(client, "gate_blocked")
        resp = client.post(
            "/api/auth/complete-onboarding",
            headers=auth_header(student["token"]),
        )
        assert resp.status_code == 403, resp.text
        detail = resp.json()["detail"]
        detail_text = detail if isinstance(detail, str) else detail.get("code", "")
        assert "PASSWORD_CHANGE_REQUIRED" in detail_text

    def test_patch_users_me_is_blocked_even_though_get_is_exempt(self, client):
        """The exemption is GET /users/me specifically (read-only, so the
        frontend can render the gate state) -- PATCH is a write and must
        still be blocked.
        """
        student = _create_pending_student(client, "gate_patch")
        resp = client.patch(
            "/api/users/me",
            json={"name": "Should Not Apply"},
            headers=auth_header(student["token"]),
        )
        assert resp.status_code == 403, resp.text

    def test_get_users_me_is_exempt_while_pending(self, client):
        student = _create_pending_student(client, "gate_me_exempt")
        resp = client.get("/api/users/me", headers=auth_header(student["token"]))
        assert resp.status_code == 200

    def test_change_password_endpoint_itself_is_reachable_while_pending(self, client):
        """The one write endpoint that must NOT be blocked -- otherwise a
        pending student could never escape the gate at all.
        """
        student = _create_pending_student(client, "gate_change_reachable")
        resp = client.post(
            "/api/auth/change-password",
            json={"old_password": student["password"], "new_password": "BrandNewPassword456"},
            headers=auth_header(student["token"]),
        )
        assert resp.status_code == 200, resp.text

    def test_same_token_regains_access_immediately_after_change(self, client):
        """#3438 explicit AC: live data, not a stale claim baked into the
        token -- no new login should be required.
        """
        student = _create_pending_student(client, "gate_recover")

        blocked = client.post(
            "/api/auth/complete-onboarding",
            headers=auth_header(student["token"]),
        )
        assert blocked.status_code == 403

        change_resp = client.post(
            "/api/auth/change-password",
            json={"old_password": student["password"], "new_password": "BrandNewPassword789"},
            headers=auth_header(student["token"]),
        )
        assert change_resp.status_code == 200, change_resp.text

        # SAME token, no new /auth/login call.
        after = client.post(
            "/api/auth/complete-onboarding",
            headers=auth_header(student["token"]),
        )
        assert after.status_code == 200, after.text

        me_after = client.get("/api/users/me", headers=auth_header(student["token"]))
        assert me_after.json()["must_change_password"] is False


# ===========================================================================
# Positive control -- teachers/admins are never gated
# ===========================================================================


class TestNonStudentsNeverGated:
    def test_teacher_account_never_gated(self, client):
        teacher = _register_user(client, "gate_teacher_control")
        resp = client.post(
            "/api/auth/complete-onboarding",
            headers=auth_header(teacher["token"]),
        )
        assert resp.status_code == 200, resp.text

    def test_admin_account_never_gated(self, client):
        admin = _register_user(client, "gate_admin_control")
        _make_admin(admin["user_id"])
        resp = client.post(
            "/api/auth/complete-onboarding",
            headers=auth_header(admin["token"]),
        )
        assert resp.status_code == 200, resp.text
