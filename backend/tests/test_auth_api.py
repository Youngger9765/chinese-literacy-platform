"""
Tests for the auth and user APIs.

Covers:
- POST /api/auth/register
- POST /api/auth/login
- POST /api/auth/change-password
- GET  /api/users/me
- Unit tests for password hashing and JWT token creation/decoding

Uses SQLite in-memory DB to avoid any external dependency.

Run with:
    cd /Users/young/project/chinese-literacy-platform-issue-223/backend
    python -m pytest tests/test_auth_api.py -v
"""

import sys
import os
import time
import uuid
from datetime import datetime, timedelta, timezone

# Allow running pytest from the repo root or from backend/
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import jwt
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, event
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.main import app
from app.database import get_db
from app.models import Base
from app.models.user import Role, User, UserRole
from app.auth.password import hash_password, verify_password
from app.auth.jwt import create_access_token, decode_token
from app.config import settings


# ---------------------------------------------------------------------------
# Test database setup (SQLite in-memory with StaticPool)
# ---------------------------------------------------------------------------

# StaticPool ensures all connections share the same underlying SQLite DB,
# which is required because SQLite in-memory databases are per-connection.
engine = create_engine(
    "sqlite://",
    connect_args={"check_same_thread": False},
    poolclass=StaticPool,
)


# SQLite does not enforce FK constraints by default; enable them.
@event.listens_for(engine, "connect")
def _set_sqlite_pragma(dbapi_connection, connection_record):
    cursor = dbapi_connection.cursor()
    cursor.execute("PRAGMA foreign_keys=ON")
    cursor.close()


TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

# The 8 seed roles matching the production migration data.
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
    """Insert seed roles so role-related queries work."""
    for role_data in SEED_ROLES:
        role = Role(
            name=role_data["name"],
            display_name=role_data["display_name"],
            scope_level=role_data["scope_level"],
        )
        session.add(role)
    session.commit()


def _override_get_db():
    """Dependency override that yields a test DB session."""
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
    """Create all tables once, seed roles, override get_db, and clean up at end."""
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
    """Synchronous TestClient — DB override is set by setup_db."""
    with TestClient(app) as c:
        yield c


@pytest.fixture()
def registered_user(client):
    """Register a fresh user and return (email, password, token).

    Updated for issue #460 config flag:
    - When REQUIRE_EMAIL_VERIFICATION=False (default): registration auto-verifies,
      no token in response, login works immediately.
    - When REQUIRE_EMAIL_VERIFICATION=True: uses the dev-mode verification_token
      to verify before login.
    """
    import uuid
    unique = uuid.uuid4().hex[:8]
    email = f"testuser_{unique}@example.com"
    password = "SecurePass123!"
    name = f"Test User {unique}"
    resp = client.post("/api/auth/register", json={
        "email": email,
        "password": password,
        "name": name,
    })
    assert resp.status_code == 201
    # Only verify via token when REQUIRE_EMAIL_VERIFICATION=True (token will be non-None).
    # When the flag is off, email is auto-verified and token is None.
    verification_token = resp.json().get("verification_token")
    if verification_token is not None:
        verify_resp = client.get(f"/api/auth/verify-email?token={verification_token}")
        assert verify_resp.status_code == 200
    # Now login to get a JWT token
    login_resp = client.post("/api/auth/login", json={"email": email, "password": password})
    assert login_resp.status_code == 200
    token = login_resp.json()["access_token"]
    return {"email": email, "password": password, "name": name, "token": token}


def auth_header(token: str) -> dict:
    """Build an Authorization header dict."""
    return {"Authorization": f"Bearer {token}"}


def _assign_role_to_user(email: str, role_name: str) -> None:
    """Assign an active role to a user in the test database."""
    db = TestingSessionLocal()
    try:
        user = db.query(User).filter(User.email == email).first()
        assert user is not None
        role = db.query(Role).filter(Role.name == role_name).first()
        assert role is not None
        existing = (
            db.query(UserRole)
            .filter(
                UserRole.user_id == user.id,
                UserRole.role_id == role.id,
                UserRole.is_active == True,
            )
            .first()
        )
        if existing is None:
            db.add(UserRole(user_id=user.id, role_id=role.id, scope_type="platform"))
            db.commit()
    finally:
        db.close()


# ===========================================================================
# Unit tests — password hashing
# ===========================================================================


class TestPasswordHashing:
    def test_hash_returns_string(self):
        hashed = hash_password("mypassword")
        assert isinstance(hashed, str)

    def test_hash_is_not_plaintext(self):
        plain = "mypassword"
        hashed = hash_password(plain)
        assert hashed != plain

    def test_verify_correct_password(self):
        plain = "correcthorse"
        hashed = hash_password(plain)
        assert verify_password(plain, hashed) is True

    def test_verify_wrong_password(self):
        hashed = hash_password("correcthorse")
        assert verify_password("wronghorse", hashed) is False

    def test_different_hashes_for_same_password(self):
        """bcrypt uses a random salt, so two hashes of the same input differ."""
        h1 = hash_password("samepass")
        h2 = hash_password("samepass")
        assert h1 != h2

    def test_both_verify_against_same_plaintext(self):
        plain = "samepass"
        h1 = hash_password(plain)
        h2 = hash_password(plain)
        assert verify_password(plain, h1) is True
        assert verify_password(plain, h2) is True

    def test_hash_handles_unicode(self):
        plain = "密碼測試🔑"
        hashed = hash_password(plain)
        assert verify_password(plain, hashed) is True

    def test_empty_string_password(self):
        hashed = hash_password("")
        assert verify_password("", hashed) is True
        assert verify_password("notempty", hashed) is False


# ===========================================================================
# Unit tests — JWT create / decode
# ===========================================================================


class TestJWTTokens:
    def test_create_returns_string(self):
        token = create_access_token(user_id=1)
        assert isinstance(token, str)

    def test_decode_returns_payload(self):
        token = create_access_token(user_id=42)
        payload = decode_token(token)
        assert payload["sub"] == "42"

    def test_payload_has_exp_and_iat(self):
        token = create_access_token(user_id=1)
        payload = decode_token(token)
        assert "exp" in payload
        assert "iat" in payload

    def test_sub_is_string_of_user_id(self):
        token = create_access_token(user_id=999)
        payload = decode_token(token)
        assert payload["sub"] == "999"

    def test_expired_token_raises(self):
        """Manually create an already-expired token and ensure decode raises."""
        expired_payload = {
            "sub": "1",
            "exp": datetime.now(timezone.utc) - timedelta(seconds=10),
            "iat": datetime.now(timezone.utc) - timedelta(hours=1),
        }
        token = jwt.encode(
            expired_payload, settings.jwt_secret_key, algorithm=settings.jwt_algorithm
        )
        with pytest.raises(jwt.ExpiredSignatureError):
            decode_token(token)

    def test_invalid_token_raises(self):
        with pytest.raises(jwt.InvalidTokenError):
            decode_token("not.a.valid.token")

    def test_tampered_token_raises(self):
        token = create_access_token(user_id=1)
        tampered = token[:-4] + "XXXX"
        with pytest.raises(jwt.InvalidTokenError):
            decode_token(tampered)

    def test_wrong_secret_raises(self):
        payload = {
            "sub": "1",
            "exp": datetime.now(timezone.utc) + timedelta(hours=1),
            "iat": datetime.now(timezone.utc),
        }
        token = jwt.encode(payload, "wrong-secret-key", algorithm=settings.jwt_algorithm)
        with pytest.raises(jwt.InvalidTokenError):
            decode_token(token)

    def test_token_expiry_is_in_the_future(self):
        token = create_access_token(user_id=1)
        payload = decode_token(token)
        exp = datetime.fromtimestamp(payload["exp"], tz=timezone.utc)
        assert exp > datetime.now(timezone.utc)


