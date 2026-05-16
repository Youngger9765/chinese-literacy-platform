"""
Issue #1648: Deprecation of standalone /api/learning/ai-analysis endpoint.

Tests:
- Standalone endpoint logs a DEPRECATED warning on every call
- Standalone endpoint still returns 200 (backward-compatible, not removed)
- Deprecation warning message contains the issue number and migration path
"""

import logging
import sys
import os
import uuid
from unittest.mock import AsyncMock, patch

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


# ---------------------------------------------------------------------------
# Test DB setup (same pattern as test_ai_analysis.py)
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


MOCK_ANALYSIS = {
    "analysis_summary": "你的朗讀表現整體不錯",
    "strengths": ["發音清晰"],
    "areas_for_improvement": ["注意多音字"],
    "practice_suggestions": ["每天練習 10 分鐘"],
    "encouragement_message": "加油！",
}

ANALYSIS_PAYLOAD = {
    "story_title": "玉山之美",
    "accuracy": 85.0,
    "cpm": 120.0,
    "error_chars": ["山"],
    "total_characters": 200,
}


@pytest.fixture(autouse=True)
def reset_rate_limiter():
    from app.auth.rate_limiter import ai_rate_limiter
    ai_rate_limiter.reset()


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


def _register_and_login(client, suffix=None):
    unique = suffix or uuid.uuid4().hex[:8]
    email = f"depr_user_{unique}@example.com"
    password = "SecurePass123!"
    name = f"Depr User {unique}"
    resp = client.post("/api/auth/register", json={"email": email, "password": password, "name": name})
    assert resp.status_code == 201, resp.text
    verification_token = resp.json().get("verification_token")
    if verification_token:
        resp = client.post("/api/auth/verify-email", json={"token": verification_token})
        assert resp.status_code == 200, resp.text
    resp = client.post("/api/auth/login", json={"email": email, "password": password})
    assert resp.status_code == 200, resp.text
    return resp.json()["access_token"]


@pytest.fixture(scope="module")
def token(client):
    return _register_and_login(client, "depr_a")


def auth_header(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------


class TestStandaloneEndpointDeprecation:
    """Verify the deprecation warning is emitted on every call to the standalone endpoint."""

    @patch("app.routes.learning.learning_reading.generate_reading_analysis", new_callable=AsyncMock)
    def test_deprecated_warning_logged_on_standalone_call(self, mock_gen, client, token, caplog):
        """Every call to /api/learning/ai-analysis must emit a DEPRECATED warning log."""
        mock_gen.return_value = MOCK_ANALYSIS

        with caplog.at_level(logging.WARNING, logger="app.routes.learning.learning_reading"):
            resp = client.post(
                "/api/learning/ai-analysis",
                json=ANALYSIS_PAYLOAD,
                headers=auth_header(token),
            )

        assert resp.status_code == 200, resp.text

        # The DEPRECATED warning must be present in the log
        deprecated_logs = [r for r in caplog.records if "DEPRECATED" in r.message]
        assert len(deprecated_logs) >= 1, (
            f"Expected at least 1 DEPRECATED warning, got: {[r.message for r in caplog.records]}"
        )

    @patch("app.routes.learning.learning_reading.generate_reading_analysis", new_callable=AsyncMock)
    def test_deprecated_warning_mentions_issue_1648(self, mock_gen, client, token, caplog):
        """The deprecation warning message must reference Issue #1648."""
        mock_gen.return_value = MOCK_ANALYSIS

        with caplog.at_level(logging.WARNING, logger="app.routes.learning.learning_reading"):
            client.post(
                "/api/learning/ai-analysis",
                json=ANALYSIS_PAYLOAD,
                headers=auth_header(token),
            )

        deprecated_logs = [r for r in caplog.records if "DEPRECATED" in r.message]
        assert any("#1648" in r.message for r in deprecated_logs), (
            f"Deprecation log should mention #1648. Got: {[r.message for r in deprecated_logs]}"
        )

    @patch("app.routes.learning.learning_reading.generate_reading_analysis", new_callable=AsyncMock)
    def test_deprecated_warning_mentions_session_scoped_endpoint(self, mock_gen, client, token, caplog):
        """The deprecation warning must mention the replacement session-scoped endpoint."""
        mock_gen.return_value = MOCK_ANALYSIS

        with caplog.at_level(logging.WARNING, logger="app.routes.learning.learning_reading"):
            client.post(
                "/api/learning/ai-analysis",
                json=ANALYSIS_PAYLOAD,
                headers=auth_header(token),
            )

        deprecated_logs = [r for r in caplog.records if "DEPRECATED" in r.message]
        assert any("sessions/" in r.message and "ai-analysis" in r.message for r in deprecated_logs), (
            f"Deprecation log should mention sessions/{{id}}/ai-analysis. Got: {[r.message for r in deprecated_logs]}"
        )

    @patch("app.routes.learning.learning_reading.generate_reading_analysis", new_callable=AsyncMock)
    def test_standalone_still_returns_200_backward_compatible(self, mock_gen, client, token):
        """Endpoint is deprecated but NOT removed — must still return 200 for backward compat."""
        mock_gen.return_value = MOCK_ANALYSIS

        resp = client.post(
            "/api/learning/ai-analysis",
            json=ANALYSIS_PAYLOAD,
            headers=auth_header(token),
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["analysis_summary"] == MOCK_ANALYSIS["analysis_summary"]

    @patch("app.routes.learning.learning_reading.generate_reading_analysis", new_callable=AsyncMock)
    def test_deprecated_warning_logged_on_each_call(self, mock_gen, client, token, caplog):
        """Warning must fire on EVERY call, not just the first one."""
        mock_gen.return_value = MOCK_ANALYSIS

        with caplog.at_level(logging.WARNING, logger="app.routes.learning.learning_reading"):
            client.post("/api/learning/ai-analysis", json=ANALYSIS_PAYLOAD, headers=auth_header(token))
            call_1_count = len([r for r in caplog.records if "DEPRECATED" in r.message])

            client.post("/api/learning/ai-analysis", json=ANALYSIS_PAYLOAD, headers=auth_header(token))
            call_2_count = len([r for r in caplog.records if "DEPRECATED" in r.message])

        assert call_2_count > call_1_count, (
            "Second call should also emit DEPRECATED warning. "
            f"call_1_count={call_1_count}, call_2_count={call_2_count}"
        )
