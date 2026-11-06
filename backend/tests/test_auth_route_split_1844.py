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
from fastapi import HTTPException
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
    """A. register defaults every account to student + self-serve teacher
    activation by name (#3804, Young 2026-11-01 — supersedes the original
    "blocks student self-reg + teacher school/role auto-assignment" docstring
    this class had; that whole mechanism -- block_student_self_registration,
    assign_teacher_to_school -- is retired. See PRD
    docs/prd/2026-11-01-school-as-teacher-attribute-prd.md and the full lock
    in tests/test_self_serve_teacher_3804.py)."""

    def test_student_role_hint_is_accepted_not_blocked(self, client):
        """#3804: role="student" is no longer rejected -- every account
        defaults to student anyway, so the hint is simply redundant."""
        resp = client.post("/api/auth/register", json={
            "email": _unique_email(),
            "password": "ValidPass123!",
            "name": "Student Attempt",
            "role": "student",
        })
        assert resp.status_code == 201

    def test_fresh_registration_gets_platform_scoped_student_role(self, client):
        """A fresh account has exactly one role: student, platform-scoped,
        no school -- not a school-scoped teacher role."""
        domain = f"newschool-{secrets.token_hex(4)}.edu.tw"
        email = _unique_email(domain)
        _register_teacher(client, email=email, domain=domain)

        db = TestingSessionLocal()
        try:
            user = db.query(User).filter(User.email == email).first()
            assert user is not None
            roles = db.query(UserRole).filter(UserRole.user_id == user.id, UserRole.is_active.is_(True)).all()
            assert len(roles) == 1
            role = db.query(Role).filter(Role.id == roles[0].role_id).first()
            assert role.name == "student"
            assert roles[0].scope_type == "platform"
        finally:
            db.close()

    def test_registration_creates_no_school(self, client):
        """#3804: registration alone must not auto-create a school for the
        registrant's email domain (the retired issue #459 behavior)."""
        domain = f"roleschool-{secrets.token_hex(4)}.edu.tw"
        email = _unique_email(domain)
        _register_teacher(client, email=email, domain=domain)

        db = TestingSessionLocal()
        try:
            school = db.query(School).filter(School.domain == domain).first()
            assert school is None, "registration must not auto-create a school by domain"
        finally:
            db.close()

    def test_self_activation_by_name_grants_school_scoped_teacher(self, client):
        """Replaces the retired "second teacher, same domain, joins existing
        school" lock: two accounts self-activating with the SAME school NAME
        (not domain) share one school -- see PRD §4.1.1 for the documented
        exact-name-match design this encodes."""
        school_name = f"共用學校_{secrets.token_hex(4)}"
        email1, email2 = _unique_email(), _unique_email()
        t1 = _register_teacher(client, email=email1)
        t2 = _register_teacher(client, email=email2)

        def _activate(email: str) -> int:
            login = client.post("/api/auth/login", json={"email": email, "password": "ValidPass123!"})
            token = login.json()["access_token"]
            resp = client.post(
                "/api/users/me/activate-teacher",
                json={"schools": [{"name": n} for n in ([school_name])]},
                headers={"Authorization": f"Bearer {token}"},
            )
            assert resp.status_code == 200, resp.text
            return resp.json()["schools"][0]["id"]

        school_id_1 = _activate(email1)
        school_id_2 = _activate(email2)
        assert school_id_1 == school_id_2

        db = TestingSessionLocal()
        try:
            schools = db.query(School).filter(School.name == school_name).all()
            assert len(schools) == 1, "activating the same name twice must not create a duplicate school"
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

    def test_reset_password_invalidates_tokens_issued_before_it(self, client):
        """Claude Security find_016vZk1d3wRKkhjQMTUbGU6Y (low, CWE-613):
        the forgot-password/reset-password self-service flow must
        invalidate pre-existing bearer tokens too, same as change-password
        -- not just the reset-token-in-the-URL (that one was already
        proven single-use by test_reset_password_token_cannot_be_reused
        above; this is about the SEPARATE, already-issued login token)."""
        email = _unique_email()
        _register_teacher(client, email=email)

        login_resp = client.post("/api/auth/login", json={
            "email": email, "password": "ValidPass123!",
        })
        assert login_resp.status_code == 200
        old_login_token = login_resp.json()["access_token"]

        fp_resp = client.post("/api/auth/forgot-password", json={"identifier": email})
        reset_token = fp_resp.json().get("reset_token")
        if reset_token is None or reset_token == "account-not-found":
            pytest.skip("reset_token not returned in this env (non-dev mode)")

        reset_resp = client.post("/api/auth/reset-password", json={
            "token": reset_token,
            "new_password": "NewValidPass456!",
        })
        assert reset_resp.status_code == 200

        reused = client.get(
            "/api/users/me", headers={"Authorization": f"Bearer {old_login_token}"}
        )
        assert reused.status_code == 401, (
            "a token minted before the reset must be rejected after it"
        )


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


