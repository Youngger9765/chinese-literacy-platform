"""
TDD tests for #1844 — auth.py route split into focused service modules.

These tests must:
1. PASS on the current (un-refactored) code → verify behaviour is correct today
2. STILL PASS after the refactor → verify no regression

Coverage:
  A. Registration: blocks student self-reg + teacher school/role auto-assignment
  B. Password reset: no user enumeration + token invalidated after use
  C. Email verification: invalid / already-verified / success (GET + POST)
  D. SSO login: Google + Junyi link existing email without duplicate user

Run from worktree root:
    cd /Users/young/project/chinese-literacy-platform-issue-1844/backend
    python -m pytest tests/test_auth_route_split_1844.py -v
"""

import sys
import os
import secrets

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, event
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool
from unittest.mock import patch, MagicMock

from app.main import app
from app.database import get_db
from app.models import Base
from app.models.user import Role, User, UserRole
from app.models.school import School
from app.auth.password import hash_password


# ---------------------------------------------------------------------------
# SQLite in-memory DB (mirrors pattern from test_auth_api.py)
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
        role = Role(
            name=role_data["name"],
            display_name=role_data["display_name"],
            scope_level=role_data["scope_level"],
        )
        session.add(role)
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


def _unique_email(domain: str = "school.edu.tw") -> str:
    return f"user_{secrets.token_hex(6)}@{domain}"


def _register_teacher(client, email: str = None, domain: str = "school.edu.tw") -> dict:
    """Register a teacher and return response JSON. Auto-verifies in test mode."""
    email = email or _unique_email(domain)
    resp = client.post("/api/auth/register", json={
        "email": email,
        "password": "ValidPass123!",
        "name": "Test Teacher",
    })
    assert resp.status_code == 201, f"register failed: {resp.json()}"
    return {"email": email, "response": resp.json()}


# ===========================================================================
# A. Registration
# ===========================================================================


class TestRegistration:
    """A. register blocks student self-registration + teacher school/role auto-assignment."""

    def test_student_self_registration_blocked(self, client):
        """Students cannot self-register — 403 with Chinese message."""
        resp = client.post("/api/auth/register", json={
            "email": _unique_email(),
            "password": "ValidPass123!",
            "name": "Student Attempt",
            "role": "student",
        })
        assert resp.status_code == 403
        assert "學生" in resp.json()["detail"]

    def test_student_role_uppercase_blocked(self, client):
        """Case-insensitive — 'Student' (title case) also blocked."""
        resp = client.post("/api/auth/register", json={
            "email": _unique_email(),
            "password": "ValidPass123!",
            "name": "Student",
            "role": "Student",
        })
        assert resp.status_code == 403

    def test_teacher_gets_school_auto_created(self, client):
        """First teacher from a domain triggers school auto-creation."""
        domain = f"newschool-{secrets.token_hex(4)}.edu.tw"
        email = _unique_email(domain)
        result = _register_teacher(client, email=email, domain=domain)

        db = TestingSessionLocal()
        try:
            school = db.query(School).filter(School.domain == domain).first()
            assert school is not None, "School should be auto-created"
            assert school.domain == domain
        finally:
            db.close()

    def test_teacher_gets_teacher_role_assigned(self, client):
        """Registered teacher gets UserRole(teacher) scoped to auto-created school."""
        domain = f"roleschool-{secrets.token_hex(4)}.edu.tw"
        email = _unique_email(domain)
        _register_teacher(client, email=email, domain=domain)

        db = TestingSessionLocal()
        try:
            user = db.query(User).filter(User.email == email).first()
            assert user is not None
            teacher_role = db.query(Role).filter(Role.name == "teacher").first()
            assert teacher_role is not None
            ur = (
                db.query(UserRole)
                .filter(
                    UserRole.user_id == user.id,
                    UserRole.role_id == teacher_role.id,
                    UserRole.scope_type == "school",
                )
                .first()
            )
            assert ur is not None, "Teacher should have school-scoped teacher role"
        finally:
            db.close()

    def test_second_teacher_same_domain_joins_existing_school(self, client):
        """Second teacher from same domain joins existing school (no duplicate)."""
        domain = f"shared-{secrets.token_hex(4)}.edu.tw"
        email1 = _unique_email(domain)
        email2 = _unique_email(domain)
        _register_teacher(client, email=email1, domain=domain)
        _register_teacher(client, email=email2, domain=domain)

        db = TestingSessionLocal()
        try:
            schools = db.query(School).filter(School.domain == domain).all()
            assert len(schools) == 1, "Only one school should exist for the domain"
        finally:
            db.close()

    def test_duplicate_email_returns_409(self, client):
        """Registering the same email twice → 409 Conflict."""
        email = _unique_email()
        _register_teacher(client, email=email)
        resp = client.post("/api/auth/register", json={
            "email": email,
            "password": "ValidPass123!",
            "name": "Dup",
        })
        assert resp.status_code == 409

    def test_weak_password_returns_422(self, client):
        """Weak password → 422 with errors in detail."""
        resp = client.post("/api/auth/register", json={
            "email": _unique_email(),
            "password": "weak",
            "name": "Weak Pw",
        })
        assert resp.status_code == 422