# ===========================================================================
# Integration tests — POST /api/auth/register
# ===========================================================================


class TestRegisterEndpoint:
    def test_register_returns_201(self, client):
        resp = client.post("/api/auth/register", json={
            "email": "newuser@example.com",
            "password": "StrongPass1!",
            "name": "New User",
        })
        assert resp.status_code == 201

    def test_register_returns_message(self, client):
        """Issue #460: register now returns a message + verification_token (dev mode)."""
        resp = client.post("/api/auth/register", json={
            "email": "tokenuser@example.com",
            "password": "StrongPass1!",
            "name": "Token User",
        })
        data = resp.json()
        assert "message" in data
        assert isinstance(data["message"], str)
        assert len(data["message"]) > 0

    def test_register_returns_verification_token_when_flag_on(self, client):
        """Issue #460: verification_token is returned in the response only when
        REQUIRE_EMAIL_VERIFICATION=True (dev/staging mode for testability)."""
        from unittest.mock import patch
        from app.config import settings

        with patch.object(settings, "require_email_verification", True):
            resp = client.post("/api/auth/register", json={
                "email": "beareruser_flagtest@example.com",
                "password": "StrongPass1!",
                "name": "Bearer Flag User",
            })
        data = resp.json()
        assert "verification_token" in data
        assert data["verification_token"] is not None
        assert len(data["verification_token"]) > 0

    def test_register_returns_no_verification_token_when_flag_off(self, client):
        """Issue #460: when REQUIRE_EMAIL_VERIFICATION=False (default),
        registration auto-verifies and returns no verification_token."""
        resp = client.post("/api/auth/register", json={
            "email": "beareruser@example.com",
            "password": "StrongPass1!",
            "name": "Bearer User",
        })
        data = resp.json()
        assert "verification_token" in data
        assert data["verification_token"] is None

    def test_register_does_not_return_access_token(self, client):
        """Issue #460: register no longer auto-logs in — no access_token in response."""
        resp = client.post("/api/auth/register", json={
            "email": "decodable@example.com",
            "password": "StrongPass1!",
            "name": "Decodable User",
        })
        data = resp.json()
        assert "access_token" not in data

    def test_register_duplicate_email_returns_409(self, client):
        payload = {
            "email": "duplicate@example.com",
            "password": "StrongPass1!",
            "name": "First User",
        }
        resp1 = client.post("/api/auth/register", json=payload)
        assert resp1.status_code == 201

        resp2 = client.post("/api/auth/register", json={
            "email": "duplicate@example.com",
            "password": "DifferentPass1!",
            "name": "Second User",
        })
        assert resp2.status_code == 409

    def test_register_duplicate_email_error_message(self, client):
        # Use a unique email for first registration
        client.post("/api/auth/register", json={
            "email": "dup_msg@example.com",
            "password": "StrongPass1!",
            "name": "First",
        })
        resp = client.post("/api/auth/register", json={
            "email": "dup_msg@example.com",
            "password": "StrongPass1!",
            "name": "Second",
        })
        assert resp.json()["detail"] == "Email already registered"

    def test_register_missing_email_returns_422(self, client):
        resp = client.post("/api/auth/register", json={
            "password": "StrongPass1!",
            "name": "No Email",
        })
        assert resp.status_code == 422

    def test_register_missing_password_returns_422(self, client):
        resp = client.post("/api/auth/register", json={
            "email": "nopass@example.com",
            "name": "No Password",
        })
        assert resp.status_code == 422

    def test_register_missing_name_returns_422(self, client):
        resp = client.post("/api/auth/register", json={
            "email": "noname@example.com",
            "password": "StrongPass1!",
        })
        assert resp.status_code == 422

    def test_register_empty_body_returns_422(self, client):
        resp = client.post("/api/auth/register", json={})
        assert resp.status_code == 422

    def test_register_invalid_email_format_returns_422(self, client):
        resp = client.post("/api/auth/register", json={
            "email": "not-an-email",
            "password": "StrongPass1!",
            "name": "Bad Email",
        })
        assert resp.status_code == 422

    def test_register_password_too_short_returns_422(self, client):
        resp = client.post("/api/auth/register", json={
            "email": "shortpass@example.com",
            "password": "short",
            "name": "Short Pass",
        })
        assert resp.status_code == 422

    def test_register_password_min_length_8_accepted(self, client):
        resp = client.post("/api/auth/register", json={
            "email": "minlen@example.com",
            "password": "Abcd1234",
            "name": "Min Length",
        })
        assert resp.status_code == 201

    def test_register_password_7_chars_rejected(self, client):
        resp = client.post("/api/auth/register", json={
            "email": "sevenchars@example.com",
            "password": "1234567",
            "name": "Seven Chars",
        })
        assert resp.status_code == 422

    def test_register_password_max_length_128_accepted(self, client):
        resp = client.post("/api/auth/register", json={
            "email": "maxlen@example.com",
            "password": "Abcd1234" + "x" * 120,
            "name": "Max Length",
        })
        assert resp.status_code == 201

    def test_register_password_129_chars_rejected(self, client):
        resp = client.post("/api/auth/register", json={
            "email": "over128@example.com",
            "password": "A" * 129,
            "name": "Over 128",
        })
        assert resp.status_code == 422

    def test_register_name_empty_string_returns_422(self, client):
        resp = client.post("/api/auth/register", json={
            "email": "emptyname@example.com",
            "password": "StrongPass1!",
            "name": "",
        })
        assert resp.status_code == 422

    def test_register_name_max_100_accepted(self, client):
        resp = client.post("/api/auth/register", json={
            "email": "longname@example.com",
            "password": "StrongPass1!",
            "name": "A" * 100,
        })
        assert resp.status_code == 201

    def test_register_email_is_stored_normalized(self, client):
        """Pydantic EmailStr normalizes the email (e.g. lowercases domain).
        Verify the user can log in with the normalized form."""
        resp = client.post("/api/auth/register", json={
            "email": "CaseSense@Example.com",
            "password": "StrongPass1!",
            "name": "Case Test",
        })
        assert resp.status_code == 201
        # When REQUIRE_EMAIL_VERIFICATION=True a token is returned; verify if so.
        token = resp.json().get("verification_token")
        if token is not None:
            verify_resp = client.get(f"/api/auth/verify-email?token={token}")
            assert verify_resp.status_code == 200
        # Login with the normalized form should work
        login_resp = client.post("/api/auth/login", json={
            "email": "CaseSense@example.com",
            "password": "StrongPass1!",
        })
        assert login_resp.status_code == 200

    def test_register_role_student_hint_is_accepted_now(self, client):
        """#3804 (Young 2026-11-01): there is no more block on role="student" --
        every account defaults to student anyway, so an explicit hint of
        "student" is simply redundant with the default, not an error."""
        resp = client.post("/api/auth/register", json={
            "email": "student_self@example.com",
            "password": "StrongPass1!",
            "name": "Student Self",
            "role": "student",
        })
        assert resp.status_code == 201

    def test_register_no_role_defaults_to_student(self, client):
        """#3804: when no role is specified the account defaults to student,
        not teacher. See test_self_serve_teacher_3804.py for the role-content
        assertion; this file only re-locks the HTTP-level 201."""
        resp = client.post("/api/auth/register", json={
            "email": "norole_student@example.com",
            "password": "StrongPass1!",
            "name": "No Role Student",
        })
        assert resp.status_code == 201

    def test_register_teacher_role_hint_is_ignored_not_rejected(self, client):
        """#3804: role="teacher" no longer means anything special (there is
        no more register=teacher branch) -- it is simply ignored, same as
        role="student" or omitting role. Registration still succeeds."""
        resp = client.post("/api/auth/register", json={
            "email": "explicit_teacher@example.com",
            "password": "StrongPass1!",
            "name": "Explicit Teacher",
            "role": "teacher",
        })
        assert resp.status_code == 201


