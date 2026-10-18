"""
Tests for issue #3426 — student username login must be case-insensitive.

Student usernames are system-generated (classroom.join_code + seat_number),
always stored uppercase (see classroom_batch.py / classroom_csv.py, both call
``.upper()`` before writing to the DB). Credential cards print them uppercase.
On tablets, students often type lowercase (or autocapitalize is off), and the
login lookup at ``POST /api/auth/login`` was comparing ``User.username``
case-sensitively, so a correct lowercase username + correct password returned
401 "Invalid email or password" with no hint why.

Self-contained module (separate SQLite in-memory engine) so it does not need
to touch the large shared ``test_auth_api.py`` fixture file.

Run with:
    cd backend && python -m pytest tests/test_issue_3426_username_case_insensitive.py -v
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

from app.main import app
from app.database import get_db
from app.models import Base
from app.models.user import Role, User, UserRole
from app.auth.password import hash_password

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
    session = TestingSessionLocal()
    session.add(Role(name="student", display_name="Student", scope_level="school"))
    session.commit()
    session.close()

    app.dependency_overrides[get_db] = _override_get_db
    yield
    app.dependency_overrides.pop(get_db, None)
    Base.metadata.drop_all(bind=engine)


@pytest.fixture(scope="module")
def client():
    with TestClient(app) as c:
        yield c


def _create_student_with_username(username: str) -> dict:
    """Create a student directly in DB with a specific username — mirrors
    what classroom_batch.py / classroom_csv.py actually store (always
    uppercase, via `.upper()` on the generated `{join_code}{seat_number}`)."""
    email = f"{username.lower()}@student.lingoleap.local"
    password = "StudentPass1!"

    db = TestingSessionLocal()
    try:
        role = db.query(Role).filter(Role.name == "student").first()
        assert role is not None
        student = User(
            email=email,
            username=username,
            password_hash=hash_password(password),
            name=f"Student {username}",
            email_verified=True,
        )
        db.add(student)
        db.flush()
        db.add(UserRole(user_id=student.id, role_id=role.id, scope_type="school"))
        db.commit()
        return {"username": username, "password": password, "user_id": student.id}
    finally:
        db.close()


class TestUsernameLoginCaseInsensitive:
    def test_login_with_stored_case_username_returns_200(self, client):
        """Baseline: logging in with the exact stored (uppercase) username works."""
        username = f"D{uuid.uuid4().hex[:6].upper()}"
        student = _create_student_with_username(username)

        resp = client.post("/api/auth/login", json={
            "email": username,
            "password": student["password"],
        })
        assert resp.status_code == 200

    def test_login_with_lowercase_username_returns_200(self, client):
        """Issue #3426: credential cards print uppercase, students type lowercase."""
        username = f"D{uuid.uuid4().hex[:6].upper()}"
        student = _create_student_with_username(username)

        resp = client.post("/api/auth/login", json={
            "email": username.lower(),
            "password": student["password"],
        })
        assert resp.status_code == 200, (
            "Lowercase username must still log in — stored usernames are "
            "always uppercase, but students commonly type lowercase"
        )
        assert "access_token" in resp.json()

    def test_login_with_mixed_case_username_returns_200(self, client):
        """Issue #3426: mixed-case input must also match."""
        suffix = uuid.uuid4().hex[:6].upper()
        username = f"D{suffix}"
        student = _create_student_with_username(username)

        mixed = "".join(
            c.lower() if i % 2 == 0 else c.upper() for i, c in enumerate(username)
        )
        resp = client.post("/api/auth/login", json={
            "email": mixed,
            "password": student["password"],
        })
        assert resp.status_code == 200

    def test_login_with_lowercase_username_wrong_password_returns_401(self, client):
        """Case-insensitive username match must NOT weaken password checking."""
        username = f"D{uuid.uuid4().hex[:6].upper()}"
        _create_student_with_username(username)

        resp = client.post("/api/auth/login", json={
            "email": username.lower(),
            "password": "WrongPassword1!",
        })
        assert resp.status_code == 401

    def test_login_with_nonexistent_username_case_variant_returns_401(self, client):
        """Case-insensitive lookup must not accidentally match a different user."""
        resp = client.post("/api/auth/login", json={
            "email": "nosuchuser999",
            "password": "WrongPassword1!",
        })
        assert resp.status_code == 401