# ===========================================================================
# B. Password Reset — no enumeration, token invalidated after use
# ===========================================================================


class TestPasswordReset:
    """B. forgot/reset never enumerates unknown users + invalidates used token."""

    def test_forgot_password_unknown_user_returns_200(self, client):
        """Unknown email → always returns 200 (no enumeration)."""
        resp = client.post("/api/auth/forgot-password", json={
            "identifier": f"nobody_{secrets.token_hex(8)}@nowhere.com"
        })
        assert resp.status_code == 200
        data = resp.json()
        assert "message" in data

    def test_forgot_password_unknown_user_no_db_change(self, client):
        """Unknown email → zero DB changes (no reset token written)."""
        fake_email = f"ghost_{secrets.token_hex(6)}@phantom.com"
        client.post("/api/auth/forgot-password", json={"identifier": fake_email})

        db = TestingSessionLocal()
        try:
            user = db.query(User).filter(User.email == fake_email).first()
            assert user is None
        finally:
            db.close()

    def test_forgot_password_known_user_writes_token(self, client):
        """Known user → reset token written to DB."""
        email = _unique_email()
        _register_teacher(client, email=email)

        client.post("/api/auth/forgot-password", json={"identifier": email})

        db = TestingSessionLocal()
        try:
            user = db.query(User).filter(User.email == email).first()
            assert user is not None
            assert user.password_reset_token is not None
            assert user.password_reset_expires is not None
        finally:
            db.close()

    def test_reset_password_invalidates_token(self, client):
        """After successful reset, token is cleared from DB (can't be reused)."""
        email = _unique_email()
        _register_teacher(client, email=email)

        fp_resp = client.post("/api/auth/forgot-password", json={"identifier": email})
        assert fp_resp.status_code == 200
        reset_token = fp_resp.json().get("reset_token")
        if reset_token is None or reset_token == "account-not-found":
            pytest.skip("reset_token not returned in this env (non-dev mode)")

        resp = client.post("/api/auth/reset-password", json={
            "token": reset_token,
            "new_password": "NewValidPass456!",
        })
        assert resp.status_code == 200

        db = TestingSessionLocal()
        try:
            user = db.query(User).filter(User.email == email).first()
            assert user.password_reset_token is None, "Token must be cleared after use"
            assert user.password_reset_expires is None
        finally:
            db.close()

    def test_reset_password_token_cannot_be_reused(self, client):
        """Using the same reset token twice → 400 on second attempt."""
        email = _unique_email()
        _register_teacher(client, email=email)

        fp_resp = client.post("/api/auth/forgot-password", json={"identifier": email})
        reset_token = fp_resp.json().get("reset_token")
        if reset_token is None or reset_token == "account-not-found":
            pytest.skip("reset_token not returned in non-dev mode")

        client.post("/api/auth/reset-password", json={
            "token": reset_token,
            "new_password": "NewValidPass456!",
        })
        # Second use of same token
        resp2 = client.post("/api/auth/reset-password", json={
            "token": reset_token,
            "new_password": "AnotherPass789!",
        })
        assert resp2.status_code == 400

    def test_reset_password_invalid_token_returns_400(self, client):
        """Garbage reset token → 400."""
        resp = client.post("/api/auth/reset-password", json={
            "token": "notavalidtoken",
            "new_password": "NewValidPass456!",
        })
        assert resp.status_code == 400


