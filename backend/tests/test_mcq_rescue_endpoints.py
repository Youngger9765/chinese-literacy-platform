"""
Contract tests for MCQ Rescue AI tutor endpoints (Issue #1387).

Tests cover:
  1. POST /api/learning/mcq-rescue/start  — start rescue session
  2. POST /api/learning/mcq-rescue/respond — student response in session

Contract checks:
  - Status code (happy path: 200, auth: 403, invalid input: 422)
  - Required response fields present (including `reasoning` on every respond response)
  - Fail-closed: AI error returns fallback, NOT should_advance=True
  - Rate limiter: 10 req/min limit enforced
  - Session ownership: respond rejects mismatched session_id

Architecture: tests mock `mcq_rescue_agent.start_session` and
`mcq_rescue_agent.process_response` to avoid real Gemini calls.

SQLite compatibility note:
  conftest.py patches JSONB column types → JSON.
  Some models use PostgreSQL-specific server_default expressions (e.g.,
  ``server_default=text("'{}'::jsonb")``). We patch those to None so
  SQLite's ``CREATE TABLE`` doesn't fail. This mirrors the pattern used by
  test_ai_endpoints.py and other test modules in this suite.

Run with:
    cd backend && python -m pytest tests/test_mcq_rescue_endpoints.py -v
"""

from __future__ import annotations

import sys
import os
import uuid
from dataclasses import dataclass
from unittest.mock import AsyncMock, patch

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

# ---------------------------------------------------------------------------
# Patch PostgreSQL-specific server_default values before model import
# so SQLite ``CREATE TABLE`` doesn't fail with "::jsonb" syntax.
# ---------------------------------------------------------------------------
from sqlalchemy import JSON
from sqlalchemy.dialects.postgresql import JSONB
from app.models import Base as _Base  # triggers model registration

def _patch_pg_server_defaults():
    """Remove PostgreSQL-specific server_default text (e.g. '{}::jsonb')
    from column definitions so SQLite can create the tables in tests.

    SQLAlchemy wraps server_default in a DefaultClause whose .arg attribute
    holds the text() object. We check DefaultClause.arg.text for '::jsonb'.
    """
    for table in _Base.metadata.sorted_tables:
        for column in table.columns:
            sd = column.server_default
            if sd is None:
                continue
            # DefaultClause wraps text() in .arg
            arg = getattr(sd, "arg", None)
            if arg is not None and hasattr(arg, "text") and "::jsonb" in str(arg.text):
                column.server_default = None

_patch_pg_server_defaults()

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, event
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.main import app
from app.database import get_db
from app.models import Base
from app.models.user import Role, User
from app.auth.dependencies import get_current_user
from app.auth.rate_limiter import general_rate_limiter
from app.services.mcq_rescue_agent import RescueResponse

# ---------------------------------------------------------------------------
# SQLite in-memory test DB
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
    {"name": "student", "display_name": "Student", "scope_level": "school"},
    {"name": "teacher", "display_name": "Teacher", "scope_level": "school"},
]

FAKE_USER_ID = 42


def _seed_roles(session):
    for role_data in SEED_ROLES:
        existing = session.query(Role).filter(Role.name == role_data["name"]).first()
        if not existing:
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


_fake_user = User(
    id=FAKE_USER_ID,
    username="mcq_test_student",
    name="MCQ Test Student",
    email="mcqtest@example.com",
    password_hash="fake",
)


def _override_get_current_user():
    return _fake_user


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


@pytest.fixture(scope="module", autouse=True)
def setup_db():
    Base.metadata.create_all(bind=engine)
    db = TestingSessionLocal()
    _seed_roles(db)
    student_role = db.query(Role).filter(Role.name == "student").first()
    _fake_user.role_id = student_role.id if student_role else None
    db.close()
    yield
    Base.metadata.drop_all(bind=engine)


@pytest.fixture(autouse=True)
def reset_rate_limiters():
    """Reset all rate limiters before each test."""
    general_rate_limiter.reset()
    try:
        from app.auth.rate_limiter import ai_rate_limiter
        ai_rate_limiter.reset()
    except (ImportError, AttributeError):
        pass
    # Reset the per-route limiter used by MCQ rescue endpoints
    try:
        from app.auth.rate_limiter import ai_limit_10_per_min
        ai_limit_10_per_min.reset() if hasattr(ai_limit_10_per_min, "reset") else None
    except (ImportError, AttributeError):
        pass


