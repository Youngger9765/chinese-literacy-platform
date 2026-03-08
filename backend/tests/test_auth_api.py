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
from app.models.user import Role
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
    """Register a fresh user and return (email, password, token)."""
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
    token = resp.json()["access_token"]
    return {"email": email, "password": password, "name": name, "token": token}


def auth_header(token: str) -> dict:
    """Build an Authorization header dict."""
    return {"Authorization": f"Bearer {token}"}


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

    def test_register_returns_token(self, client):
        resp = client.post("/api/auth/register", json={
            "email": "tokenuser@example.com",
            "password": "StrongPass1!",
            "name": "Token User",
        })
        data = resp.json()
        assert "access_token" in data
        assert isinstance(data["access_token"], str)
        assert len(data["access_token"]) > 0

    def test_register_returns_token_type_bearer(self, client):
        resp = client.post("/api/auth/register", json={
            "email": "beareruser@example.com",
            "password": "StrongPass1!",
            "name": "Bearer User",
        })
        data = resp.json()
        assert data["token_type"] == "bearer"

    def test_register_token_is_decodable(self, client):
        resp = client.post("/api/auth/register", json={
            "email": "decodable@example.com",
            "password": "StrongPass1!",
            "name": "Decodable User",
        })
        token = resp.json()["access_token"]
        payload = decode_token(token)
        assert "sub" in payload
        # sub should be a positive integer as string
        assert int(payload["sub"]) > 0

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
        # Login with the normalized form should work
        login_resp = client.post("/api/auth/login", json={
            "email": "CaseSense@example.com",
            "password": "StrongPass1!",
        })
        assert login_resp.status_code == 200


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
        # Register
        reg_resp = client.post("/api/auth/register", json={
            "email": "changeme@example.com",
            "password": "OldPassword1!",
            "name": "Change Me",
        })
        token = reg_resp.json()["access_token"]

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
        reg_resp = client.post("/api/auth/register", json={
            "email": "oldnowork@example.com",
            "password": "OldPassword1!",
            "name": "Old No Work",
        })
        token = reg_resp.json()["access_token"]

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

    def test_get_me_new_user_has_no_roles(self, client, registered_user):
        """A freshly registered user has no auto-assigned roles."""
        resp = client.get("/api/users/me", headers=auth_header(registered_user["token"]))
        roles = resp.json()["roles"]
        assert len(roles) == 0

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
        """Full flow: register -> login -> GET /users/me."""
        # Register
        reg_resp = client.post("/api/auth/register", json={
            "email": "fullflow@example.com",
            "password": "FlowPass123!",
            "name": "Flow User",
        })
        assert reg_resp.status_code == 201
        reg_token = reg_resp.json()["access_token"]

        # Login
        login_resp = client.post("/api/auth/login", json={
            "email": "fullflow@example.com",
            "password": "FlowPass123!",
        })
        assert login_resp.status_code == 200
        login_token = login_resp.json()["access_token"]

        # Both tokens should work for GET /users/me
        for token in [reg_token, login_token]:
            me_resp = client.get("/api/users/me", headers=auth_header(token))
            assert me_resp.status_code == 200
            assert me_resp.json()["email"] == "fullflow@example.com"
            assert me_resp.json()["name"] == "Flow User"

    def test_register_change_password_login_with_new(self, client):
        """Register -> change password -> login with new password."""
        reg_resp = client.post("/api/auth/register", json={
            "email": "pwflow@example.com",
            "password": "OriginalPass1!",
            "name": "PW Flow",
        })
        token = reg_resp.json()["access_token"]

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