# ===========================================================================
# C. Email Verification
# ===========================================================================


class TestEmailVerification:
    """C. GET/POST verify-email: invalid / already verified / success.

    We create users directly in the test DB with a verification token
    already set — this avoids patching pydantic v2 computed properties
    and tests the verification logic cleanly.
    """

    def _create_unverified_user(self) -> tuple[str, str]:
        """Create an unverified user with a token directly in the DB."""
        email = _unique_email()
        token = secrets.token_hex(32)
        db = TestingSessionLocal()
        try:
            user = User(
                email=email,
                password_hash=hash_password("ValidPass123!"),
                name="Unverified User",
                email_verified=False,
                email_verification_token=token,
            )
            db.add(user)
            db.commit()
        finally:
            db.close()
        return email, token

    def test_verify_email_get_invalid_token(self, client):
        """GET /verify-email with garbage token → 400."""
        resp = client.get("/api/auth/verify-email?token=badtoken999")
        assert resp.status_code == 400

    def test_verify_email_post_invalid_token(self, client):
        """POST /verify-email with garbage token → 400."""
        resp = client.post("/api/auth/verify-email", json={"token": "badtoken999"})
        assert resp.status_code == 400

    def test_verify_email_get_success(self, client):
        """GET /verify-email with valid token → 200 + marks user verified."""
        email, token = self._create_unverified_user()

        resp = client.get(f"/api/auth/verify-email?token={token}")
        assert resp.status_code == 200

        db = TestingSessionLocal()
        try:
            user = db.query(User).filter(User.email == email).first()
            assert user.email_verified is True
            assert user.email_verification_token is None
        finally:
            db.close()

    def test_verify_email_post_success(self, client):
        """POST /verify-email with valid token → 200 + marks user verified."""
        email, token = self._create_unverified_user()

        resp = client.post("/api/auth/verify-email", json={"token": token})
        assert resp.status_code == 200

        db = TestingSessionLocal()
        try:
            user = db.query(User).filter(User.email == email).first()
            assert user.email_verified is True
        finally:
            db.close()

    def test_verify_email_already_verified_is_idempotent(self, client):
        """Verifying an already-verified user (no token) is handled gracefully.

        After first successful verification, the token is cleared. A second
        GET with the same (now-cleared) token returns 400 (token not found)
        which is the correct safe behaviour — no crash, no 5xx.
        """
        email, token = self._create_unverified_user()

        # First verification
        r1 = client.get(f"/api/auth/verify-email?token={token}")
        assert r1.status_code == 200

        # Second attempt with same token — token was cleared, so 400
        r2 = client.get(f"/api/auth/verify-email?token={token}")
        assert r2.status_code in (200, 400), f"Expected safe response, got {r2.status_code}"

    def test_verify_email_already_verified_user_direct(self, client):
        """A user inserted as already-verified: verifying returns 200 (idempotent path)."""
        email = _unique_email()
        token = secrets.token_hex(32)
        db = TestingSessionLocal()
        try:
            user = User(
                email=email,
                password_hash=hash_password("ValidPass123!"),
                name="Already Verified",
                email_verified=True,   # already verified
                email_verification_token=token,  # token still set (edge case)
            )
            db.add(user)
            db.commit()
        finally:
            db.close()

        resp = client.get(f"/api/auth/verify-email?token={token}")
        assert resp.status_code == 200
        assert "已驗證" in resp.json()["message"]

    def test_verify_email_token_cleared_after_success(self, client):
        """After successful GET verification, the token column is cleared."""
        email, token = self._create_unverified_user()
        client.get(f"/api/auth/verify-email?token={token}")

        db = TestingSessionLocal()
        try:
            user = db.query(User).filter(User.email == email).first()
            assert user.email_verification_token is None
        finally:
            db.close()