# ===========================================================================
# Integration tests — auto school creation on teacher register (issue #459)
# ===========================================================================


class TestSelfServeSchoolCreation:
    """#3804 (Young 2026-11-01) retires issue #459's auto-school-by-email-domain.

    Registration no longer creates or joins a school at all -- every account
    defaults to student with no school. A school is now only created/joined
    when the account explicitly self-activates as a teacher by NAME via
    POST /users/me/activate-teacher (not by email domain).

    The full behavior lock for that endpoint (idempotency, case-insensitive
    matching, admin_user_id on creation, multiple schools, the permission
    matrix) lives in test_self_serve_teacher_3804.py -- this class only
    re-asserts, at the DB level, the two properties the old class existed to
    prove: different names -> different schools, same name -> one school,
    shared across however many different email domains ask for it.
    """

    def _register_and_login(self, client, label: str) -> tuple[int, str]:
        import uuid as _uuid
        email = f"{label}_{_uuid.uuid4().hex[:8]}@example.com"
        resp = client.post("/api/auth/register", json={
            "email": email, "password": "StrongPass1!", "name": label,
        })
        assert resp.status_code == 201, resp.text
        token = resp.json().get("verification_token")
        if token:
            client.get(f"/api/auth/verify-email?token={token}")
        login = client.post("/api/auth/login", json={"email": email, "password": "StrongPass1!"})
        access = login.json()["access_token"]
        from app.auth.jwt import decode_token
        return int(decode_token(access)["sub"]), access

    def test_register_alone_creates_no_school(self, client):
        from app.models.school import School

        before = TestingSessionLocal().query(School).count()
        self._register_and_login(client, "no_school_on_register")
        after = TestingSessionLocal().query(School).count()
        assert after == before, "plain registration must not create a school (#3804)"

    def test_self_activation_creates_a_named_school_and_grants_teacher(self, client):
        from app.models.school import School
        from app.models.user import Role, UserRole

        user_id, token = self._register_and_login(client, "activates_self")
        school_name = f"大安國小_{uuid.uuid4().hex[:6]}"
        resp = client.post(
            "/api/users/me/activate-teacher",
            json={"school_names": [school_name]},
            headers={"Authorization": f"Bearer {token}"},
        )
        assert resp.status_code == 200, resp.text
        school_id = resp.json()["schools"][0]["id"]

        db = TestingSessionLocal()
        try:
            school = db.get(School, school_id)
            assert school is not None and school.name == school_name
            teacher_role = db.query(Role).filter(Role.name == "teacher").first()
            role = (
                db.query(UserRole)
                .filter(
                    UserRole.user_id == user_id,
                    UserRole.role_id == teacher_role.id,
                    UserRole.scope_type == "school",
                    UserRole.scope_id == str(school_id),
                )
                .first()
            )
            assert role is not None
        finally:
            db.close()

    def test_two_accounts_naming_the_same_school_share_it(self, client):
        from app.models.school import School

        school_name = f"同一間_{uuid.uuid4().hex[:6]}"
        _, token_a = self._register_and_login(client, "shares_a")
        _, token_b = self._register_and_login(client, "shares_b")

        resp_a = client.post(
            "/api/users/me/activate-teacher",
            json={"school_names": [school_name]},
            headers={"Authorization": f"Bearer {token_a}"},
        )
        resp_b = client.post(
            "/api/users/me/activate-teacher",
            json={"school_names": [school_name]},
            headers={"Authorization": f"Bearer {token_b}"},
        )
        assert resp_a.json()["schools"][0]["id"] == resp_b.json()["schools"][0]["id"]

        db = TestingSessionLocal()
        try:
            assert db.query(School).filter(School.name == school_name).count() == 1
        finally:
            db.close()

    def test_two_accounts_naming_different_schools_each_get_their_own(self, client):
        unique = uuid.uuid4().hex[:6]
        _, token_a = self._register_and_login(client, "diff_a")
        _, token_b = self._register_and_login(client, "diff_b")

        resp_a = client.post(
            "/api/users/me/activate-teacher",
            json={"school_names": [f"School A {unique}"]},
            headers={"Authorization": f"Bearer {token_a}"},
        )
        resp_b = client.post(
            "/api/users/me/activate-teacher",
            json={"school_names": [f"School B {unique}"]},
            headers={"Authorization": f"Bearer {token_b}"},
        )
        assert resp_a.json()["schools"][0]["id"] != resp_b.json()["schools"][0]["id"]

    def test_self_activating_teacher_becomes_the_new_schools_admin_user_id(self, client):
        from app.models.school import School

        user_id, token = self._register_and_login(client, "becomes_admin")
        school_name = f"Admin School {uuid.uuid4().hex[:6]}"
        resp = client.post(
            "/api/users/me/activate-teacher",
            json={"school_names": [school_name]},
            headers={"Authorization": f"Bearer {token}"},
        )
        school_id = resp.json()["schools"][0]["id"]

        db = TestingSessionLocal()
        try:
            school = db.get(School, school_id)
            assert school.admin_user_id == user_id, (
                "the self-activating teacher is recorded as the school's "
                "admin_user_id (a record of who created it, not a role "
                "grant -- same convention the retired assign_teacher_to_school used)"
            )
        finally:
            db.close()


# ===========================================================================
# Integration tests — POST /api/auth/login
# ===========================================================================