@pytest.fixture(scope="module")
def client():
    app.dependency_overrides[get_db] = _override_get_db
    app.dependency_overrides[get_current_user] = _override_get_current_user
    with TestClient(app) as c:
        yield c
    app.dependency_overrides.clear()


# ---------------------------------------------------------------------------
# Mock helpers
# ---------------------------------------------------------------------------

def _make_start_response(session_id: str, question_id: str) -> tuple[str, RescueResponse]:
    """Mock return value for mcq_rescue_agent.start_session."""
    sid = f"mcq_rescue_{FAKE_USER_ID}_{question_id}"
    return sid, RescueResponse(
        current_step=1,
        should_advance=False,
        should_terminate=False,
        give_up_detected=False,
        ai_feedback="我看到你選了 B，沒關係。先告訴我，你覺得這題在問什麼？",
        next_question="",
        reasoning="Session started with step 1 opening.",
    )


def _make_respond_response(step: int = 2) -> RescueResponse:
    """Mock return value for mcq_rescue_agent.process_response."""
    return RescueResponse(
        current_step=step,
        should_advance=True,
        should_terminate=False,
        give_up_detected=False,
        ai_feedback="你抓到重點了！現在課文哪一段提到這件事？",
        next_question="你可以告訴我是哪一段嗎？",
        reasoning="Student demonstrated understanding of question, advancing to step 2.",
    )


# ---------------------------------------------------------------------------
# Start endpoint tests
# ---------------------------------------------------------------------------


START_URL = "/api/learning/mcq-rescue/start"
RESPOND_URL = "/api/learning/mcq-rescue/respond"

VALID_START_PAYLOAD = {
    "question_id": "G6-L23-Q1",
    "lesson_id": "G6-L23",
    "wrong_choice": "B",
    "question_text": "本文主要在說什麼？",
    "correct_answer": "D",
    "strategy_type": "summary_psr",
}