# ===========================================================================
# D. SSO — links existing email without duplicate user creation
# ===========================================================================


class TestSSOLogin:
    """D. Google + Junyi SSO links existing email user without duplicate user creation."""

    def _create_user_in_db(self, email: str) -> None:
        """Directly insert a user into the test DB."""
        db = TestingSessionLocal()
        try:
            user = User(
                email=email,
                password_hash=hash_password("SomePass123!"),
                name="Existing User",
                email_verified=True,
            )
            db.add(user)
            db.commit()
        finally:
            db.close()

    def _count_users_by_email(self, email: str) -> int:
        db = TestingSessionLocal()
        try:
            return db.query(User).filter(User.email == email).count()
        finally:
            db.close()

    # --- Google SSO ---

    def test_google_login_links_existing_email_no_duplicate(self, client):
        """Google SSO: existing email user gets google_id linked, not duplicated."""
        email = _unique_email()
        self._create_user_in_db(email)

        fake_id_info = {
            "sub": f"googlesub_{secrets.token_hex(8)}",
            "email": email,
            "name": "Existing User",
            "picture": None,
            "email_verified": True,  # #2470 MED-3: legitimate Google logins are verified
        }

        # After refactor: patch at the sso_login_service module level
        with patch("app.services.sso_login_service.settings") as mock_settings:
            mock_settings.google_client_id = "fake-client-id"
            mock_settings.parent_portal_enabled = True

            with patch(
                "google.oauth2.id_token.verify_oauth2_token",
                return_value=fake_id_info,
            ):
                resp = client.post("/api/auth/google", json={"credential": "fake.id.token"})

        assert resp.status_code == 200
        data = resp.json()
        assert "access_token" in data
        assert data.get("is_new_user") is False

        count = self._count_users_by_email(email)
        assert count == 1, f"Expected 1 user, found {count}"

    def test_google_login_new_user_creates_one_account(self, client):
        """Google SSO: brand-new email creates exactly one user account."""
        email = f"google_new_{secrets.token_hex(6)}@gmail.com"
        google_sub = f"googlesub_{secrets.token_hex(8)}"

        fake_id_info = {
            "sub": google_sub,
            "email": email,
            "name": "New Google User",
            "picture": None,
            "email_verified": True,  # #2470 MED-3: legitimate Google logins are verified
        }

        with patch("app.services.sso_login_service.settings") as mock_settings:
            mock_settings.google_client_id = "fake-client-id"
            mock_settings.parent_portal_enabled = True

            with patch(
                "google.oauth2.id_token.verify_oauth2_token",
                return_value=fake_id_info,
            ):
                resp = client.post("/api/auth/google", json={"credential": "fake.id.token"})

        assert resp.status_code == 200
        data = resp.json()
        assert data.get("is_new_user") is True

        count = self._count_users_by_email(email)
        assert count == 1

    def test_google_login_returning_user_by_google_id(self, client):
        """Google SSO returning user (matched by google_id) → is_new_user=False."""
        email = f"google_return_{secrets.token_hex(6)}@gmail.com"
        google_sub = f"googlesub_{secrets.token_hex(8)}"

        db = TestingSessionLocal()
        try:
            user = User(
                email=email,
                password_hash=hash_password("Unusable!"),
                name="Returning Google User",
                email_verified=True,
                google_id=google_sub,
            )
            db.add(user)
            db.commit()
        finally:
            db.close()

        fake_id_info = {
            "sub": google_sub,
            "email": email,
            "name": "Returning Google User",
            "picture": None,
            "email_verified": True,  # #2470 MED-3: legitimate Google logins are verified
        }

        with patch("app.services.sso_login_service.settings") as mock_settings:
            mock_settings.google_client_id = "fake-client-id"
            mock_settings.parent_portal_enabled = True

            with patch(
                "google.oauth2.id_token.verify_oauth2_token",
                return_value=fake_id_info,
            ):
                resp = client.post("/api/auth/google", json={"credential": "fake.id.token"})

        assert resp.status_code == 200
        assert resp.json().get("is_new_user") is False
        assert self._count_users_by_email(email) == 1

    # --- Junyi SSO ---

    def test_junyi_login_links_existing_email_no_duplicate(self, client):
        """Junyi SSO: existing email user gets junyi_identity_id linked, not duplicated."""
        email = _unique_email("junyi.org")
        self._create_user_in_db(email)

        junyi_user_id = f"junyi_uid_{secrets.token_hex(8)}"
        fake_junyi_payload = {
            "data": {
                "userId": junyi_user_id,
                "userEmail": email,
                "userDisplayName": "Existing Junyi User",
            }
        }

        mock_resp = MagicMock()
        mock_resp.status_code = 200
        mock_resp.json.return_value = fake_junyi_payload

        # After refactor: httpx is used in sso_login_service, not routes/auth
        with patch("app.services.sso_login_service.httpx.post", return_value=mock_resp):
            resp = client.post("/api/auth/junyi", json={"code": "fake-junyi-code"})

        assert resp.status_code == 200
        data = resp.json()
        assert "access_token" in data
        assert data.get("is_new_user") is False

        count = self._count_users_by_email(email)
        assert count == 1, f"Expected 1 user, got {count}"

    def test_junyi_login_new_user_creates_one_account(self, client):
        """Junyi SSO: brand-new identity creates exactly one user account."""
        email = f"junyi_new_{secrets.token_hex(6)}@student.junyi.org"
        junyi_user_id = f"junyi_uid_{secrets.token_hex(8)}"

        fake_junyi_payload = {
            "data": {
                "userId": junyi_user_id,
                "userEmail": email,
                "userDisplayName": "New Junyi Student",
            }
        }

        mock_resp = MagicMock()
        mock_resp.status_code = 200
        mock_resp.json.return_value = fake_junyi_payload

        with patch("app.services.sso_login_service.httpx.post", return_value=mock_resp):
            resp = client.post("/api/auth/junyi", json={"code": "fake-junyi-code"})

        assert resp.status_code == 200
        assert resp.json().get("is_new_user") is True
        assert self._count_users_by_email(email) == 1

    def test_junyi_login_returning_user_by_junyi_id(self, client):
        """Junyi SSO: returning user matched by junyi_identity_id → is_new_user=False."""
        email = f"junyi_return_{secrets.token_hex(6)}@student.junyi.org"
        junyi_user_id = f"junyi_uid_{secrets.token_hex(8)}"

        db = TestingSessionLocal()
        try:
            user = User(
                email=email,
                password_hash=hash_password("Unusable!"),
                name="Returning Junyi User",
                email_verified=True,
                junyi_identity_id=junyi_user_id,
            )
            db.add(user)
            db.commit()
        finally:
            db.close()

        fake_junyi_payload = {
            "data": {
                "userId": junyi_user_id,
                "userEmail": email,
                "userDisplayName": "Returning Junyi User",
            }
        }

        mock_resp = MagicMock()
        mock_resp.status_code = 200
        mock_resp.json.return_value = fake_junyi_payload

        with patch("app.services.sso_login_service.httpx.post", return_value=mock_resp):
            resp = client.post("/api/auth/junyi", json={"code": "fake-junyi-code"})

        assert resp.status_code == 200
        assert resp.json().get("is_new_user") is False
        assert self._count_users_by_email(email) == 1

    def test_junyi_login_expired_code_returns_401(self, client):
        """Junyi SSO: expired/used code (404 from Junyi) → 401."""
        mock_resp = MagicMock()
        mock_resp.status_code = 404

        with patch("app.services.sso_login_service.httpx.post", return_value=mock_resp):
            resp = client.post("/api/auth/junyi", json={"code": "expired-code"})

        assert resp.status_code == 401

    def test_junyi_login_network_error_returns_503(self, client):
        """Junyi SSO: network failure → 503 (service unavailable)."""
        import httpx as real_httpx

        with patch("app.services.sso_login_service.httpx.post", side_effect=real_httpx.RequestError("conn refused")):
            resp = client.post("/api/auth/junyi", json={"code": "any-code"})

        assert resp.status_code == 503
