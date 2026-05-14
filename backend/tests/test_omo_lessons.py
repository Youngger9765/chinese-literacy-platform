"""Contract tests for GET /api/omo/lessons — Phase 1b sub-feature 2 (Issue #1591).

Tests:
    /api/omo/lessons returns 401 without auth (auth is required in omo-phase-1b)
    /api/omo/lessons returns 200 with valid auth token
    /api/omo/lessons returns a JSON list
    /api/omo/lessons returns at least 1 lesson (lesson_loader has 57+ lessons)
    /api/omo/lessons items have {lesson_id, grade_code, title} schema
    /api/omo/lessons items are sorted by lesson_id

Run:
    cd backend && python -m pytest tests/test_omo_lessons.py -v
"""

import sys
import os

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, event
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.main import app
from app.database import get_db
from app.models import Base

# ---------------------------------------------------------------------------
# SQLite in-memory DB (same pattern as test_omo_dedup.py)
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

_SEED_ROLES = [
    {"name": "system_admin", "display_name": "System Admin", "scope_level": "platform"},
    {"name": "org_admin", "display_name": "Organization Admin", "scope_level": "organization"},
    {"name": "principal", "display_name": "Principal", "scope_level": "school"},
    {"name": "director", "display_name": "Director", "scope_level": "school"},
    {"name": "teacher", "display_name": "Teacher", "scope_level": "school"},
    {"name": "homeroom_teacher", "display_name": "Homeroom Teacher", "scope_level": "school"},
    {"name": "student", "display_name": "Student", "scope_level": "school"},
]


def _override_get_db():
    db = TestingSessionLocal()
    try:
        yield db
    finally:
        db.close()


@pytest.fixture(scope="module")
def client():
    # Patch JSONB → JSON for SQLite (reuse conftest logic inline)
    from sqlalchemy import JSON
    try:
        from sqlalchemy.dialects.postgresql import JSONB
        for table in Base.metadata.sorted_tables:
            for column in table.columns:
                if isinstance(column.type, JSONB):
                    column.type = JSON()
    except Exception:
        pass

    Base.metadata.create_all(bind=engine)

    # Seed roles
    db = TestingSessionLocal()
    try:
        from app.models.user import Role
        for r in _SEED_ROLES:
            if not db.query(Role).filter_by(name=r["name"]).first():
                db.add(Role(**r))
        db.commit()
    finally:
        db.close()

    app.dependency_overrides[get_db] = _override_get_db
    with TestClient(app, raise_server_exceptions=True) as c:
        yield c
    app.dependency_overrides.clear()


def _register_and_login(client: TestClient, suffix: str) -> str:
    email = f"omo_lessons_{suffix}@test.com"
    reg = client.post("/api/auth/register", json={
        "email": email,
        "password": "Test1234!",
        "name": f"OmoLessons {suffix}",
        "role": "teacher",
    })
    # Handle email verification if present
    verification_token = reg.json().get("verification_token")
    if verification_token:
        client.get(f"/api/auth/verify-email?token={verification_token}")
    login = client.post("/api/auth/login", json={
        "email": email,
        "password": "Test1234!",
    })
    return login.json()["access_token"]


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------

def test_lessons_endpoint_requires_auth(client):
    """GET /api/omo/lessons returns 401 without Authorization header."""
    res = client.get("/api/omo/lessons")
    assert res.status_code == 401, f"Expected 401, got {res.status_code}: {res.text}"


def test_lessons_returns_200_with_auth(client):
    """GET /api/omo/lessons returns 200 with valid auth token."""
    token = _register_and_login(client, "auth_check")
    res = client.get("/api/omo/lessons", headers={"Authorization": f"Bearer {token}"})
    assert res.status_code == 200, f"Expected 200, got {res.status_code}: {res.text}"


def test_lessons_returns_list(client):
    """Response must be a JSON array."""
    token = _register_and_login(client, "list_check")
    res = client.get("/api/omo/lessons", headers={"Authorization": f"Bearer {token}"})
    assert res.status_code == 200
    data = res.json()
    assert isinstance(data, list), f"Expected list, got {type(data)}"


def test_lessons_at_least_one_entry(client):
    """There must be at least 1 lesson in the lesson_loader."""
    token = _register_and_login(client, "count_check")
    res = client.get("/api/omo/lessons", headers={"Authorization": f"Bearer {token}"})
    data = res.json()
    assert len(data) >= 1, f"Expected at least 1 lesson, got {len(data)}"


def test_lessons_item_schema(client):
    """Each item must have lesson_id (int), grade_code (str), title (str)."""
    token = _register_and_login(client, "schema_check")
    res = client.get("/api/omo/lessons", headers={"Authorization": f"Bearer {token}"})
    data = res.json()
    for item in data[:5]:  # spot check first 5
        assert "lesson_id" in item, f"Missing lesson_id in {item}"
        assert "grade_code" in item, f"Missing grade_code in {item}"
        assert "title" in item, f"Missing title in {item}"
        assert isinstance(item["lesson_id"], int), f"lesson_id must be int: {item}"
        assert isinstance(item["grade_code"], str), f"grade_code must be str: {item}"
        assert isinstance(item["title"], str), f"title must be str: {item}"
        assert len(item["title"]) > 0, f"title must not be empty: {item}"


def test_lessons_sorted_by_grade_then_title(client):
    """Items must be returned sorted by (grade_code, title) — the picker order."""
    token = _register_and_login(client, "sort_check")
    res = client.get("/api/omo/lessons", headers={"Authorization": f"Bearer {token}"})
    data = res.json()
    pairs = [(item["grade_code"], item["title"]) for item in data]
    assert pairs == sorted(pairs), (
        f"Lessons not sorted by (grade_code, title): first diff at "
        f"{next((i, pairs[i]) for i in range(len(pairs)-1) if pairs[i] > pairs[i+1])}"
    )