class TestLoginEndpoint:
    def test_login_success_returns_200(self, client, registered_user):
        resp = client.post("/api/auth/login", json={
            "email": registered_user["email"],
            "password": registered_user["password"],
        })
        assert resp.status_code == 200

    def test_login_returns_access_token(self, client, registered_user):
        resp = client.post("/api/auth/login", json={
            "email": registered_user["email"],
            "password": registered_user["password"],
        })
        data = resp.json()
        assert "access_token" in data
        assert isinstance(data["access_token"], str)
        assert len(data["access_token"]) > 0

    def test_login_returns_token_type_bearer(self, client, registered_user):
        resp = client.post("/api/auth/login", json={
            "email": registered_user["email"],
            "password": registered_user["password"],
        })
        assert resp.json()["token_type"] == "bearer"

    def test_login_token_is_valid_jwt(self, client, registered_user):
        resp = client.post("/api/auth/login", json={
            "email": registered_user["email"],
            "password": registered_user["password"],
        })
        token = resp.json()["access_token"]
        payload = decode_token(token)
        assert int(payload["sub"]) > 0

    def test_login_wrong_password_returns_401(self, client, registered_user):
        resp = client.post("/api/auth/login", json={
            "email": registered_user["email"],
            "password": "WrongPassword123!",
        })
        assert resp.status_code == 401

    def test_login_wrong_password_error_message(self, client, registered_user):
        resp = client.post("/api/auth/login", json={
            "email": registered_user["email"],
            "password": "WrongPassword123!",
        })
        assert resp.json()["detail"] == "Invalid email or password"

    def test_login_nonexistent_email_returns_401(self, client):
        resp = client.post("/api/auth/login", json={
            "email": "nobody@example.com",
            "password": "SomePassword1!",
        })
        assert resp.status_code == 401

    def test_login_nonexistent_email_error_message(self, client):
        resp = client.post("/api/auth/login", json={
            "email": "ghost@example.com",
            "password": "SomePassword1!",
        })
        assert resp.json()["detail"] == "Invalid email or password"

    def test_login_missing_email_returns_422(self, client):
        resp = client.post("/api/auth/login", json={
            "password": "SomePassword1!",
        })
        assert resp.status_code == 422

    def test_login_missing_password_returns_422(self, client):
        resp = client.post("/api/auth/login", json={
            "email": "someone@example.com",
        })
        assert resp.status_code == 422

    def test_login_empty_body_returns_422(self, client):
        resp = client.post("/api/auth/login", json={})
        assert resp.status_code == 422

    def test_login_invalid_email_format_returns_401(self, client):
        """Non-email strings are now treated as username lookups, so invalid
        email format returns 401 (not found) instead of 422."""
        resp = client.post("/api/auth/login", json={
            "email": "not-an-email",
            "password": "SomePassword1!",
        })
        assert resp.status_code == 401

    def test_login_updates_last_login_at(self, client, registered_user):
        """After login, the user's last_login_at should be set."""
        resp = client.post("/api/auth/login", json={
            "email": registered_user["email"],
            "password": registered_user["password"],
        })
        assert resp.status_code == 200
        # Verify by fetching user profile
        token = resp.json()["access_token"]
        me_resp = client.get("/api/users/me", headers=auth_header(token))
        assert me_resp.status_code == 200
        assert me_resp.json()["last_login_at"] is not None

    def test_login_same_error_for_wrong_email_and_wrong_password(self, client, registered_user):
        """Security: same error message whether email exists or not."""
        resp_wrong_email = client.post("/api/auth/login", json={
            "email": "doesnotexist@example.com",
            "password": "SomePassword1!",
        })
        resp_wrong_pass = client.post("/api/auth/login", json={
            "email": registered_user["email"],
            "password": "WrongPassword123!",
        })
        assert resp_wrong_email.json()["detail"] == resp_wrong_pass.json()["detail"]
        assert resp_wrong_email.status_code == resp_wrong_pass.status_code

    def test_login_blocks_parent_role_when_parent_portal_disabled(self, client, registered_user, monkeypatch):
        _assign_role_to_user(registered_user["email"], "parent")
        monkeypatch.setattr("app.config.settings.parent_portal_enabled", False)

        resp = client.post("/api/auth/login", json={
            "email": registered_user["email"],
            "password": registered_user["password"],
        })

        assert resp.status_code == 403
        assert resp.json()["detail"] == "家長功能目前暫時關閉，請聯繫老師或管理員。"

    def test_login_allows_parent_role_when_parent_portal_enabled(self, client, registered_user, monkeypatch):
        _assign_role_to_user(registered_user["email"], "parent")
        monkeypatch.setattr("app.config.settings.parent_portal_enabled", True)

        resp = client.post("/api/auth/login", json={
            "email": registered_user["email"],
            "password": registered_user["password"],
        })

        assert resp.status_code == 200


# ===========================================================================
# Integration tests — POST /api/auth/change-password
# ===========================================================================


class TestChangePasswordEndpoint:
    def test_change_password_success(self, client, registered_user):
        resp = client.post(
            "/api/auth/change-password",
            json={
                "old_password": registered_user["password"],
                "new_password": "NewSecurePass456!",
            },
            headers=auth_header(registered_user["token"]),
        )
        assert resp.status_code == 200

    def test_change_password_success_message(self, client, registered_user):
        resp = client.post(
            "/api/auth/change-password",
            json={
                "old_password": registered_user["password"],
                "new_password": "NewSecurePass456!",
            },
            headers=auth_header(registered_user["token"]),
        )
        assert resp.json()["message"] == "Password updated successfully"

    def test_change_password_new_password_works_for_login(self, client):
        """After changing password, user can log in with the new password."""
        # Register and verify email (issue #460)
        reg_resp = client.post("/api/auth/register", json={
            "email": "changeme@example.com",
            "password": "OldPassword1!",
            "name": "Change Me",
        })
        vtoken = reg_resp.json().get("verification_token")
        if vtoken:
            client.get(f"/api/auth/verify-email?token={vtoken}")
        token = client.post("/api/auth/login", json={"email": "changeme@example.com", "password": "OldPassword1!"}).json()["access_token"]

        # Change password
        change_resp = client.post(
            "/api/auth/change-password",
            json={
                "old_password": "OldPassword1!",
                "new_password": "BrandNewPass1!",
            },
            headers=auth_header(token),
        )
        assert change_resp.status_code == 200

        # Login with new password
        login_resp = client.post("/api/auth/login", json={
            "email": "changeme@example.com",
            "password": "BrandNewPass1!",
        })
        assert login_resp.status_code == 200

    def test_change_password_old_password_no_longer_works(self, client):
        """After changing password, old password should fail login."""
        # Register and verify email (issue #460)
        reg_resp = client.post("/api/auth/register", json={
            "email": "oldnowork@example.com",
            "password": "OldPassword1!",
            "name": "Old No Work",
        })
        vtoken = reg_resp.json().get("verification_token")
        if vtoken:
            client.get(f"/api/auth/verify-email?token={vtoken}")
        token = client.post("/api/auth/login", json={"email": "oldnowork@example.com", "password": "OldPassword1!"}).json()["access_token"]

        client.post(
            "/api/auth/change-password",
            json={
                "old_password": "OldPassword1!",
                "new_password": "BrandNewPass1!",
            },
            headers=auth_header(token),
        )

        login_resp = client.post("/api/auth/login", json={
            "email": "oldnowork@example.com",
            "password": "OldPassword1!",
        })
        assert login_resp.status_code == 401

    def test_change_password_wrong_old_password_returns_401(self, client, registered_user):
        resp = client.post(
            "/api/auth/change-password",
            json={
                "old_password": "WrongOldPass!",
                "new_password": "NewSecurePass456!",
            },
            headers=auth_header(registered_user["token"]),
        )
        assert resp.status_code == 401

    def test_change_password_wrong_old_password_error_message(self, client, registered_user):
        resp = client.post(
            "/api/auth/change-password",
            json={
                "old_password": "WrongOldPass!",
                "new_password": "NewSecurePass456!",
            },
            headers=auth_header(registered_user["token"]),
        )
        assert resp.json()["detail"] == "Current password is incorrect"

    def test_change_password_without_auth_returns_401(self, client):
        resp = client.post("/api/auth/change-password", json={
            "old_password": "anything",
            "new_password": "NewSecurePass456!",
        })
        assert resp.status_code == 401

    def test_change_password_new_too_short_returns_422(self, client, registered_user):
        resp = client.post(
            "/api/auth/change-password",
            json={
                "old_password": registered_user["password"],
                "new_password": "short",
            },
            headers=auth_header(registered_user["token"]),
        )
        assert resp.status_code == 422

    def test_change_password_new_too_long_returns_422(self, client, registered_user):
        resp = client.post(
            "/api/auth/change-password",
            json={
                "old_password": registered_user["password"],
                "new_password": "A" * 129,
            },
            headers=auth_header(registered_user["token"]),
        )
        assert resp.status_code == 422

    def test_change_password_missing_old_password_returns_422(self, client, registered_user):
        resp = client.post(
            "/api/auth/change-password",
            json={"new_password": "NewSecurePass456!"},
            headers=auth_header(registered_user["token"]),
        )
        assert resp.status_code == 422

    def test_change_password_missing_new_password_returns_422(self, client, registered_user):
        resp = client.post(
            "/api/auth/change-password",
            json={"old_password": registered_user["password"]},
            headers=auth_header(registered_user["token"]),
        )
        assert resp.status_code == 422