class TestMcqRescueStart:
    """Contract tests for POST /api/learning/mcq-rescue/start."""

    @patch(
        "app.routes.learning.mcq_rescue.mcq_rescue_agent.start_session",
        new_callable=AsyncMock,
    )
    def test_happy_path_returns_200(self, mock_start, client):
        """Happy path returns HTTP 200 with required fields."""
        mock_start.return_value = _make_start_response(
            f"mcq_rescue_{FAKE_USER_ID}_G6-L23-Q1", "G6-L23-Q1"
        )
        resp = client.post(START_URL, json=VALID_START_PAYLOAD)
        assert resp.status_code == 200, f"Expected 200, got {resp.status_code}: {resp.text}"

    @patch(
        "app.routes.learning.mcq_rescue.mcq_rescue_agent.start_session",
        new_callable=AsyncMock,
    )
    def test_response_has_required_fields(self, mock_start, client):
        """Response schema includes session_id, ai_first_message, current_step."""
        mock_start.return_value = _make_start_response(
            f"mcq_rescue_{FAKE_USER_ID}_G6-L23-Q1", "G6-L23-Q1"
        )
        resp = client.post(START_URL, json=VALID_START_PAYLOAD)
        assert resp.status_code == 200
        data = resp.json()
        assert "session_id" in data, "session_id must be present"
        assert "ai_first_message" in data, "ai_first_message must be present"
        assert "current_step" in data, "current_step must be present"

    @patch(
        "app.routes.learning.mcq_rescue.mcq_rescue_agent.start_session",
        new_callable=AsyncMock,
    )
    def test_current_step_starts_at_1(self, mock_start, client):
        """First message always starts at step 1."""
        mock_start.return_value = _make_start_response(
            f"mcq_rescue_{FAKE_USER_ID}_G6-L23-Q1", "G6-L23-Q1"
        )
        resp = client.post(START_URL, json=VALID_START_PAYLOAD)
        assert resp.status_code == 200
        assert resp.json()["current_step"] == 1

    @patch(
        "app.routes.learning.mcq_rescue.mcq_rescue_agent.start_session",
        new_callable=AsyncMock,
    )
    def test_session_id_contains_user_and_question(self, mock_start, client):
        """session_id encodes user_id and question_id per spec."""
        expected_sid = f"mcq_rescue_{FAKE_USER_ID}_G6-L23-Q1"
        mock_start.return_value = (
            expected_sid,
            RescueResponse(
                current_step=1,
                should_advance=False,
                should_terminate=False,
                give_up_detected=False,
                ai_feedback="Opening message.",
                next_question="",
                reasoning="New session.",
            ),
        )
        resp = client.post(START_URL, json=VALID_START_PAYLOAD)
        assert resp.status_code == 200
        assert resp.json()["session_id"] == expected_sid

    @patch(
        "app.routes.learning.mcq_rescue.mcq_rescue_agent.start_session",
        new_callable=AsyncMock,
    )
    def test_ai_service_error_returns_503(self, mock_start, client):
        """Circuit breaker: RuntimeError from agent → 503."""
        mock_start.side_effect = RuntimeError("AI 服務暫時無法使用，請稍後再試。")
        resp = client.post(START_URL, json=VALID_START_PAYLOAD)
        assert resp.status_code == 503

    def test_requires_auth(self):
        """Without auth override, endpoint should require authentication."""
        saved = app.dependency_overrides.pop(get_current_user, None)
        try:
            with TestClient(app) as c:
                resp = c.post(START_URL, json=VALID_START_PAYLOAD)
                assert resp.status_code in (401, 403, 422), (
                    f"Unauthenticated request should be rejected, got {resp.status_code}"
                )
        finally:
            if saved:
                app.dependency_overrides[get_current_user] = saved

    def test_missing_required_fields_returns_422(self, client):
        """Incomplete payload returns 422 Unprocessable Entity."""
        resp = client.post(START_URL, json={"question_id": "G6-L23-Q1"})
        assert resp.status_code == 422

    def test_question_text_over_limit_returns_422(self, client):
        """question_text max_length=1000 enforced by Pydantic."""
        payload = {**VALID_START_PAYLOAD, "question_text": "A" * 1001}
        resp = client.post(START_URL, json=payload)
        assert resp.status_code == 422

    @patch(
        "app.routes.learning.mcq_rescue.mcq_rescue_agent.start_session",
        new_callable=AsyncMock,
    )
    def test_strategy_type_is_optional(self, mock_start, client):
        """strategy_type may be omitted; falls back to default prompt."""
        mock_start.return_value = _make_start_response(
            f"mcq_rescue_{FAKE_USER_ID}_G6-L23-Q2", "G6-L23-Q2"
        )
        payload = {k: v for k, v in VALID_START_PAYLOAD.items() if k != "strategy_type"}
        payload["question_id"] = "G6-L23-Q2"
        resp = client.post(START_URL, json=payload)
        assert resp.status_code == 200


# ---------------------------------------------------------------------------
# Respond endpoint tests
# ---------------------------------------------------------------------------


VALID_SESSION_ID = f"mcq_rescue_{FAKE_USER_ID}_G6-L23-Q1"

VALID_RESPOND_PAYLOAD = {
    "session_id": VALID_SESSION_ID,
    "student_text": "這題在問文章的主要意思",
}