class TestJunyiLoginDoesNotHijackUnverifiedLocalAccount:
    """Claude Security finding find_01QPThD8PxG5bL5WspBtA6GH (CRITICAL) — CWE-290.

    resolve_junyi_user's "link by email" branch had NO email_verified check
    at all (unlike the Google path, which the #3830 fix already gates on our
    own local User.email_verified — see
    TestGoogleLoginDoesNotHijackUnverifiedLocalAccount in test_google_oauth.py).

    Attack: an anonymous attacker gets a Junyi Academy account whose email
    equals the victim's LingoLeap address (Junyi's API exposes no
    verified-email flag for us to check), or simply self-registers
    victim@example.com via POST /auth/register first (no proof of ownership
    required there, email_verified defaults to False). Either way, the
    lookup-by-email branch in resolve_junyi_user linked junyi_identity_id
    onto that row with no further check and returned an access_token for
    it — full account takeover, including of teacher/system_admin accounts.

    Mirrors the Google fix exactly: only link when the existing LOCAL row's
    email_verified is already True (a state we ourselves verified, via our
    own email-verification flow or an earlier Google/Junyi login) — never on
    the strength of the Junyi-asserted email alone.

    Positive control: test_junyi_login_links_existing_email_no_duplicate
    (above) creates its user with email_verified=True and must keep linking
    normally — proving email_verified, not something else, is what gates
    this.
    """

    def _create_unverified_user_in_db(self, email: str) -> None:
        db = TestingSessionLocal()
        try:
            user = User(
                email=email,
                password_hash=hash_password("AttackerChosenPassword123!"),
                name="Attacker-Controlled Row",
                email_verified=False,
            )
            db.add(user)
            db.commit()
        finally:
            db.close()

    def _get_user(self, email: str):
        db = TestingSessionLocal()
        try:
            return db.query(User).filter(User.email == email).first()
        finally:
            db.close()

    def test_junyi_login_is_refused_for_an_unverified_local_account(self, client):
        email = _unique_email("junyi-hijack.org")
        self._create_unverified_user_in_db(email)

        junyi_user_id = f"junyi_uid_{secrets.token_hex(8)}"
        fake_junyi_payload = {
            "data": {
                "userId": junyi_user_id,
                "userEmail": email,
                "userDisplayName": "Victim Display Name",
            }
        }
        mock_resp = MagicMock()
        mock_resp.status_code = 200
        mock_resp.json.return_value = fake_junyi_payload

        with patch("app.services.sso_login_service.httpx.post", return_value=mock_resp):
            resp = client.post("/api/auth/junyi", json={"code": "fake-junyi-code"})

        assert resp.status_code == 409, resp.text
        assert "access_token" not in resp.json()

    def test_the_unverified_account_is_not_silently_linked_to_the_junyi_id(self, client):
        email = _unique_email("junyi-hijack.org")
        self._create_unverified_user_in_db(email)

        junyi_user_id = f"junyi_uid_{secrets.token_hex(8)}"
        fake_junyi_payload = {
            "data": {
                "userId": junyi_user_id,
                "userEmail": email,
                "userDisplayName": "Victim Display Name",
            }
        }
        mock_resp = MagicMock()
        mock_resp.status_code = 200
        mock_resp.json.return_value = fake_junyi_payload

        with patch("app.services.sso_login_service.httpx.post", return_value=mock_resp):
            client.post("/api/auth/junyi", json={"code": "fake-junyi-code"})

        user = self._get_user(email)
        assert user is not None
        assert user.junyi_identity_id is None
        # the refusal must not have a side effect of flipping verification
        assert user.email_verified is False