# ===========================================================================
# Integration tests — GET /api/users/me
# ===========================================================================


class TestGetMeEndpoint:
    def test_get_me_returns_200(self, client, registered_user):
        resp = client.get("/api/users/me", headers=auth_header(registered_user["token"]))
        assert resp.status_code == 200

    def test_get_me_returns_correct_email(self, client, registered_user):
        resp = client.get("/api/users/me", headers=auth_header(registered_user["token"]))
        data = resp.json()
        assert data["email"] == registered_user["email"].lower()

    def test_get_me_returns_correct_name(self, client, registered_user):
        resp = client.get("/api/users/me", headers=auth_header(registered_user["token"]))
        data = resp.json()
        assert data["name"] == registered_user["name"]

    def test_get_me_returns_expected_fields(self, client, registered_user):
        resp = client.get("/api/users/me", headers=auth_header(registered_user["token"]))
        data = resp.json()
        expected_fields = [
            "id", "email", "name", "phone", "avatar_url",
            "is_active", "email_verified", "last_login_at",
            "created_at", "roles",
        ]
        for field in expected_fields:
            assert field in data, f"Missing field: {field}"

    def test_get_me_id_is_positive_int(self, client, registered_user):
        resp = client.get("/api/users/me", headers=auth_header(registered_user["token"]))
        data = resp.json()
        assert isinstance(data["id"], int)
        assert data["id"] > 0

    def test_get_me_is_active_true(self, client, registered_user):
        resp = client.get("/api/users/me", headers=auth_header(registered_user["token"]))
        assert resp.json()["is_active"] is True

    def test_get_me_email_verified_true_by_default(self, client, registered_user):
        """Registration auto-verifies email (dev/test mode)."""
        resp = client.get("/api/users/me", headers=auth_header(registered_user["token"]))
        assert resp.json()["email_verified"] is True

    def test_get_me_roles_is_list(self, client, registered_user):
        resp = client.get("/api/users/me", headers=auth_header(registered_user["token"]))
        assert isinstance(resp.json()["roles"], list)

    def test_get_me_new_account_has_platform_student_role(self, client, registered_user):
        """#3804: a freshly registered account defaults to a platform-scoped
        student role (not teacher, not school-scoped -- there is no school
        yet). See test_self_serve_teacher_3804.py for the full lock."""
        resp = client.get("/api/users/me", headers=auth_header(registered_user["token"]))
        roles = resp.json()["roles"]
        assert len(roles) == 1
        assert roles[0]["role_name"] == "student"
        assert roles[0]["scope_type"] == "platform"

    def test_get_me_phone_is_null_by_default(self, client, registered_user):
        resp = client.get("/api/users/me", headers=auth_header(registered_user["token"]))
        assert resp.json()["phone"] is None

    def test_get_me_avatar_url_is_null_by_default(self, client, registered_user):
        resp = client.get("/api/users/me", headers=auth_header(registered_user["token"]))
        assert resp.json()["avatar_url"] is None

    def test_get_me_created_at_is_present(self, client, registered_user):
        resp = client.get("/api/users/me", headers=auth_header(registered_user["token"]))
        assert resp.json()["created_at"] is not None

    def test_get_me_no_token_returns_401(self, client):
        resp = client.get("/api/users/me")
        assert resp.status_code == 401

    def test_get_me_no_token_error_message(self, client):
        resp = client.get("/api/users/me")
        assert resp.json()["detail"] == "Not authenticated"

    def test_get_me_invalid_token_returns_401(self, client):
        resp = client.get("/api/users/me", headers=auth_header("not.a.valid.token"))
        assert resp.status_code == 401

    def test_get_me_invalid_token_error_message(self, client):
        resp = client.get("/api/users/me", headers=auth_header("invalid.jwt.here"))
        assert resp.json()["detail"] == "Invalid or expired token"

    def test_get_me_expired_token_returns_401(self, client):
        """Create a manually expired token and confirm it is rejected."""
        expired_payload = {
            "sub": "1",
            "exp": datetime.now(timezone.utc) - timedelta(seconds=10),
            "iat": datetime.now(timezone.utc) - timedelta(hours=1),
        }
        expired_token = jwt.encode(
            expired_payload, settings.jwt_secret_key, algorithm=settings.jwt_algorithm
        )
        resp = client.get("/api/users/me", headers=auth_header(expired_token))
        assert resp.status_code == 401

    def test_get_me_expired_token_error_message(self, client):
        expired_payload = {
            "sub": "1",
            "exp": datetime.now(timezone.utc) - timedelta(seconds=10),
            "iat": datetime.now(timezone.utc) - timedelta(hours=1),
        }
        expired_token = jwt.encode(
            expired_payload, settings.jwt_secret_key, algorithm=settings.jwt_algorithm
        )
        resp = client.get("/api/users/me", headers=auth_header(expired_token))
        assert resp.json()["detail"] == "Invalid or expired token"

    def test_get_me_token_for_nonexistent_user_returns_401(self, client):
        """Token with a valid signature but user ID that does not exist in DB."""
        token = create_access_token(user_id=999999)
        resp = client.get("/api/users/me", headers=auth_header(token))
        assert resp.status_code == 401

    def test_get_me_token_for_nonexistent_user_error_message(self, client):
        token = create_access_token(user_id=999999)
        resp = client.get("/api/users/me", headers=auth_header(token))
        assert resp.json()["detail"] == "User not found or inactive"

    def test_get_me_wrong_secret_token_returns_401(self, client):
        """Token signed with a different secret should be rejected."""
        payload = {
            "sub": "1",
            "exp": datetime.now(timezone.utc) + timedelta(hours=1),
            "iat": datetime.now(timezone.utc),
        }
        bad_token = jwt.encode(payload, "totally-wrong-secret", algorithm="HS256")
        resp = client.get("/api/users/me", headers=auth_header(bad_token))
        assert resp.status_code == 401