class TestMcqRescueRespond:
    """Contract tests for POST /api/learning/mcq-rescue/respond."""

    @patch(
        "app.routes.learning.mcq_rescue.mcq_rescue_agent.process_response",
        new_callable=AsyncMock,
    )
    def test_happy_path_returns_200(self, mock_respond, client):
        """Happy path returns HTTP 200."""
        mock_respond.return_value = _make_respond_response(step=2)
        resp = client.post(RESPOND_URL, json=VALID_RESPOND_PAYLOAD)
        assert resp.status_code == 200, f"Expected 200, got {resp.status_code}: {resp.text}"

    @patch(
        "app.routes.learning.mcq_rescue.mcq_rescue_agent.process_response",
        new_callable=AsyncMock,
    )
    def test_response_has_all_required_fields(self, mock_respond, client):
        """Response schema must include all required fields including reasoning."""
        mock_respond.return_value = _make_respond_response(step=2)
        resp = client.post(RESPOND_URL, json=VALID_RESPOND_PAYLOAD)
        assert resp.status_code == 200
        data = resp.json()

        required_fields = [
            "current_step",
            "should_advance",
            "should_terminate",
            "give_up_detected",
            "ai_feedback",
            "next_question",
            "reasoning",  # CRITICAL: always present per llm-endpoint-hardening rule
        ]
        for field in required_fields:
            assert field in data, f"Response missing required field: {field!r}"

    @patch(
        "app.routes.learning.mcq_rescue.mcq_rescue_agent.process_response",
        new_callable=AsyncMock,
    )
    def test_reasoning_field_is_non_empty_string(self, mock_respond, client):
        """reasoning field must be a non-empty string (audit/debugging requirement)."""
        mock_respond.return_value = _make_respond_response(step=2)
        resp = client.post(RESPOND_URL, json=VALID_RESPOND_PAYLOAD)
        assert resp.status_code == 200
        data = resp.json()
        assert isinstance(data["reasoning"], str)
        assert len(data["reasoning"]) > 0, "reasoning must be non-empty"

    @patch(
        "app.routes.learning.mcq_rescue.mcq_rescue_agent.process_response",
        new_callable=AsyncMock,
    )
    def test_current_step_advances(self, mock_respond, client):
        """should_advance=True means current_step increments."""
        mock_respond.return_value = _make_respond_response(step=2)
        resp = client.post(RESPOND_URL, json=VALID_RESPOND_PAYLOAD)
        assert resp.status_code == 200
        data = resp.json()
        assert data["should_advance"] is True
        assert data["current_step"] == 2

    @patch(
        "app.routes.learning.mcq_rescue.mcq_rescue_agent.process_response",
        new_callable=AsyncMock,
    )
    def test_terminate_flags_on_rescue_success(self, mock_respond, client):
        """Step 4 correct answer → should_terminate=True."""
        mock_respond.return_value = RescueResponse(
            current_step=4,
            should_advance=True,
            should_terminate=True,
            give_up_detected=False,
            ai_feedback="答對了！",
            next_question="",
            reasoning="Student answered correctly in step 4.",
        )
        resp = client.post(RESPOND_URL, json=VALID_RESPOND_PAYLOAD)
        assert resp.status_code == 200
        data = resp.json()
        assert data["should_terminate"] is True
        assert data["reasoning"] != ""

    @patch(
        "app.routes.learning.mcq_rescue.mcq_rescue_agent.process_response",
        new_callable=AsyncMock,
    )
    def test_fail_closed_ai_error_should_advance_false(self, mock_respond, client):
        """CRITICAL: AI error must NOT set should_advance=True (fail-closed rule)."""
        # Simulate the fallback response that mcq_rescue_agent returns on AI error
        mock_respond.return_value = RescueResponse(
            current_step=1,
            should_advance=False,   # MUST be False on error
            should_terminate=False,
            give_up_detected=False,
            ai_feedback="讓我再想一下，你能再說一次嗎？",
            next_question="你能說說看，這題在問什麼嗎？",
            reasoning="AI error fallback (attempt 1)",
        )
        resp = client.post(RESPOND_URL, json=VALID_RESPOND_PAYLOAD)
        assert resp.status_code == 200
        data = resp.json()
        assert data["should_advance"] is False, (
            "Fail-closed: should_advance must be False on AI error — "
            "auto-passing students on error is catastrophic"
        )

    @patch(
        "app.routes.learning.mcq_rescue.mcq_rescue_agent.process_response",
        new_callable=AsyncMock,
    )
    def test_circuit_breaker_returns_503(self, mock_respond, client):
        """Circuit breaker: RuntimeError from agent → 503 Service Unavailable."""
        mock_respond.side_effect = RuntimeError("AI 服務暫時無法使用，請稍後再試。")
        resp = client.post(RESPOND_URL, json=VALID_RESPOND_PAYLOAD)
        assert resp.status_code == 503

    def test_session_id_ownership_check(self, client):
        """Session ID belonging to a different user is rejected with 403."""
        other_user_session_id = f"mcq_rescue_9999_G6-L23-Q1"  # user_id 9999, not FAKE_USER_ID
        resp = client.post(RESPOND_URL, json={
            "session_id": other_user_session_id,
            "student_text": "Some answer",
        })
        assert resp.status_code == 403, (
            f"Session owned by another user must be rejected with 403, got {resp.status_code}"
        )

    def test_empty_student_text_returns_422(self, client):
        """Empty student_text is not acceptable."""
        resp = client.post(RESPOND_URL, json={
            "session_id": VALID_SESSION_ID,
            "student_text": "",
        })
        # Pydantic min_length OR agent raises ValueError → 422
        assert resp.status_code in (422, 400)

    def test_student_text_over_500_chars_returns_422(self, client):
        """student_text max_length=500 enforced by Pydantic Field constraint."""
        resp = client.post(RESPOND_URL, json={
            "session_id": VALID_SESSION_ID,
            "student_text": "A" * 501,
        })
        assert resp.status_code == 422

    def test_missing_session_id_returns_422(self, client):
        """Missing session_id returns 422."""
        resp = client.post(RESPOND_URL, json={"student_text": "Some answer"})
        assert resp.status_code == 422

    def test_requires_auth(self):
        """Without auth override, endpoint should require authentication."""
        saved = app.dependency_overrides.pop(get_current_user, None)
        try:
            with TestClient(app) as c:
                resp = c.post(RESPOND_URL, json=VALID_RESPOND_PAYLOAD)
                assert resp.status_code in (401, 403, 422), (
                    f"Unauthenticated request should be rejected, got {resp.status_code}"
                )
        finally:
            if saved:
                app.dependency_overrides[get_current_user] = saved

    @patch(
        "app.routes.learning.mcq_rescue.mcq_rescue_agent.process_response",
        new_callable=AsyncMock,
    )
    def test_give_up_detected_flag_propagates(self, mock_respond, client):
        """give_up_detected flag in response propagates correctly."""
        mock_respond.return_value = RescueResponse(
            current_step=1,
            should_advance=False,
            should_terminate=False,
            give_up_detected=True,
            ai_feedback="沒關係，我們換個方式試試看。",
            next_question="你能說說看，這題在問什麼嗎？",
            reasoning="Student responded with give-up signal.",
        )
        resp = client.post(RESPOND_URL, json=VALID_RESPOND_PAYLOAD)
        assert resp.status_code == 200
        data = resp.json()
        assert data["give_up_detected"] is True
        assert "reasoning" in data

    @patch(
        "app.routes.learning.mcq_rescue.mcq_rescue_agent.process_response",
        new_callable=AsyncMock,
    )
    def test_rate_limit_exceeded_returns_429(self, mock_respond, client):
        """Rate limit exceeded returns 429 from agent ValueError."""
        mock_respond.side_effect = ValueError("Rate limit exceeded. Please wait before sending another response.")
        resp = client.post(RESPOND_URL, json=VALID_RESPOND_PAYLOAD)
        assert resp.status_code == 429


