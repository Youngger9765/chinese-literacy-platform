"""
TDD tests for LLM endpoint rate limit guards (Issue #1253).

Tests that the two unguarded LLM-calling endpoints now have rate limiters:
  - POST /api/stories/{story_id}/structure/grade
  - POST /api/teacher/students/{id}/sessions/{id}/generate-ai-comment

Design: we patch the rate limiter so it returns False (limit exceeded) and
verify the endpoint returns 429. This confirms the dependency is wired up
without requiring a real Gemini call.

Run:
    cd /path/to/chinese-literacy-platform/backend
    pytest tests/test_llm_rate_limits.py -v
"""
import sys
import os
import uuid
from unittest.mock import patch, MagicMock

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

# ---------------------------------------------------------------------------
# Test DB (SQLite in-memory)
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


def _assign_role(email: str, role_name: str) -> None:
    scope_type_map = {
        "system_admin": "platform",
        "org_admin": "organization",
        "principal": "school",
        "director": "school",
        "teacher": "school",
        "homeroom_teacher": "school",
        "student": "school",
        "parent": "school",
    }
    scope_type = scope_type_map.get(role_name, "platform")

    db = TestingSessionLocal()
    try:
        user = db.query(User).filter(User.email == email).first()
        role = db.query(Role).filter(Role.name == role_name).first()
        existing = db.query(UserRole).filter(
            UserRole.user_id == user.id,
            UserRole.role_id == role.id,
            UserRole.is_active == True,
        ).first()
        if not existing:
            db.add(UserRole(
                user_id=user.id,
                role_id=role.id,
                is_active=True,
                scope_type=scope_type,
            ))
            db.commit()
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


def _register_and_login(client, role: str = "teacher") -> dict:
    """Register a user, assign role, and return auth headers."""
    unique = uuid.uuid4().hex[:8]
    email = f"rltest-{unique}@example.com"
    password = "TestPass123!"

    res = client.post("/api/auth/register", json={
        "email": email,
        "password": password,
        "name": f"RateLimit Test {unique}",
    })
    assert res.status_code in (200, 201), f"Register failed: {res.text}"

    # Handle dev-mode email verification token (if returned)
    verification_token = res.json().get("verification_token")
    if verification_token:
        client.get(f"/api/auth/verify-email?token={verification_token}")

    _assign_role(email, role)

    res = client.post("/api/auth/login", json={"email": email, "password": password})
    assert res.status_code == 200, f"Login failed: {res.text}"
    token = res.json()["access_token"]
    return {"Authorization": f"Bearer {token}"}


# ---------------------------------------------------------------------------
# Tests: POST /api/stories/{story_id}/structure/grade
# ---------------------------------------------------------------------------

class TestStoryStructureGradeRateLimit:
    """Verify POST /api/stories/{story_id}/structure/grade is rate-limited."""

    def test_no_auth_returns_401(self, client):
        """Unauthenticated request must return 401."""
        res = client.post("/api/stories/1/structure/grade", json={"answers": []})
        assert res.status_code == 401, f"Expected 401, got {res.status_code}: {res.text}"

    def test_rate_limit_exceeded_returns_429(self, client):
        """When rate limiter blocks, endpoint must return 429."""
        headers = _register_and_login(client, role="teacher")

        # Patch the rate limiter to simulate limit exceeded
        with patch("app.routes.stories.ai_rate_limiter") as mock_rl:
            mock_rl.check.return_value = False
            res = client.post(
                "/api/stories/1/structure/grade",
                json={"answers": []},
                headers=headers,
            )
        assert res.status_code == 429, (
            f"Expected 429 when rate limit exceeded, got {res.status_code}: {res.text}"
        )

    def test_rate_limit_allowed_proceeds(self, client):
        """When rate limiter passes, endpoint proceeds (may 404/400 but not 429/401)."""
        headers = _register_and_login(client, role="teacher")

        with patch("app.routes.stories.ai_rate_limiter") as mock_rl:
            mock_rl.check.return_value = True
            # Patch AI call to avoid Vertex calls in tests
            with patch("app.routes.stories.grade_story_structure") as mock_grade:
                mock_grade.return_value = {"results": [], "score": 0}
                res = client.post(
                    "/api/stories/1/structure/grade",
                    json={"answers": []},
                    headers=headers,
                )
        # 400 (structure not cached) or 200 are both acceptable; 429 is not
        assert res.status_code != 429, f"Should not 429 when rate limit passes: {res.text}"
        assert res.status_code != 401, f"Should not 401 when authenticated: {res.text}"


# ---------------------------------------------------------------------------
# Tests: POST /api/teacher/students/{id}/sessions/{id}/generate-ai-comment
# ---------------------------------------------------------------------------

class TestGenerateAICommentRateLimit:
    """Verify POST /api/teacher/.../generate-ai-comment is rate-limited.

    Full rate-limit coverage (429 when exceeded, 200 when allowed) is provided
    by the test suite for PR #1254 (the original ai_limit_5_per_min helper,
    Depends-based pattern). This class keeps just the auth smoke test because
    #1253's inline ai_rate_limiter pattern was dropped in favour of the #1254
    helper during rebase onto staging.
    """

    def test_no_auth_returns_401(self, client):
        """Unauthenticated request must return 401."""
        res = client.post("/api/teacher/students/1/sessions/1/generate-ai-comment")
        assert res.status_code == 401, f"Expected 401, got {res.status_code}: {res.text}"