# ===========================================================================
# End-to-end flow tests
# ===========================================================================


class TestAuthFlow:
    def test_register_then_login_then_get_me(self, client):
        """Full flow: register -> verify email -> login -> GET /users/me (issue #460)."""
        # Register
        reg_resp = client.post("/api/auth/register", json={
            "email": "fullflow@example.com",
            "password": "FlowPass123!",
            "name": "Flow User",
        })
        assert reg_resp.status_code == 201
        # Verify email before login if flag is on (issue #460)
        vtoken = reg_resp.json().get("verification_token")
        if vtoken:
            client.get(f"/api/auth/verify-email?token={vtoken}")

        # Login
        login_resp = client.post("/api/auth/login", json={
            "email": "fullflow@example.com",
            "password": "FlowPass123!",
        })
        assert login_resp.status_code == 200
        login_token = login_resp.json()["access_token"]

        me_resp = client.get("/api/users/me", headers=auth_header(login_token))
        assert me_resp.status_code == 200
        assert me_resp.json()["email"] == "fullflow@example.com"
        assert me_resp.json()["name"] == "Flow User"

    def test_register_change_password_login_with_new(self, client):
        """Register -> verify email -> change password -> login with new password (issue #460)."""
        reg_resp = client.post("/api/auth/register", json={
            "email": "pwflow@example.com",
            "password": "OriginalPass1!",
            "name": "PW Flow",
        })
        # Verify email if required, then login to get token (issue #460)
        vtoken = reg_resp.json().get("verification_token")
        if vtoken:
            client.get(f"/api/auth/verify-email?token={vtoken}")
        token = client.post("/api/auth/login", json={"email": "pwflow@example.com", "password": "OriginalPass1!"}).json()["access_token"]

        # Change password
        change_resp = client.post(
            "/api/auth/change-password",
            json={
                "old_password": "OriginalPass1!",
                "new_password": "UpdatedPass1!",
            },
            headers=auth_header(token),
        )
        assert change_resp.status_code == 200

        # Login with old password fails
        old_login = client.post("/api/auth/login", json={
            "email": "pwflow@example.com",
            "password": "OriginalPass1!",
        })
        assert old_login.status_code == 401

        # Login with new password succeeds
        new_login = client.post("/api/auth/login", json={
            "email": "pwflow@example.com",
            "password": "UpdatedPass1!",
        })
        assert new_login.status_code == 200

    def test_multiple_logins_return_different_tokens(self, client, registered_user):
        """Each login should issue a distinct token when iat differs.
        JWT iat has second-level precision, so we sleep >1s to guarantee
        a different timestamp."""
        resp1 = client.post("/api/auth/login", json={
            "email": registered_user["email"],
            "password": registered_user["password"],
        })
        # Sleep just over 1 second so the JWT iat (seconds precision) differs
        time.sleep(1.1)
        resp2 = client.post("/api/auth/login", json={
            "email": registered_user["email"],
            "password": registered_user["password"],
        })
        assert resp1.json()["access_token"] != resp2.json()["access_token"]


# ===========================================================================
# Rate limiting tests
# ===========================================================================


class TestRateLimiting:
    def test_login_rate_limit_exceeded(self, client, registered_user):
        """Sending more than 10 login requests in a minute should return 429."""
        from app.routes.auth import rate_limiter
        rate_limiter.reset()

        for i in range(10):
            resp = client.post("/api/auth/login", json={
                "email": registered_user["email"],
                "password": registered_user["password"],
            })
            assert resp.status_code in (200, 401), f"Request {i+1} unexpected status {resp.status_code}"

        # 11th request should be rate limited
        resp = client.post("/api/auth/login", json={
            "email": registered_user["email"],
            "password": registered_user["password"],
        })
        assert resp.status_code == 429
        assert resp.json()["detail"] == "Too many requests. Please try again later."

    def test_register_rate_limit_exceeded(self, client):
        """Sending more than 5 register requests in a minute should return 429."""
        from app.routes.auth import rate_limiter
        rate_limiter.reset()

        for i in range(5):
            resp = client.post("/api/auth/register", json={
                "email": f"ratelimit_{i}_{uuid.uuid4().hex[:6]}@example.com",
                "password": "StrongPass1!",
                "name": f"Rate Limit User {i}",
            })
            assert resp.status_code in (201, 409), f"Request {i+1} unexpected status {resp.status_code}"

        # 6th request should be rate limited
        resp = client.post("/api/auth/register", json={
            "email": f"ratelimit_extra_{uuid.uuid4().hex[:6]}@example.com",
            "password": "StrongPass1!",
            "name": "Rate Limit Extra",
        })
        assert resp.status_code == 429
        assert resp.json()["detail"] == "Too many requests. Please try again later."


# ===========================================================================
# Integration tests — Email verification flow (issue #460)
# ===========================================================================