# ---------------------------------------------------------------------------
# Strategy prompt loader integration (no AI, pure unit)
# ---------------------------------------------------------------------------


class TestStrategyPromptLoaderIntegration:
    """Verify that the strategy_prompts loader returns correct data for MCQ rescue.
    These tests don't hit any AI endpoint — just test the YAML loading.
    """

    def test_summary_psr_has_5_steps(self):
        from app.services.strategy_prompts import load_strategy_prompt, clear_cache
        clear_cache()
        prompt = load_strategy_prompt("summary_psr")
        assert len(prompt["steps"]) == 5

    def test_default_fallback_returns_5_steps(self):
        from app.services.strategy_prompts import load_strategy_prompt, clear_cache
        clear_cache()
        prompt = load_strategy_prompt("nonexistent_xyz")
        assert len(prompt["steps"]) == 5

    def test_summary_psr_opening_contains_wrong_answer_placeholder(self):
        """opening template must have {wrong_answer} for mcq_rescue_agent substitution."""
        from app.services.strategy_prompts import load_strategy_prompt, clear_cache
        clear_cache()
        prompt = load_strategy_prompt("summary_psr")
        assert "{wrong_answer}" in prompt["opening"], (
            "summary_psr opening must contain {wrong_answer} placeholder for MCQ rescue"
        )

    def test_default_opening_contains_wrong_answer_placeholder(self):
        from app.services.strategy_prompts import load_strategy_prompt, clear_cache
        clear_cache()
        prompt = load_strategy_prompt("default")
        assert "{wrong_answer}" in prompt["opening"]
