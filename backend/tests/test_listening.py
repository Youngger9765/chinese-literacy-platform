"""
Tests for the Listening Comprehension module (Issue #251).

Covers:
- evaluate_retelling() service function (mocked Gemini)
- POST /api/learning/listening/evaluate endpoint

Run with:
    cd /path/to/chinese-literacy-platform/backend
    python -m pytest tests/test_listening.py -v
"""

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
    {"name": "org_admin", "display_name": "Organization Admin", "scope_level": "organization"},
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


def _auth_header(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


def _register_and_login(client: TestClient) -> str:
    """Register a student and return their access token."""
    unique = uuid.uuid4().hex[:8]
    email = f"listen_{unique}@example.com"
    resp = client.post(
        "/api/auth/register",
        json={"email": email, "password": "Test1234!", "name": "Listen Tester"},
    )
    assert resp.status_code == 201, resp.text
    return resp.json()["access_token"]


# ---------------------------------------------------------------------------
# Mock AI response
# ---------------------------------------------------------------------------

MOCK_EVAL_RESULT = {
    "score": 75.0,
    "key_points_covered": ["主角是一隻兔子", "兔子跑得很快"],
    "key_points_missed": ["烏龜最後贏得比賽"],
    "feedback": "你掌握了主要角色和情節，不過結局的部分可以更完整。",
    "encouragement": "繼續努力，你做得很好！",
}

# ---------------------------------------------------------------------------
# Unit tests: evaluate_retelling() service
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_evaluate_retelling_returns_expected_keys():
    """evaluate_retelling() returns all required keys."""
    with patch(
        "app.services.listening_service.generate_structured_response",
        new=AsyncMock(return_value=MOCK_EVAL_RESULT),
    ):
        from app.services.listening_service import evaluate_retelling

        result = await evaluate_retelling(
            original_text="從前有一隻烏龜和兔子比賽跑步，最後烏龜贏了。",
            student_retelling="有一隻兔子和一隻動物賽跑，兔子跑得很快。",
            story_title="龜兔賽跑",
        )

    assert set(result.keys()) >= {"score", "key_points_covered", "key_points_missed", "feedback", "encouragement"}
    assert 0 <= result["score"] <= 100
    assert isinstance(result["key_points_covered"], list)
    assert isinstance(result["key_points_missed"], list)


@pytest.mark.asyncio
async def test_evaluate_retelling_clamps_score_above_100():
    """evaluate_retelling() clamps score > 100 to 100."""
    with patch(
        "app.services.listening_service.generate_structured_response",
        new=AsyncMock(return_value={**MOCK_EVAL_RESULT, "score": 999}),
    ):
        from app.services.listening_service import evaluate_retelling

        result = await evaluate_retelling(original_text="課文", student_retelling="覆述")
    assert result["score"] == 100.0


@pytest.mark.asyncio
async def test_evaluate_retelling_clamps_score_below_0():
    """evaluate_retelling() clamps score < 0 to 0."""
    with patch(
        "app.services.listening_service.generate_structured_response",
        new=AsyncMock(return_value={**MOCK_EVAL_RESULT, "score": -50}),
    ):
        from app.services.listening_service import evaluate_retelling

        result = await evaluate_retelling(original_text="課文", student_retelling="覆述")
    assert result["score"] == 0.0


# ---------------------------------------------------------------------------
# API endpoint tests: POST /api/learning/listening/evaluate
# ---------------------------------------------------------------------------


def test_evaluate_endpoint_unauthenticated(client):
    """Unauthenticated request returns 401."""
    res = client.post(
        "/api/learning/listening/evaluate",
        json={
            "story_title": "龜兔賽跑",
            "original_text": "課文內容",
            "student_retelling": "我的覆述",
        },
    )
    assert res.status_code == 401


def test_evaluate_endpoint_empty_retelling(client):
    """Request with empty student_retelling fails validation (422)."""
    token = _register_and_login(client)
    res = client.post(
        "/api/learning/listening/evaluate",
        headers=_auth_header(token),
        json={
            "story_title": "龜兔賽跑",
            "original_text": "課文內容",
            "student_retelling": "",  # empty string — min_length=1 should reject
        },
    )
    assert res.status_code == 422


def test_evaluate_endpoint_success(client):
    """Valid authenticated request returns 200 with expected fields."""
    token = _register_and_login(client)

    with patch(
        "app.services.listening_service.generate_structured_response",
        new=AsyncMock(return_value=MOCK_EVAL_RESULT),
    ):
        res = client.post(
            "/api/learning/listening/evaluate",
            headers=_auth_header(token),
            json={
                "story_title": "龜兔賽跑",
                "original_text": "從前有一隻烏龜和兔子比賽跑步，最後烏龜贏了。",
                "student_retelling": "有一隻兔子和動物賽跑，兔子跑很快。",
            },
        )

    assert res.status_code == 200
    data = res.json()
    assert "score" in data
    assert "key_points_covered" in data
    assert "key_points_missed" in data
    assert "feedback" in data
    assert "encouragement" in data
    assert isinstance(data["score"], float)
    assert isinstance(data["key_points_covered"], list)
    assert isinstance(data["key_points_missed"], list)
    assert 0 <= data["score"] <= 100


def test_evaluate_endpoint_ai_failure_returns_503(client):
    """AI exception causes endpoint to return 503."""
    token = _register_and_login(client)

    with patch(
        "app.services.listening_service.generate_structured_response",
        new=AsyncMock(side_effect=Exception("Gemini unavailable")),
    ):
        res = client.post(
            "/api/learning/listening/evaluate",
            headers=_auth_header(token),
            json={
                "story_title": "龜兔賽跑",
                "original_text": "從前有一隻烏龜和兔子比賽跑步。",
                "student_retelling": "有一隻兔子和動物賽跑。",
            },
        )

    assert res.status_code == 503
    assert "unavailable" in res.json()["detail"].lower()