class TestEmailVerificationFlow:
    """Tests for issue #460: token-based email verification.

    All tests in this class run with REQUIRE_EMAIL_VERIFICATION=True so that
    the verification flow (token generation, 403 on unverified login, etc.)
    is exercised end-to-end.
    """

    def _register(self, client, suffix: str = "") -> dict:
        """Helper: register a fresh user with REQUIRE_EMAIL_VERIFICATION=True.

        Returns the response body with email and password added for convenience.
        The verification_token in the returned dict is always non-None because
        the flag is forced on.
        """
        from unittest.mock import patch
        from app.config import settings

        unique = uuid.uuid4().hex[:8]
        email = f"evtest_{unique}{suffix}@verify.com"
        with patch.object(settings, "require_email_verification", True):
            resp = client.post("/api/auth/register", json={
                "email": email,
                "password": "StrongPass1!",
                "name": f"Verify User {unique}",
            })
        assert resp.status_code == 201
        data = resp.json()
        data["email"] = email
        data["password"] = "StrongPass1!"
        return data

    def test_register_sets_email_verified_false(self, client):
        """With flag on, newly registered users should have email_verified=False in DB."""
        from app.models.user import User as UserModel

        data = self._register(client)
        db = TestingSessionLocal()
        try:
            user = db.query(UserModel).filter(UserModel.email == data["email"]).first()
            assert user is not None
            assert user.email_verified is False
        finally:
            db.close()

    def test_register_stores_verification_token_in_db(self, client):
        """With flag on, newly registered users should have a non-null email_verification_token."""
        from app.models.user import User as UserModel

        data = self._register(client)
        db = TestingSessionLocal()
        try:
            user = db.query(UserModel).filter(UserModel.email == data["email"]).first()
            assert user is not None
            assert user.email_verification_token is not None
            assert len(user.email_verification_token) > 0
        finally:
            db.close()

    def test_register_returns_verification_token(self, client):
        """With flag on, register response should include verification_token in dev mode."""
        data = self._register(client)
        assert "verification_token" in data
        assert data["verification_token"] is not None

    def test_login_without_verification_returns_403(self, client):
        """With flag on, unverified users should get 403 with Chinese message on login."""
        from unittest.mock import patch
        from app.config import settings

        data = self._register(client)
        with patch.object(settings, "require_email_verification", True):
            resp = client.post("/api/auth/login", json={
                "email": data["email"],
                "password": data["password"],
            })
        assert resp.status_code == 403
        assert "驗證" in resp.json()["detail"]

    def test_verify_email_get_endpoint_returns_200(self, client):
        """GET /auth/verify-email?token=xxx should return 200."""
        data = self._register(client)
        resp = client.get(f"/api/auth/verify-email?token={data['verification_token']}")
        assert resp.status_code == 200

    def test_verify_email_sets_email_verified_true(self, client):
        """After verification, email_verified should be True in DB."""
        from app.models.user import User as UserModel

        data = self._register(client)
        client.get(f"/api/auth/verify-email?token={data['verification_token']}")
        db = TestingSessionLocal()
        try:
            user = db.query(UserModel).filter(UserModel.email == data["email"]).first()
            assert user.email_verified is True
        finally:
            db.close()

    def test_verify_email_clears_token_from_db(self, client):
        """After verification, email_verification_token should be cleared."""
        from app.models.user import User as UserModel

        data = self._register(client)
        client.get(f"/api/auth/verify-email?token={data['verification_token']}")
        db = TestingSessionLocal()
        try:
            user = db.query(UserModel).filter(UserModel.email == data["email"]).first()
            assert user.email_verification_token is None
        finally:
            db.close()

    def test_login_after_verification_returns_200(self, client):
        """After verifying email, login should succeed."""
        data = self._register(client)
        client.get(f"/api/auth/verify-email?token={data['verification_token']}")
        resp = client.post("/api/auth/login", json={
            "email": data["email"],
            "password": data["password"],
        })
        assert resp.status_code == 200
        assert "access_token" in resp.json()

    def test_verify_email_invalid_token_returns_400(self, client):
        """An invalid or expired token should return 400."""
        resp = client.get("/api/auth/verify-email?token=invalid-token-xyz")
        assert resp.status_code == 400

    def test_verify_email_already_verified_returns_200(self, client):
        """Calling verify-email again on an already-verified user returns 200."""
        data = self._register(client)
        client.get(f"/api/auth/verify-email?token={data['verification_token']}")
        # Calling again should still return 200 (idempotent)
        resp = client.get(f"/api/auth/verify-email?token={data['verification_token']}")
        # Token was cleared after first verify, so second call returns 400
        assert resp.status_code in (200, 400)

    def test_resend_verification_returns_new_token(self, client):
        """POST /auth/resend-verification should return a new verification_token."""
        data = self._register(client)
        resp = client.post("/api/auth/resend-verification", json={"email": data["email"]})
        assert resp.status_code == 200
        body = resp.json()
        assert "message" in body
        assert body["verification_token"] is not None

    def test_resend_verification_new_token_works_for_login(self, client):
        """The new token from resend should allow login after verification."""
        data = self._register(client)
        # Get a new token via resend
        resend_resp = client.post("/api/auth/resend-verification", json={"email": data["email"]})
        new_token = resend_resp.json().get("verification_token")
        # Verify with new token
        client.get(f"/api/auth/verify-email?token={new_token}")
        # Login should now work
        login_resp = client.post("/api/auth/login", json={
            "email": data["email"],
            "password": data["password"],
        })
        assert login_resp.status_code == 200

    def test_resend_verification_for_nonexistent_email_returns_200(self, client):
        """Resend for unknown email should still return 200 (prevent enumeration)."""
        resp = client.post("/api/auth/resend-verification", json={
            "email": "nobody_exists@example.com",
        })
        assert resp.status_code == 200

    def test_resend_verification_for_already_verified_returns_200(self, client):
        """Resend for already-verified user returns 200 with no token."""
        data = self._register(client)
        client.get(f"/api/auth/verify-email?token={data['verification_token']}")
        resp = client.post("/api/auth/resend-verification", json={"email": data["email"]})
        assert resp.status_code == 200
        # Already verified — no new token issued
        assert resp.json()["verification_token"] is None

    def test_batch_created_students_remain_verified(self, client):
        """Students created by teachers keep email_verified=True (no real email).

        This is the CRITICAL backward-compatibility test (issue #460 requirement):
        batch-created student accounts must not be broken.
        """
        from app.models.user import User as UserModel
        from app.auth.password import hash_password as _hash

        # Simulate a batch-created student (email_verified=True, no verification token)
        db = TestingSessionLocal()
        try:
            student = UserModel(
                email=f"student_batch_{uuid.uuid4().hex[:6]}@school.edu.tw",
                password_hash=_hash("StudentPass1!"),
                name="Batch Student",
                email_verified=True,  # set by teacher batch creation
                email_verification_token=None,
            )
            db.add(student)
            db.commit()
            db.refresh(student)
            student_email = student.email
        finally:
            db.close()

        # Batch student should be able to login directly (no verification needed)
        resp = client.post("/api/auth/login", json={
            "email": student_email,
            "password": "StudentPass1!",
        })
        assert resp.status_code == 200, (
            f"Batch-created student should be able to login without email verification. "
            f"Got {resp.status_code}: {resp.json()}"
        )


# ===========================================================================
# Integration tests — Email domain validation on teacher registration (#407)
# ===========================================================================


class TestEmailDomainValidation:
    """#3804 (Young 2026-11-01) retired issue #407's register-time domain
    check. `validate_teacher_email_domain` and `assign_teacher_to_school`
    (its only caller) are both gone -- registration no longer touches a
    school at all, so `School.allowed_email_domains` has no bearing on
    registration anymore. The eleven tests this class used to have each
    asserted a 201/403 that depended on that retired check; most of them
    still happened to return 201 (registration now always succeeds,
    regardless of domain), which would be a vacuously-true assertion for the
    wrong reason if kept, not a real lock. The two that asserted 403 would
    fail outright, because nothing calls that check anymore.

    `allowed_email_domains` as a column still exists (read/write via
    GET/PATCH /schools/{id}) -- only its registration-time enforcement is
    retired. If a future PR wants it re-enforced on self-serve activation
    (PRD #3804 §10/§11's `activate_teacher_for_schools`), write fresh tests
    against that function instead of resurrecting these.
    """




# ===========================================================================
# Integration tests — has_classroom field in login response (issue #457)
# ===========================================================================