class TestJunyiNewAccountIsNotPreVerified:
    """Claude Security find_01QPThD8PxG5bL5WspBtA6GH (critical), recommendation
    part 2: Junyi's token exchange returns userId/userEmail/userDisplayName
    with no verified-email assertion -- unlike Google's id_token, which
    carries a real, cryptographically-verified email claim. A brand-new
    account created purely from a Junyi login must therefore NOT be marked
    email_verified=True, or an attacker with a Junyi identity asserting
    someone else's (never-registered) email could silently pre-create a
    "verified" row under that email, onto which the real owner's later,
    genuinely-verified Google login would then be linked by
    resolve_google_user's own email_verified gate (#3830).
    """

    def _get_user(self, email: str):
        db = TestingSessionLocal()
        try:
            return db.query(User).filter(User.email == email).first()
        finally:
            db.close()

    def test_brand_new_junyi_account_is_not_pre_verified(self, client):
        email = f"junyi_unverified_{secrets.token_hex(6)}@student.junyi.org"
        junyi_user_id = f"junyi_uid_{secrets.token_hex(8)}"
        fake_junyi_payload = {
            "data": {
                "userId": junyi_user_id,
                "userEmail": email,
                "userDisplayName": "Brand New Junyi User",
            }
        }
        mock_resp = MagicMock()
        mock_resp.status_code = 200
        mock_resp.json.return_value = fake_junyi_payload

        with patch("app.services.sso_login_service.httpx.post", return_value=mock_resp):
            resp = client.post("/api/auth/junyi", json={"code": "fake-junyi-code"})

        assert resp.status_code == 200
        assert resp.json().get("is_new_user") is True

        user = self._get_user(email)
        assert user is not None
        assert user.email_verified is False, (
            "a brand-new account created purely from an unverified Junyi "
            "email claim must not read as verified"
        )

    def test_a_later_real_google_login_for_that_email_is_not_silently_linked(self, client):
        """End-to-end: the attack the finding describes, proven closed.

        1. Attacker's Junyi identity asserts victim@example.com, which has
           never been registered on this platform -> a new, UNverified row
           is created (previous test).
        2. The real victim later does a genuine Google login with that
           same, Google-verified email. Before this fix, step 1's row was
           email_verified=True, so resolve_google_user's own #3830 gate
           would have linked the victim's Google identity straight onto
           the attacker-controlled row -- the attacker's `junyi_identity_id`
           stays on an account the victim now believes is theirs. After
           this fix, the row is unverified, so the Google login is refused
           (409) instead of silently merging the victim into it.
        """
        from app.services.sso_login_service import resolve_google_user

        email = f"junyi_then_google_{secrets.token_hex(6)}@example.com"
        junyi_user_id = f"junyi_uid_{secrets.token_hex(8)}"
        fake_junyi_payload = {
            "data": {
                "userId": junyi_user_id,
                "userEmail": email,
                "userDisplayName": "Attacker-Controlled Via Junyi",
            }
        }
        mock_resp = MagicMock()
        mock_resp.status_code = 200
        mock_resp.json.return_value = fake_junyi_payload
        with patch("app.services.sso_login_service.httpx.post", return_value=mock_resp):
            client.post("/api/auth/junyi", json={"code": "fake-junyi-code"})

        pre_link_user = self._get_user(email)
        assert pre_link_user is not None
        assert pre_link_user.junyi_identity_id == junyi_user_id

        db = TestingSessionLocal()
        try:
            with pytest.raises(HTTPException) as exc_info:
                resolve_google_user(
                    db,
                    {
                        "email": email,
                        "email_verified": True,  # Google really did verify this
                        "sub": f"google_sub_{secrets.token_hex(8)}",
                        "name": "Real Victim",
                    },
                )
            assert exc_info.value.status_code == 409
        finally:
            db.close()

        # the attacker's Junyi identity must still be the only thing linked
        after = self._get_user(email)
        assert after.junyi_identity_id == junyi_user_id