class TestHasClassroomLoginResponse:
    """Tests for issue #457: login response includes has_classroom flag.

    Students not yet enrolled in any classroom should get has_classroom=False.
    Teachers and other non-student roles always get has_classroom=True.
    """

    def _create_student_directly(self, name: str) -> dict:
        """Create a student directly in DB (simulates teacher-created account).

        Returns dict with email, password.
        """
        from app.models.user import User as UserModel, UserRole as UserRoleModel, Role as RoleModel
        from app.auth.password import hash_password as _hash
        import uuid as _uuid

        email = f"student_{_uuid.uuid4().hex[:8]}@school.edu.tw"
        password = "StudentPass1!"

        db = TestingSessionLocal()
        try:
            student = UserModel(
                email=email,
                password_hash=_hash(password),
                name=name,
                email_verified=True,  # batch-created students skip email verification
            )
            db.add(student)
            db.flush()

            # Assign student role
            role = db.query(RoleModel).filter(RoleModel.name == "student").first()
            assert role is not None, "student role must be seeded"
            db.add(UserRoleModel(user_id=student.id, role_id=role.id, scope_type="school"))
            db.commit()
            return {"email": email, "password": password, "user_id": student.id}
        finally:
            db.close()

    def _enroll_student_in_classroom(self, student_id: int, classroom_id: int) -> None:
        """Directly enroll a student in a classroom via DB."""
        from app.models.school import ClassroomStudent

        db = TestingSessionLocal()
        try:
            cs = ClassroomStudent(classroom_id=classroom_id, student_id=student_id)
            db.add(cs)
            db.commit()
        finally:
            db.close()

    def _create_teacher_and_classroom(self, client) -> dict:
        """Register a brand-new account, self-activate it as a teacher
        (#3804 -- no more domain-based auto school), then create a classroom.

        Returns dict with teacher_token, classroom_id.
        """
        import uuid as _uuid

        unique = _uuid.uuid4().hex[:6]
        email = f"hctest_{unique}@example.com"

        reg = client.post("/api/auth/register", json={
            "email": email, "password": "StrongPass1!", "name": "HC Teacher",
        })
        assert reg.status_code == 201
        vtoken = reg.json().get("verification_token")
        if vtoken:
            client.get(f"/api/auth/verify-email?token={vtoken}")
        teacher_token = client.post("/api/auth/login", json={
            "email": email, "password": "StrongPass1!",
        }).json()["access_token"]

        act = client.post(
            "/api/users/me/activate-teacher",
            json={"school_names": [f"HC Test School {unique}"]},
            headers={"Authorization": f"Bearer {teacher_token}"},
        )
        assert act.status_code == 200, act.text
        school_id = act.json()["schools"][0]["id"]

        # Create a classroom
        from app.models.school import Classroom
        db = TestingSessionLocal()
        try:
            from app.auth.jwt import decode_token
            teacher_id = int(decode_token(teacher_token)["sub"])
            classroom = Classroom(
                school_id=school_id,
                teacher_id=teacher_id,
                name="Test Class",
                grade=3,
            )
            db.add(classroom)
            db.commit()
            db.refresh(classroom)
            return {"teacher_token": teacher_token, "classroom_id": classroom.id}
        finally:
            db.close()

    # -----------------------------------------------------------------------
    # Test: login response contains has_classroom field
    # -----------------------------------------------------------------------

    def test_login_response_has_has_classroom_field(self, client, registered_user):
        """Login response must include has_classroom field (issue #457)."""
        resp = client.post("/api/auth/login", json={
            "email": registered_user["email"],
            "password": registered_user["password"],
        })
        assert resp.status_code == 200
        assert "has_classroom" in resp.json(), (
            "Login response must include has_classroom field for student classroom gate"
        )

    def test_fresh_registration_has_classroom_false(self, client, registered_user):
        """#3804: a freshly self-registered account defaults to student with
        no classroom -- has_classroom=False, not True. There is no more
        "registration defaults to teacher, so it's exempt from the gate"."""
        resp = client.post("/api/auth/login", json={
            "email": registered_user["email"],
            "password": registered_user["password"],
        })
        assert resp.status_code == 200
        assert resp.json()["has_classroom"] is False

    def test_student_with_no_classroom_gets_has_classroom_false(self, client):
        """Student with no classroom enrollment should get has_classroom=False."""
        student = self._create_student_directly("No Classroom Student")
        resp = client.post("/api/auth/login", json={
            "email": student["email"],
            "password": student["password"],
        })
        assert resp.status_code == 200
        assert resp.json()["has_classroom"] is False, (
            "Student not enrolled in any classroom should get has_classroom=False"
        )

    def test_student_enrolled_in_classroom_gets_has_classroom_true(self, client):
        """Student who IS enrolled in a classroom should get has_classroom=True."""
        student = self._create_student_directly("Enrolled Student")
        tc = self._create_teacher_and_classroom(client)
        self._enroll_student_in_classroom(student["user_id"], tc["classroom_id"])

        resp = client.post("/api/auth/login", json={
            "email": student["email"],
            "password": student["password"],
        })
        assert resp.status_code == 200
        assert resp.json()["has_classroom"] is True, (
            "Student enrolled in a classroom should get has_classroom=True"
        )

    def test_account_with_no_student_role_at_all_gets_has_classroom_true(self, client):
        """A user with NO student role whatsoever (not even the #3804 default
        -- e.g. a legacy/migrated account) is exempt from the gate, same as
        before. #3804 means this scenario can no longer arise through
        /auth/register (every fresh registration gets the default student
        role), so it's constructed directly to keep locking the exemption
        itself, separate from how an account normally comes to have it."""
        from app.models.user import User as UserModel
        from app.auth.password import hash_password as _hash
        import uuid as _uuid

        email = f"norole_{_uuid.uuid4().hex[:8]}@example.com"
        password = "StrongPass1!"
        db = TestingSessionLocal()
        try:
            user = UserModel(
                email=email, password_hash=_hash(password), name="No Role",
                email_verified=True,
            )
            db.add(user)
            db.commit()
            # deliberately: zero UserRole rows at all
        finally:
            db.close()

        resp = client.post("/api/auth/login", json={
            "email": email,
            "password": password,
        })
        assert resp.status_code == 200
        assert resp.json()["has_classroom"] is True


class TestClassroomLoginBurst:
    def test_thirty_students_on_one_school_ip_can_all_log_in(self, client):
        """2026-10-15 staging: a class of 30 tablets shares one school IP.
        Login was limited to 10/min per IP, so 30 students needed 154 s to
        get in and 20 of them saw 429s. Distinct accounts behind one IP must
        not throttle each other; brute force on ONE account is still capped
        (see TestRateLimiting.test_login_rate_limit_exceeded)."""
        import uuid
        from app.routes.auth import rate_limiter

        users = []
        for i in range(30):
            rate_limiter.reset()  # setup only: register is 5/min per IP
            email = f"burst{i}_{uuid.uuid4().hex[:6]}@example.com"
            r = client.post("/api/auth/register", json={"email": email, "password": "SecurePass123!", "name": f"Burst {i}"})
            assert r.status_code == 201, r.text
            tok = r.json().get("verification_token")
            if tok:
                client.get(f"/api/auth/verify-email?token={tok}")
            users.append(email)
        rate_limiter.reset()
        statuses = [
            client.post("/api/auth/login", json={"email": e, "password": "SecurePass123!"}).status_code
            for e in users
        ]
        assert statuses.count(429) == 0, statuses
        assert statuses.count(200) == 30, statuses
