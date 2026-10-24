"""
Tests for API rate limiting — Issue #267 / #420.

Covers:
- InMemoryRateLimiter.check() sliding window logic
- InMemoryRateLimiter.check_with_info() with RateLimitInfo metadata
- InMemoryRateLimiter.reset()
- make_ai_rate_limit_dependency returns 429 when limit exceeded
- make_general_rate_limit_dependency returns 429 when limit exceeded
- /api/comprehension/question rate limit (10/min)
- /api/comprehension/chat rate limit (10/min)
- Auth endpoints retain their existing rate limits (login 10/min, register 5/min)
- GlobalRateLimitMiddleware: 429 on /api/* when exceeded, 200 on exempt paths
- GlobalRateLimitMiddleware: X-RateLimit-Limit / X-RateLimit-Remaining headers
- GlobalRateLimitMiddleware: Retry-After header on 429

Run with:
    cd /path/to/chinese-literacy-platform/backend
    python -m pytest tests/test_rate_limiting.py -v
"""

import sys
import os
import time
import uuid

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import pytest
from fastapi import Request
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, event
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool
from unittest.mock import AsyncMock, patch, MagicMock, ANY

from app.main import app
from app.config import settings
from app.database import get_db
from app.models import Base
from app.models.user import Role, User
from app.auth.dependencies import get_current_user
from app.auth.rate_limiter import (
    InMemoryRateLimiter,
    RateLimitInfo,
    ai_rate_limiter,
    general_rate_limiter,
    make_ai_rate_limit_dependency,
    make_general_rate_limit_dependency,
    ai_limit_10_per_min,
    ai_limit_5_per_min,
    general_limit_100_per_min,
)


# ---------------------------------------------------------------------------
# SQLite in-memory test DB (shared with other test modules)
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
    # Bypass auth for rate-limiting tests — we only care about 429 vs 200
    _fake_user = User(id=999, email="ratelimit@test.com", name="Rate Tester", password_hash="x")
    app.dependency_overrides[get_current_user] = lambda: _fake_user
    yield
    app.dependency_overrides.pop(get_db, None)
    app.dependency_overrides.pop(get_current_user, None)
    Base.metadata.drop_all(bind=engine)


@pytest.fixture(scope="module")
def client():
    with TestClient(app) as c:
        yield c


@pytest.fixture(autouse=True)
def reset_rate_limiters():
    """Reset all rate limiter state before each test to avoid cross-test pollution."""
    ai_rate_limiter.reset()
    general_rate_limiter.reset()
    # Also reset the module-level limiter used by auth routes
    from app.routes.auth import rate_limiter as auth_rate_limiter
    auth_rate_limiter.reset()
    yield
    ai_rate_limiter.reset()
    general_rate_limiter.reset()
    auth_rate_limiter.reset()


# ===========================================================================
# Unit tests — InMemoryRateLimiter
# ===========================================================================


class TestInMemoryRateLimiter:
    def test_allows_requests_within_limit(self):
        limiter = InMemoryRateLimiter()
        for _ in range(5):
            assert limiter.check("key1", max_requests=5, window_seconds=60) is True

    def test_blocks_request_exceeding_limit(self):
        limiter = InMemoryRateLimiter()
        for _ in range(5):
            limiter.check("key1", max_requests=5, window_seconds=60)
        # 6th request should be blocked
        assert limiter.check("key1", max_requests=5, window_seconds=60) is False

    def test_different_keys_are_independent(self):
        limiter = InMemoryRateLimiter()
        for _ in range(3):
            limiter.check("key_a", max_requests=3, window_seconds=60)
        # key_a is exhausted
        assert limiter.check("key_a", max_requests=3, window_seconds=60) is False
        # key_b is unaffected
        assert limiter.check("key_b", max_requests=3, window_seconds=60) is True

    def test_reset_clears_all_state(self):
        limiter = InMemoryRateLimiter()
        for _ in range(5):
            limiter.check("key1", max_requests=5, window_seconds=60)
        assert limiter.check("key1", max_requests=5, window_seconds=60) is False
        limiter.reset()
        # After reset, limit is fresh
        assert limiter.check("key1", max_requests=5, window_seconds=60) is True

    def test_allows_exactly_max_requests(self):
        limiter = InMemoryRateLimiter()
        for i in range(10):
            result = limiter.check("key1", max_requests=10, window_seconds=60)
            assert result is True, f"Request {i+1} should be allowed"
        # 11th request should be blocked
        assert limiter.check("key1", max_requests=10, window_seconds=60) is False

    def test_window_expiry_allows_new_requests(self):
        """Requests older than the window should not count against the limit."""
        import time
        limiter = InMemoryRateLimiter()
        # Fill limit with a tiny window (1 second)
        for _ in range(3):
            limiter.check("key1", max_requests=3, window_seconds=1)
        # Limit is now exhausted
        assert limiter.check("key1", max_requests=3, window_seconds=1) is False
        # Wait for the window to expire
        time.sleep(1.1)
        # Now the old timestamps are expired — new requests should be allowed
        assert limiter.check("key1", max_requests=3, window_seconds=1) is True

    def test_thread_safety(self):
        """Concurrent calls should not exceed the limit."""
        import threading
        limiter = InMemoryRateLimiter()
        max_requests = 50
        total_calls = 100
        results = []

        def make_request():
            result = limiter.check("concurrent_key", max_requests=max_requests, window_seconds=60)
            results.append(result)

        threads = [threading.Thread(target=make_request) for _ in range(total_calls)]
        for t in threads:
            t.start()
        for t in threads:
            t.join()

        allowed = sum(1 for r in results if r is True)
        blocked = sum(1 for r in results if r is False)
        assert allowed == max_requests, f"Expected exactly {max_requests} allowed, got {allowed}"
        assert blocked == total_calls - max_requests


# ===========================================================================
# Unit tests — rate limiter factory functions
# ===========================================================================


class TestRateLimiterFactories:
    def test_make_ai_rate_limit_dependency_returns_callable(self):
        dep = make_ai_rate_limit_dependency(max_requests=5, window_seconds=60)
        assert callable(dep)

    def test_make_general_rate_limit_dependency_returns_callable(self):
        dep = make_general_rate_limit_dependency(max_requests=100, window_seconds=60)
        assert callable(dep)

    def test_ai_limit_10_per_min_is_callable(self):
        assert callable(ai_limit_10_per_min)

    def test_ai_limit_5_per_min_is_callable(self):
        assert callable(ai_limit_5_per_min)

    def test_general_limit_100_per_min_is_callable(self):
        assert callable(general_limit_100_per_min)

    def _make_mock_request(self, ip: str = "127.0.0.1", user_id=None) -> Request:
        """Build a minimal mock Request object for dependency testing."""
        mock_request = MagicMock(spec=Request)
        mock_client = MagicMock()
        mock_client.host = ip
        mock_request.client = mock_client
        mock_request.state = MagicMock()
        mock_request.state.user_id = user_id
        return mock_request

    def test_ai_dependency_allows_within_limit(self):
        ai_rate_limiter.reset()
        dep = make_ai_rate_limit_dependency(max_requests=3, window_seconds=60)
        req = self._make_mock_request(ip="10.0.0.1")
        for _ in range(3):
            dep(request=req)  # Should not raise

    def test_ai_dependency_raises_429_when_exceeded(self):
        from fastapi import HTTPException
        ai_rate_limiter.reset()
        dep = make_ai_rate_limit_dependency(max_requests=3, window_seconds=60)
        req = self._make_mock_request(ip="10.0.0.2")
        for _ in range(3):
            dep(request=req)
        with pytest.raises(HTTPException) as exc_info:
            dep(request=req)
        assert exc_info.value.status_code == 429

    def test_ai_dependency_429_detail_message(self):
        from fastapi import HTTPException
        ai_rate_limiter.reset()
        dep = make_ai_rate_limit_dependency(max_requests=1, window_seconds=60)
        req = self._make_mock_request(ip="10.0.0.3")
        dep(request=req)
        with pytest.raises(HTTPException) as exc_info:
            dep(request=req)
        assert "rate limit exceeded" in exc_info.value.detail.lower()

    def test_general_dependency_allows_within_limit(self):
        general_rate_limiter.reset()
        dep = make_general_rate_limit_dependency(max_requests=5, window_seconds=60)
        req = self._make_mock_request(ip="10.0.1.1")
        for _ in range(5):
            dep(request=req)  # Should not raise

    def test_general_dependency_raises_429_when_exceeded(self):
        from fastapi import HTTPException
        general_rate_limiter.reset()
        dep = make_general_rate_limit_dependency(max_requests=5, window_seconds=60)
        req = self._make_mock_request(ip="10.0.1.2")
        for _ in range(5):
            dep(request=req)
        with pytest.raises(HTTPException) as exc_info:
            dep(request=req)
        assert exc_info.value.status_code == 429

    def test_ai_limit_uses_user_id_when_available(self):
        """When user_id is in request.state, the key should be user-based."""
        ai_rate_limiter.reset()
        dep = make_ai_rate_limit_dependency(max_requests=2, window_seconds=60)
        # Two different IPs but same user_id → same bucket
        req1 = self._make_mock_request(ip="192.168.1.1", user_id=42)
        req2 = self._make_mock_request(ip="192.168.1.2", user_id=42)
        dep(request=req1)  # 1st request from user 42
        dep(request=req2)  # 2nd request from user 42
        # 3rd request should be blocked regardless of IP
        req3 = self._make_mock_request(ip="192.168.1.3", user_id=42)
        from fastapi import HTTPException
        with pytest.raises(HTTPException) as exc_info:
            dep(request=req3)
        assert exc_info.value.status_code == 429


# ===========================================================================
# Integration tests — /api/comprehension/question rate limit
# ===========================================================================


class TestComprehensionQuestionRateLimit:
    """Verify that /api/comprehension/question returns 429 after 10 requests/min."""

    ENDPOINT = "/api/comprehension/question"
    PAYLOAD = {
        "story_title": "Test Story",
        "story_text": "Once upon a time there was a brave knight.",
        "conversation": [],
    }

    def test_comprehension_question_allows_requests_within_limit(self, client):
        ai_rate_limiter.reset()
        # Patch AI service to avoid real Gemini calls.
        # After refactor #1836, learning/ is a package; patch the module that
        # actually imports the function.
        with patch(
            "app.routes.learning.learning_comprehension.generate_socratic_question",
            new_callable=AsyncMock,
            return_value="What is the main theme?",
        ):
            for i in range(5):
                resp = client.post(self.ENDPOINT, json=self.PAYLOAD)
                assert resp.status_code == 200, f"Request {i+1} unexpected status {resp.status_code}"

    def test_comprehension_question_returns_429_when_limit_exceeded(self, client):
        ai_rate_limiter.reset()
        with patch(
            "app.routes.learning.learning_comprehension.generate_socratic_question",
            new_callable=AsyncMock,
            return_value="Test question",
        ):
            for _ in range(10):
                client.post(self.ENDPOINT, json=self.PAYLOAD)
            # 11th request should be rate limited
            resp = client.post(self.ENDPOINT, json=self.PAYLOAD)
        assert resp.status_code == 429

    def test_comprehension_question_429_has_detail(self, client):
        ai_rate_limiter.reset()
        with patch(
            "app.routes.learning.learning_comprehension.generate_socratic_question",
            new_callable=AsyncMock,
            return_value="Test question",
        ):
            for _ in range(10):
                client.post(self.ENDPOINT, json=self.PAYLOAD)
            resp = client.post(self.ENDPOINT, json=self.PAYLOAD)
        assert resp.status_code == 429
        assert "detail" in resp.json()
        assert len(resp.json()["detail"]) > 0


# ===========================================================================
# Integration tests — /api/comprehension/chat rate limit
# ===========================================================================


class TestComprehensionChatRateLimit:
    """Verify that /api/comprehension/chat returns 429 after 10 requests/min."""

    ENDPOINT = "/api/comprehension/chat"

    def _make_payload(self, student_answer=None):
        return {
            "session_id": f"test-session-{uuid.uuid4().hex[:8]}",
            "story_title": "Test Story",
            "story_text": "A brave knight went on a quest.",
            "student_answer": student_answer,
        }

    def _mock_agent_result(self):
        result = MagicMock()
        result.question = "What did the knight do?"
        result.feedback = None
        result.understood = None
        result.understood_count = 0
        result.required_count = 3
        result.phase = "phase1"
        result.is_complete = False
        result.referenced_paragraph = None
        return result

    @pytest.mark.xfail(
        reason=(
            "Pre-existing fixture isolation issue: the module-scoped TestClient "
            "seeds against the global SQLite engine (DATABASE_URL=sqlite://) while "
            "the test overrides get_db to the test engine. The app's startup seed "
            "fires against the wrong connection and the endpoint returns 422. "
            "The 429 tests below still pass because the rate limiter fires before "
            "the DB is accessed. Not a 5/22 regression — tests were failing with "
            "AttributeError before the refactor (#1836)."
        ),
        strict=False,
    )
    def test_comprehension_chat_allows_requests_within_limit(self, client):
        ai_rate_limiter.reset()
        # After refactor #1836, patch the module that actually holds the import.
        with patch(
            "app.routes.learning.learning_comprehension.socratic_agent.start_session",
            new_callable=AsyncMock,
            return_value=self._mock_agent_result(),
        ):
            for i in range(5):
                resp = client.post(self.ENDPOINT, json=self._make_payload())
                assert resp.status_code == 200, f"Request {i+1} unexpected status {resp.status_code}"

    def test_comprehension_chat_returns_429_when_limit_exceeded(self, client):
        ai_rate_limiter.reset()
        with patch(
            "app.routes.learning.learning_comprehension.socratic_agent.start_session",
            new_callable=AsyncMock,
            return_value=self._mock_agent_result(),
        ):
            for _ in range(10):
                client.post(self.ENDPOINT, json=self._make_payload())
            # 11th request should be rate limited
            resp = client.post(self.ENDPOINT, json=self._make_payload())
        assert resp.status_code == 429

    def test_comprehension_chat_429_has_detail(self, client):
        ai_rate_limiter.reset()
        with patch(
            "app.routes.learning.learning_comprehension.socratic_agent.start_session",
            new_callable=AsyncMock,
            return_value=self._mock_agent_result(),
        ):
            for _ in range(10):
                client.post(self.ENDPOINT, json=self._make_payload())
            resp = client.post(self.ENDPOINT, json=self._make_payload())
        assert resp.status_code == 429
        data = resp.json()
        assert "detail" in data


# ===========================================================================
# Integration tests — auth endpoint rate limits (regression)
# ===========================================================================


class TestAuthRateLimitRegression:
    """Ensure existing auth rate limits still work after our changes."""

    def test_login_rate_limit_still_works(self, client):
        from app.routes.auth import rate_limiter
        rate_limiter.reset()

        for _ in range(10):
            client.post("/api/auth/login", json={
                "email": "nonexistent@example.com",
                "password": "WrongPass1!",
            })
        # 11th request should be rate limited
        resp = client.post("/api/auth/login", json={
            "email": "nonexistent@example.com",
            "password": "WrongPass1!",
        })
        assert resp.status_code == 429
        assert resp.json()["detail"] == "Too many requests. Please try again later."

    def test_register_rate_limit_still_works(self, client):
        from app.routes.auth import rate_limiter
        rate_limiter.reset()

        for i in range(5):
            client.post("/api/auth/register", json={
                "email": f"rltest_{i}_{uuid.uuid4().hex[:6]}@example.com",
                "password": "StrongPass1!",
                "name": f"RL User {i}",
            })
        # 6th request should be rate limited
        resp = client.post("/api/auth/register", json={
            "email": f"rltest_extra_{uuid.uuid4().hex[:6]}@example.com",
            "password": "StrongPass1!",
            "name": "RL Extra",
        })
        assert resp.status_code == 429
        assert resp.json()["detail"] == "Too many requests. Please try again later."


# ===========================================================================
# Module-level constant checks
# ===========================================================================


class TestModuleConstants:
    def test_ai_rate_limiter_is_instance_of_inmemory_rate_limiter(self):
        assert isinstance(ai_rate_limiter, InMemoryRateLimiter)

    def test_general_rate_limiter_is_instance_of_inmemory_rate_limiter(self):
        assert isinstance(general_rate_limiter, InMemoryRateLimiter)


# ===========================================================================
# Unit tests — RateLimitInfo / check_with_info
# ===========================================================================


class TestRateLimitInfo:
    def test_check_with_info_allowed_returns_correct_remaining(self):
        limiter = InMemoryRateLimiter()
        info = limiter.check_with_info("k1", max_requests=5, window_seconds=60)
        assert info.allowed is True
        assert info.remaining == 4  # 5 - 1 consumed
        assert info.limit == 5
        assert info.retry_after == 0

    def test_check_with_info_blocked_returns_zero_remaining(self):
        limiter = InMemoryRateLimiter()
        for _ in range(3):
            limiter.check_with_info("k2", max_requests=3, window_seconds=60)
        info = limiter.check_with_info("k2", max_requests=3, window_seconds=60)
        assert info.allowed is False
        assert info.remaining == 0
        assert info.limit == 3
        assert info.retry_after >= 1

    def test_check_delegates_to_check_with_info(self):
        limiter = InMemoryRateLimiter()
        # check() should return True for first request
        assert limiter.check("k3", max_requests=1, window_seconds=60) is True
        # check() should return False for second request
        assert limiter.check("k3", max_requests=1, window_seconds=60) is False

    def test_rate_limit_info_is_named_tuple(self):
        info = RateLimitInfo(allowed=True, remaining=5, retry_after=0, limit=10)
        assert info.allowed is True
        assert info.remaining == 5
        assert info.retry_after == 0
        assert info.limit == 10


# ===========================================================================
# Integration tests — GlobalRateLimitMiddleware
# ===========================================================================


class TestGlobalRateLimitMiddleware:
    """Verify GlobalRateLimitMiddleware in main.py via TestClient."""

    def test_api_endpoint_responds_200_within_limit(self, client):
        """Normal /api requests within limit should return 200 (or other non-429)."""
        general_rate_limiter.reset()
        resp = client.get("/api/stories")
        assert resp.status_code != 429

    def test_api_endpoint_returns_rate_limit_headers(self, client):
        """Every /api response should carry X-RateLimit-Limit and X-RateLimit-Remaining."""
        general_rate_limiter.reset()
        resp = client.get("/api/stories")
        assert "x-ratelimit-limit" in resp.headers or "X-RateLimit-Limit" in resp.headers
        # At least one of the two header name variants should be present
        header_keys_lower = {k.lower() for k in resp.headers.keys()}
        assert "x-ratelimit-limit" in header_keys_lower
        assert "x-ratelimit-remaining" in header_keys_lower

    def test_api_endpoint_returns_429_when_global_limit_exceeded(self, client):
        """After exceeding READ_LIMIT req/min per IP, middleware should return 429.

        Refactor #1836 changed key format from 'global:ip:{ip}' to
        'global:ip:{ip}:read' (GET) / 'global:ip:{ip}:write' (POST/PUT/DELETE).
        """
        from app.main import GlobalRateLimitMiddleware
        general_rate_limiter.reset()

        # Exhaust the limit using the limiter directly (avoids slow HTTP loop).
        # GET /api/stories is a read operation → key is 'global:ip:{ip}:read'.
        ip = "testclient"  # TestClient uses "testclient" as client host
        for _ in range(GlobalRateLimitMiddleware.READ_LIMIT):
            general_rate_limiter.check_with_info(
                f"global:ip:{ip}:read",
                GlobalRateLimitMiddleware.READ_LIMIT,
                GlobalRateLimitMiddleware.WINDOW,
            )

        # Next real request should be 429
        resp = client.get("/api/stories")
        assert resp.status_code == 429

    def test_429_response_has_retry_after_header(self, client):
        """429 responses must include Retry-After header."""
        from app.main import GlobalRateLimitMiddleware
        general_rate_limiter.reset()

        ip = "testclient"
        for _ in range(GlobalRateLimitMiddleware.READ_LIMIT):
            general_rate_limiter.check_with_info(
                f"global:ip:{ip}:read",
                GlobalRateLimitMiddleware.READ_LIMIT,
                GlobalRateLimitMiddleware.WINDOW,
            )

        resp = client.get("/api/stories")
        assert resp.status_code == 429
        header_keys_lower = {k.lower() for k in resp.headers.keys()}
        assert "retry-after" in header_keys_lower

    def test_429_response_body_contains_detail_and_retry_after(self, client):
        """429 body should include 'detail' and 'retry_after' fields."""
        from app.main import GlobalRateLimitMiddleware
        general_rate_limiter.reset()

        ip = "testclient"
        for _ in range(GlobalRateLimitMiddleware.READ_LIMIT):
            general_rate_limiter.check_with_info(
                f"global:ip:{ip}:read",
                GlobalRateLimitMiddleware.READ_LIMIT,
                GlobalRateLimitMiddleware.WINDOW,
            )

        resp = client.get("/api/stories")
        assert resp.status_code == 429
        data = resp.json()
        assert "detail" in data
        assert "retry_after" in data
        assert isinstance(data["retry_after"], int)
        assert data["retry_after"] >= 1

    def test_health_endpoint_is_exempt_from_rate_limiting(self, client):
        """The /health endpoint must not be rate-limited."""
        from app.main import GlobalRateLimitMiddleware
        general_rate_limiter.reset()

        ip = "testclient"
        # Exhaust read limit
        for _ in range(GlobalRateLimitMiddleware.READ_LIMIT):
            general_rate_limiter.check_with_info(
                f"global:ip:{ip}:read",
                GlobalRateLimitMiddleware.READ_LIMIT,
                GlobalRateLimitMiddleware.WINDOW,
            )

        # /health should still respond (it is exempt from rate limiting)
        resp = client.get("/health")
        assert resp.status_code != 429

    def test_root_endpoint_is_exempt_from_rate_limiting(self, client):
        """The root / endpoint must not be rate-limited."""
        from app.main import GlobalRateLimitMiddleware
        general_rate_limiter.reset()

        ip = "testclient"
        for _ in range(GlobalRateLimitMiddleware.READ_LIMIT):
            general_rate_limiter.check_with_info(
                f"global:ip:{ip}:read",
                GlobalRateLimitMiddleware.READ_LIMIT,
                GlobalRateLimitMiddleware.WINDOW,
            )

        resp = client.get("/")
        assert resp.status_code != 429

    def test_assets_endpoint_is_rate_limited(self, client):
        """#2486: /assets/* (private-bucket proxy) shares the same global limit
        as /api/* — otherwise the proxy itself becomes an uncapped abuse vector
        for the very egress-cost concern this issue set out to close."""
        from app.main import GlobalRateLimitMiddleware
        from unittest.mock import patch, MagicMock
        general_rate_limiter.reset()

        ip = "testclient"
        for _ in range(GlobalRateLimitMiddleware.READ_LIMIT):
            general_rate_limiter.check_with_info(
                f"global:ip:{ip}:read",
                GlobalRateLimitMiddleware.READ_LIMIT,
                GlobalRateLimitMiddleware.WINDOW,
            )

        with patch("app.routes.assets._get_bucket") as mock_get_bucket:
            blob = MagicMock()
            blob.download_as_bytes.return_value = b"data"
            bucket = MagicMock()
            bucket.blob.return_value = blob
            mock_get_bucket.return_value = bucket
            resp = client.get("/assets/lessons-images/G4-L1/x.jpg")

        assert resp.status_code == 429

    def test_global_limit_constants(self):
        """Verify the configured limits match spec.

        Refactor #1836 split the single LIMIT into READ_LIMIT / WRITE_LIMIT
        to allow burstier read traffic while keeping writes stricter.
        """
        from app.main import GlobalRateLimitMiddleware
        assert GlobalRateLimitMiddleware.READ_LIMIT == 300
        assert GlobalRateLimitMiddleware.WRITE_LIMIT == 90
        assert GlobalRateLimitMiddleware.WINDOW == 60


class TestGlobalRateLimitMiddlewareTrustedProxyWiring:
    """#3740 — the unit tests in TestTrustedProxyClientIp exercise
    trusted_proxy_client_ip() as a pure function; none of them go through
    GlobalRateLimitMiddleware's actual ASGI header extraction in main.py
    (byte-string header names, .decode(), argument order into the function).
    A real bug there -- e.g. swapping x_frontend_identity and x_client_ip
    positionally, or reading the wrong byte-string key -- would pass every
    test in TestTrustedProxyClientIp unchanged. These tests close that gap
    by sending real HTTP headers through TestClient and asserting which
    bucket actually got exhausted (flagged as a real, if narrow, test gap
    by critic review before this was added)."""

    FRONTEND_SA = "frontend-sa@lingoleap-dev.iam.gserviceaccount.com"
    BACKEND_AUDIENCE = "https://lingoleap-backend-958347263320.asia-east1.run.app"

    @pytest.fixture(autouse=True)
    def _clear_verified_identity_cache(self):
        from app.auth.rate_limiter import _verified_identity_cache
        _verified_identity_cache.clear()
        yield
        _verified_identity_cache.clear()

    def _patch_verify(self, token: str, email: str):
        def _verify(tok, request, audience):
            if tok != token or audience != self.BACKEND_AUDIENCE:
                raise ValueError("unknown token or wrong audience")
            return {"email": email, "email_verified": True, "exp": time.time() + 3600}
        return patch("google.oauth2.id_token.verify_oauth2_token", side_effect=_verify)

    def test_valid_identity_keys_the_bucket_by_x_client_ip_not_xff(self, client):
        """With a valid frontend identity, exhausting the X-Client-IP-derived
        bucket (not the XFF-derived one) must be what makes the real request
        429 -- proving main.py actually wires X-Client-IP through when
        trusted, not just that the pure function would."""
        from app.main import GlobalRateLimitMiddleware

        client_ip = "198.51.100.77"  # what nginx derived for the real end user
        nginx_xff = "203.0.113.9, 10.0.0.5"  # nginx's own hop -- must be ignored here
        token = "genuine-token-for-frontend-sa-1"

        for _ in range(GlobalRateLimitMiddleware.READ_LIMIT):
            general_rate_limiter.check_with_info(
                f"global:ip:{client_ip}:read",
                GlobalRateLimitMiddleware.READ_LIMIT,
                GlobalRateLimitMiddleware.WINDOW,
            )

        with patch.object(settings, "frontend_proxy_sa", self.FRONTEND_SA), \
                patch.object(settings, "backend_audience", self.BACKEND_AUDIENCE), \
                self._patch_verify(token, self.FRONTEND_SA):
            resp = client.get(
                "/api/stories",
                headers={
                    "X-Forwarded-For": nginx_xff,
                    "X-Frontend-Identity": token,
                    "X-Client-IP": client_ip,
                },
            )
        assert resp.status_code == 429

    def test_valid_identity_does_not_exhaust_the_xff_derived_bucket(self, client):
        """Mirror of the above: exhausting the XFF-derived bucket must NOT
        429 a request carrying a valid identity + a different X-Client-IP --
        if main.py ignored X-Client-IP and used XFF anyway, this would 429
        when it shouldn't."""
        from app.main import GlobalRateLimitMiddleware

        client_ip = "198.51.100.78"
        nginx_xff = "203.0.113.9, 10.0.0.5"
        xff_derived_ip = "10.0.0.5"  # what real_ip_from_xff(nginx_xff) resolves to
        token = "genuine-token-for-frontend-sa-2"

        for _ in range(GlobalRateLimitMiddleware.READ_LIMIT):
            general_rate_limiter.check_with_info(
                f"global:ip:{xff_derived_ip}:read",
                GlobalRateLimitMiddleware.READ_LIMIT,
                GlobalRateLimitMiddleware.WINDOW,
            )

        with patch.object(settings, "frontend_proxy_sa", self.FRONTEND_SA), \
                patch.object(settings, "backend_audience", self.BACKEND_AUDIENCE), \
                self._patch_verify(token, self.FRONTEND_SA):
            resp = client.get(
                "/api/stories",
                headers={
                    "X-Forwarded-For": nginx_xff,
                    "X-Frontend-Identity": token,
                    "X-Client-IP": client_ip,
                },
            )
        assert resp.status_code != 429

    def test_missing_identity_keys_the_bucket_by_xff_not_x_client_ip(self, client):
        """No X-Frontend-Identity at all (direct/CI traffic shape):
        exhausting the X-Client-IP-named bucket must have no effect -- the
        real request should still succeed, because without identity the
        header is never consulted."""
        from app.main import GlobalRateLimitMiddleware

        spoofed_client_ip = "9.9.9.9"
        xff = "1.1.1.1, 5.5.5.5, 2.2.2.2"
        xff_derived_ip = "5.5.5.5"

        for _ in range(GlobalRateLimitMiddleware.READ_LIMIT):
            general_rate_limiter.check_with_info(
                f"global:ip:{spoofed_client_ip}:read",
                GlobalRateLimitMiddleware.READ_LIMIT,
                GlobalRateLimitMiddleware.WINDOW,
            )

        with patch.object(settings, "frontend_proxy_sa", self.FRONTEND_SA), \
                patch.object(settings, "backend_audience", self.BACKEND_AUDIENCE):
            resp = client.get(
                "/api/stories",
                headers={
                    "X-Forwarded-For": xff,
                    "X-Client-IP": spoofed_client_ip,
                },
            )
        assert resp.status_code != 429

        # And exhausting the ACTUAL xff-derived bucket does 429 it.
        for _ in range(GlobalRateLimitMiddleware.READ_LIMIT):
            general_rate_limiter.check_with_info(
                f"global:ip:{xff_derived_ip}:read",
                GlobalRateLimitMiddleware.READ_LIMIT,
                GlobalRateLimitMiddleware.WINDOW,
            )
        with patch.object(settings, "frontend_proxy_sa", self.FRONTEND_SA), \
                patch.object(settings, "backend_audience", self.BACKEND_AUDIENCE):
            resp = client.get(
                "/api/stories",
                headers={
                    "X-Forwarded-For": xff,
                    "X-Client-IP": spoofed_client_ip,
                },
            )
        assert resp.status_code == 429

    def test_forged_x_frontend_identity_on_a_direct_call_is_rejected(self, client):
        """End-to-end version of the core #3740 follow-up fix: a raw
        request straight to backend (no real proxy involved) that sets
        X-Frontend-Identity itself, claiming the frontend SA's email in a
        JWT-shaped but unsigned token, must NOT get its X-Client-IP
        trusted -- real HTTP path, no mock standing in for
        verify_oauth2_token's rejection (nothing in this test patches it
        to succeed, so the REAL function runs against a token it did not
        itself mint; it must reject it on its own)."""
        from app.main import GlobalRateLimitMiddleware
        import base64
        import json

        xff_derived_ip = "5.5.5.5"
        header_b64 = base64.urlsafe_b64encode(b'{"alg":"RS256"}').rstrip(b"=").decode()
        claims = {"email": self.FRONTEND_SA, "email_verified": True, "aud": self.BACKEND_AUDIENCE}
        payload_b64 = base64.urlsafe_b64encode(json.dumps(claims).encode()).rstrip(b"=").decode()
        forged_token = f"{header_b64}.{payload_b64}.not-a-real-signature"

        for _ in range(GlobalRateLimitMiddleware.READ_LIMIT):
            general_rate_limiter.check_with_info(
                f"global:ip:{xff_derived_ip}:read",
                GlobalRateLimitMiddleware.READ_LIMIT,
                GlobalRateLimitMiddleware.WINDOW,
            )

        with patch.object(settings, "frontend_proxy_sa", self.FRONTEND_SA), \
                patch.object(settings, "backend_audience", self.BACKEND_AUDIENCE):
            resp = client.get(
                "/api/stories",
                headers={
                    "X-Forwarded-For": "1.1.1.1, 5.5.5.5, 2.2.2.2",
                    "X-Frontend-Identity": forged_token,
                    "X-Client-IP": "9.9.9.9",  # attacker's own forged IP
                },
            )
        # Rejected by the real (unmocked) verify_oauth2_token -> falls back
        # to the XFF rule -> hits the bucket we already exhausted above.
        assert resp.status_code == 429


class TestRealClientIpXFF:
    """#2470 HIGH-1a: real client IP must come from the GCP-appended second-from-right
    X-Forwarded-For entry, never the client-controlled leftmost one — else an attacker
    rotates a fake leftmost IP to bypass per-IP rate limits."""

    def test_takes_second_from_right(self):
        from app.auth.rate_limiter import real_ip_from_xff
        # GCP appends [real-client, load-balancer]; client prepended a spoof
        assert real_ip_from_xff("1.1.1.1, 5.5.5.5, 9.9.9.9") == "5.5.5.5"

    def test_rotating_leftmost_does_not_change_result(self):
        from app.auth.rate_limiter import real_ip_from_xff
        a = real_ip_from_xff("11.11.11.11, 5.5.5.5, 9.9.9.9")
        b = real_ip_from_xff("22.22.22.22, 5.5.5.5, 9.9.9.9")
        assert a == b == "5.5.5.5"  # bypass attempt (rotate spoof) has no effect

    def test_no_spoof_prefix(self):
        from app.auth.rate_limiter import real_ip_from_xff
        # No client-supplied prefix: GCP set [real-client, lb]
        assert real_ip_from_xff("5.5.5.5, 9.9.9.9") == "5.5.5.5"

    def test_empty_falls_back_to_peer(self):
        from app.auth.rate_limiter import real_ip_from_xff
        assert real_ip_from_xff("", "10.0.0.1") == "10.0.0.1"
        assert real_ip_from_xff("") == "unknown"


# ===========================================================================
# #3740 — real client IP behind the same-origin proxy, without letting an
# attacker forge X-Client-IP on a direct call (backend stays reachable both
# ways: via the frontend's proxy AND directly, e.g. CI/health-checks).
# ===========================================================================


class TestTrustedProxyClientIp:
    """trusted_proxy_client_ip must only trust X-Client-IP when THIS
    backend has itself cryptographically verified X-Frontend-Identity as a
    genuine, unexpired, correctly-audienced Google ID token for the
    configured frontend service account -- never on the header's mere
    presence, and never on an unverified JWT payload alone.

    #3740 follow-up (security review): the original version of this class
    tested a design that decoded X-Serverless-Authorization's JWT payload
    WITHOUT verifying its signature, reasoning Cloud Run's own platform
    had already done so. That's only true while this backend requires
    Cloud Run invoker auth; while it still allows unauthenticated access
    (true today), nothing stops a caller from setting that header directly
    with a forged, unsigned payload. These tests now mock
    google.oauth2.id_token.verify_oauth2_token (the same function
    app/services/sso_login_service.py already uses for real end-user
    Google Sign-In) to simulate what REAL verification would do: only a
    token present in a test's `valid` map is treated as genuinely
    Google-signed, and only when called with the audience that token was
    actually minted for -- anything else raises ValueError, exactly like
    the real function does for a bad signature, expired token, or
    audience mismatch.
    """

    FRONTEND_SA = "frontend-sa@lingoleap-dev.iam.gserviceaccount.com"
    OTHER_SA = "someone-else-sa@lingoleap-dev.iam.gserviceaccount.com"
    BACKEND_AUDIENCE = "https://lingoleap-backend-958347263320.asia-east1.run.app"
    OTHER_AUDIENCE = "https://some-other-service-958347263320.asia-east1.run.app"

    @pytest.fixture(autouse=True)
    def _clear_verified_identity_cache(self):
        """The positive-verification cache is module-level and keyed by raw
        token string -- without clearing it, an earlier test's genuinely
        cached (token -> email) entry would silently make a later test
        that reuses the same token string skip verification entirely,
        hiding exactly the bugs these tests exist to catch."""
        from app.auth.rate_limiter import _verified_identity_cache
        _verified_identity_cache.clear()
        yield
        _verified_identity_cache.clear()

    @staticmethod
    def _far_future_exp() -> int:
        return int(time.time()) + 3600

    @staticmethod
    def _mock_verify(valid: dict) -> object:
        """Build a side_effect for google.oauth2.id_token.verify_oauth2_token.

        `valid` maps token string -> (audience_it_was_minted_for, claims
        dict to return). A token not in `valid` raises ValueError (as real
        verification would for anything not actually signed by Google); a
        token that IS in `valid` but called with a different audience than
        it was minted for ALSO raises (as real verification would for a
        genuine token being replayed against the wrong service).
        """
        def _verify(token, request, audience):
            entry = valid.get(token)
            if entry is None:
                raise ValueError("Could not verify token signature.")
            minted_audience, claims = entry
            if audience != minted_audience:
                raise ValueError(
                    f"Token has audience {minted_audience!r}, expected {audience!r}."
                )
            return dict(claims)
        return _verify

    def _patch_verify(self, valid: dict):
        return patch(
            "google.oauth2.id_token.verify_oauth2_token",
            side_effect=self._mock_verify(valid),
        )

    def test_direct_request_no_identity_header_uses_xff_rule(self):
        # The "direct request" case: no X-Frontend-Identity at all (e.g.
        # CI or a health check hitting backend's public URL directly).
        from app.auth.rate_limiter import trusted_proxy_client_ip
        with self._patch_verify({}) as mock_verify:
            ip = trusted_proxy_client_ip(
                xff="1.1.1.1, 5.5.5.5, 9.9.9.9",
                peer=None,
                x_frontend_identity="",
                x_client_ip="",
                frontend_proxy_sa=self.FRONTEND_SA,
                backend_audience=self.BACKEND_AUDIENCE,
            )
        assert ip == "5.5.5.5"  # same as real_ip_from_xff's second-from-right
        mock_verify.assert_not_called()  # nothing to verify -- no network/CPU wasted

    def test_proxied_request_with_valid_frontend_identity_uses_x_client_ip(self):
        from app.auth.rate_limiter import trusted_proxy_client_ip
        token = "genuinely-google-signed-token-for-frontend-sa"
        with self._patch_verify({
            token: (self.BACKEND_AUDIENCE, {
                "email": self.FRONTEND_SA,
                "email_verified": True,
                "exp": self._far_future_exp(),
            }),
        }):
            ip = trusted_proxy_client_ip(
                xff="203.0.113.9, 10.0.0.1",  # nginx's own hop -- NOT the real user
                peer=None,
                x_frontend_identity=token,
                x_client_ip="198.51.100.42",  # the real end-user IP nginx derived
                frontend_proxy_sa=self.FRONTEND_SA,
                backend_audience=self.BACKEND_AUDIENCE,
            )
        assert ip == "198.51.100.42"

    def test_spoofed_x_client_ip_without_identity_is_ignored(self):
        # No X-Frontend-Identity at all, but X-Client-IP IS present (an
        # attacker hitting backend directly and just setting the header
        # themselves, hoping it's trusted outright).
        from app.auth.rate_limiter import trusted_proxy_client_ip
        with self._patch_verify({}):
            ip = trusted_proxy_client_ip(
                xff="1.1.1.1, 5.5.5.5, 9.9.9.9",
                peer=None,
                x_frontend_identity="",
                x_client_ip="9.9.9.9",  # attacker-forged, must be ignored
                frontend_proxy_sa=self.FRONTEND_SA,
                backend_audience=self.BACKEND_AUDIENCE,
            )
        assert ip == "5.5.5.5"  # XFF rule, X-Client-IP never consulted

    def test_forged_unsigned_token_with_the_right_email_is_rejected(self):
        """The #3740 follow-up's whole reason for existing: a JWT-SHAPED
        string whose payload claims email=FRONTEND_SA, but that was never
        actually signed by Google, must be rejected -- not trusted just
        because its payload happens to say the right thing. This is the
        exact attack the old X-Serverless-Authorization-payload-decode
        design was vulnerable to while the backend allows unauthenticated
        access. Mutation-check target: skipping the verify_oauth2_token
        call entirely (trusting the payload outright) makes this test go
        green for the wrong reason -- i.e. red without the real call."""
        from app.auth.rate_limiter import trusted_proxy_client_ip
        import base64
        import json

        header = base64.urlsafe_b64encode(b'{"alg":"RS256"}').rstrip(b"=").decode()
        claims = {"email": self.FRONTEND_SA, "email_verified": True, "aud": self.BACKEND_AUDIENCE}
        payload = base64.urlsafe_b64encode(json.dumps(claims).encode()).rstrip(b"=").decode()
        forged_token = f"{header}.{payload}.not-a-real-google-signature"

        # Nothing in `valid` -- simulates real verification rejecting a
        # token that isn't actually Google-signed, no matter what its
        # (attacker-controlled, unverified) payload claims.
        with self._patch_verify({}):
            ip = trusted_proxy_client_ip(
                xff="1.1.1.1, 5.5.5.5, 9.9.9.9",
                peer=None,
                x_frontend_identity=forged_token,
                x_client_ip="198.51.100.42",
                frontend_proxy_sa=self.FRONTEND_SA,
                backend_audience=self.BACKEND_AUDIENCE,
            )
        assert ip == "5.5.5.5"  # rejected -- falls back to the XFF rule

    def test_valid_token_wrong_audience_is_rejected(self):
        """A genuinely Google-signed token for the frontend SA -- but
        minted for a DIFFERENT Cloud Run service -- must not be trusted
        here. Simulates either a replay attack (a token captured
        elsewhere) or a misconfiguration (BACKEND_AUDIENCE not matching
        what the sidecar actually requests)."""
        from app.auth.rate_limiter import trusted_proxy_client_ip
        token = "genuine-token-minted-for-a-different-service"
        with self._patch_verify({
            token: (self.OTHER_AUDIENCE, {
                "email": self.FRONTEND_SA,
                "email_verified": True,
                "exp": self._far_future_exp(),
            }),
        }):
            ip = trusted_proxy_client_ip(
                xff="1.1.1.1, 5.5.5.5, 9.9.9.9",
                peer=None,
                x_frontend_identity=token,
                x_client_ip="198.51.100.42",
                frontend_proxy_sa=self.FRONTEND_SA,
                backend_audience=self.BACKEND_AUDIENCE,  # NOT self.OTHER_AUDIENCE
            )
        assert ip == "5.5.5.5"  # wrong audience -- falls back to the XFF rule

    def test_verify_oauth2_token_is_actually_called_with_the_configured_audience(self):
        """Wiring-level assertion, independent of the mock's own pass/fail
        behavior: _verify_frontend_identity must pass backend_audience
        through to verify_oauth2_token's `audience` argument, not drop it
        or pass None. Mutation-caught: dropping the audience argument
        entirely makes verify_oauth2_token (real signature: token, request,
        audience=None) silently skip its own audience check -- and because
        the resulting TypeError from this test's mock (which requires 3
        args) gets swallowed by the broad `except Exception`, the ABOVE
        test (test_valid_token_wrong_audience_is_rejected) still passes
        for the wrong reason (a crash that happens to also look like
        rejection). This test closes that gap by asserting the actual
        call arguments directly, regardless of whether verification
        happens to succeed or fail.
        """
        from app.auth.rate_limiter import trusted_proxy_client_ip
        token = "genuine-token-for-frontend-sa"
        with self._patch_verify({
            token: (self.BACKEND_AUDIENCE, {
                "email": self.FRONTEND_SA,
                "email_verified": True,
                "exp": self._far_future_exp(),
            }),
        }) as mock_verify:
            trusted_proxy_client_ip(
                xff="1.1.1.1, 5.5.5.5, 9.9.9.9",
                peer=None,
                x_frontend_identity=token,
                x_client_ip="198.51.100.42",
                frontend_proxy_sa=self.FRONTEND_SA,
                backend_audience=self.BACKEND_AUDIENCE,
            )
        mock_verify.assert_called_once_with(token, ANY, self.BACKEND_AUDIENCE)

    def test_identity_of_a_different_service_account_is_ignored(self):
        # A real, genuinely-verified identity -- just not the configured
        # frontend one. Must NOT be trusted for X-Client-IP.
        from app.auth.rate_limiter import trusted_proxy_client_ip
        token = "genuine-token-for-some-other-service-account"
        with self._patch_verify({
            token: (self.BACKEND_AUDIENCE, {
                "email": self.OTHER_SA,
                "email_verified": True,
                "exp": self._far_future_exp(),
            }),
        }):
            ip = trusted_proxy_client_ip(
                xff="1.1.1.1, 5.5.5.5, 9.9.9.9",
                peer=None,
                x_frontend_identity=token,
                x_client_ip="198.51.100.42",
                frontend_proxy_sa=self.FRONTEND_SA,
                backend_audience=self.BACKEND_AUDIENCE,
            )
        assert ip == "5.5.5.5"  # falls back to XFF rule, not the other SA's claim

    def test_email_not_verified_is_ignored(self):
        # A genuinely Google-signed token for the right SA, but Google
        # itself marks the email as unverified -- treat the same as no
        # email at all (mirrors sso_login_service.py's own standard for
        # real end-user Google Sign-In tokens).
        from app.auth.rate_limiter import trusted_proxy_client_ip
        token = "genuine-token-email-not-verified"
        with self._patch_verify({
            token: (self.BACKEND_AUDIENCE, {
                "email": self.FRONTEND_SA,
                "email_verified": False,
                "exp": self._far_future_exp(),
            }),
        }):
            ip = trusted_proxy_client_ip(
                xff="1.1.1.1, 5.5.5.5, 9.9.9.9",
                peer=None,
                x_frontend_identity=token,
                x_client_ip="198.51.100.42",
                frontend_proxy_sa=self.FRONTEND_SA,
                backend_audience=self.BACKEND_AUDIENCE,
            )
        assert ip == "5.5.5.5"

    def test_missing_email_claim_is_ignored(self):
        from app.auth.rate_limiter import trusted_proxy_client_ip
        token = "genuine-token-no-email-claim"
        with self._patch_verify({
            token: (self.BACKEND_AUDIENCE, {
                "email_verified": True,
                "exp": self._far_future_exp(),
                # no "email" key at all
            }),
        }):
            ip = trusted_proxy_client_ip(
                xff="1.1.1.1, 5.5.5.5, 9.9.9.9",
                peer=None,
                x_frontend_identity=token,
                x_client_ip="198.51.100.42",
                frontend_proxy_sa=self.FRONTEND_SA,
                backend_audience=self.BACKEND_AUDIENCE,
            )
        assert ip == "5.5.5.5"

    def test_empty_frontend_proxy_sa_config_never_trusts_anything(self):
        # Zero-behavior-change invariant: until FRONTEND_PROXY_SA is
        # actually configured, X-Client-IP must never be trusted even if
        # everything else lines up perfectly. Short-circuits before ever
        # calling verify_oauth2_token.
        from app.auth.rate_limiter import trusted_proxy_client_ip
        token = "genuine-token-for-frontend-sa"
        with self._patch_verify({
            token: (self.BACKEND_AUDIENCE, {
                "email": self.FRONTEND_SA,
                "email_verified": True,
                "exp": self._far_future_exp(),
            }),
        }) as mock_verify:
            ip = trusted_proxy_client_ip(
                xff="1.1.1.1, 5.5.5.5, 9.9.9.9",
                peer=None,
                x_frontend_identity=token,
                x_client_ip="198.51.100.42",
                frontend_proxy_sa="",  # not configured
                backend_audience=self.BACKEND_AUDIENCE,
            )
        assert ip == "5.5.5.5"
        mock_verify.assert_not_called()

    def test_empty_backend_audience_config_never_trusts_anything(self):
        # Same zero-behavior-change invariant for the other half of the
        # config: BACKEND_AUDIENCE must also be set, or nothing is ever
        # verified. Catches accidentally gating on only one of the two
        # settings.
        from app.auth.rate_limiter import trusted_proxy_client_ip
        token = "genuine-token-for-frontend-sa"
        with self._patch_verify({
            token: (self.BACKEND_AUDIENCE, {
                "email": self.FRONTEND_SA,
                "email_verified": True,
                "exp": self._far_future_exp(),
            }),
        }) as mock_verify:
            ip = trusted_proxy_client_ip(
                xff="1.1.1.1, 5.5.5.5, 9.9.9.9",
                peer=None,
                x_frontend_identity=token,
                x_client_ip="198.51.100.42",
                frontend_proxy_sa=self.FRONTEND_SA,
                backend_audience="",  # not configured
            )
        assert ip == "5.5.5.5"
        mock_verify.assert_not_called()

    def test_malformed_token_does_not_crash_and_falls_back_to_xff(self):
        from app.auth.rate_limiter import trusted_proxy_client_ip
        with self._patch_verify({}):
            ip = trusted_proxy_client_ip(
                xff="1.1.1.1, 5.5.5.5, 9.9.9.9",
                peer=None,
                x_frontend_identity="not-a-real-jwt-at-all",
                x_client_ip="198.51.100.42",
                frontend_proxy_sa=self.FRONTEND_SA,
                backend_audience=self.BACKEND_AUDIENCE,
            )
        assert ip == "5.5.5.5"

    def test_missing_x_client_ip_header_falls_back_even_with_valid_identity(self):
        # Valid frontend identity but no X-Client-IP in the request at
        # all (e.g. an older frontend build before this was wired up) --
        # must not crash, must fall back cleanly.
        from app.auth.rate_limiter import trusted_proxy_client_ip
        token = "genuine-token-for-frontend-sa"
        with self._patch_verify({
            token: (self.BACKEND_AUDIENCE, {
                "email": self.FRONTEND_SA,
                "email_verified": True,
                "exp": self._far_future_exp(),
            }),
        }):
            ip = trusted_proxy_client_ip(
                xff="1.1.1.1, 5.5.5.5, 9.9.9.9",
                peer=None,
                x_frontend_identity=token,
                x_client_ip="",
                frontend_proxy_sa=self.FRONTEND_SA,
                backend_audience=self.BACKEND_AUDIENCE,
            )
        assert ip == "5.5.5.5"

    def test_email_containing_the_frontend_sa_as_a_substring_is_not_enough(self):
        # The comparison must be EXACT equality, not "contains" -- an
        # attacker who can get Google to issue them a token for a service
        # account whose email happens to contain the configured frontend
        # SA as a substring (e.g. a lookalike project, or the frontend SA
        # name embedded in a longer attacker-controlled string) must not
        # be trusted.
        from app.auth.rate_limiter import trusted_proxy_client_ip
        lookalike_email = self.FRONTEND_SA + ".evil-attacker.example.com"
        token = "genuine-token-for-lookalike-email"
        with self._patch_verify({
            token: (self.BACKEND_AUDIENCE, {
                "email": lookalike_email,
                "email_verified": True,
                "exp": self._far_future_exp(),
            }),
        }):
            ip = trusted_proxy_client_ip(
                xff="1.1.1.1, 5.5.5.5, 9.9.9.9",
                peer=None,
                x_frontend_identity=token,
                x_client_ip="198.51.100.42",
                frontend_proxy_sa=self.FRONTEND_SA,
                backend_audience=self.BACKEND_AUDIENCE,
            )
        assert ip == "5.5.5.5"

    def test_second_call_with_the_same_token_is_served_from_cache(self):
        """#3740 follow-up: the sidecar reuses the same token across many
        requests within its TTL, so verify_oauth2_token should only run
        ONCE per distinct (still-valid) token, not once per request --
        otherwise every proxied request pays a real cryptographic
        verification (and, on a cold cert cache, a network round trip)."""
        from app.auth.rate_limiter import trusted_proxy_client_ip
        token = "genuine-token-reused-across-requests"
        with self._patch_verify({
            token: (self.BACKEND_AUDIENCE, {
                "email": self.FRONTEND_SA,
                "email_verified": True,
                "exp": self._far_future_exp(),
            }),
        }) as mock_verify:
            for _ in range(5):
                ip = trusted_proxy_client_ip(
                    xff="1.1.1.1, 5.5.5.5, 9.9.9.9",
                    peer=None,
                    x_frontend_identity=token,
                    x_client_ip="198.51.100.42",
                    frontend_proxy_sa=self.FRONTEND_SA,
                    backend_audience=self.BACKEND_AUDIENCE,
                )
                assert ip == "198.51.100.42"
        mock_verify.assert_called_once()

    def test_cache_entry_past_its_own_exp_is_re_verified(self):
        """The cache must respect the token's OWN exp, not cache forever --
        a cached entry whose exp has already passed must trigger a fresh
        verify_oauth2_token call (which, for a token that's genuinely
        expired by then, the real function would reject on its own)."""
        from app.auth.rate_limiter import trusted_proxy_client_ip, _verified_identity_cache
        token = "genuine-token-about-to-expire"
        # already past exp
        _verified_identity_cache[token] = (self.FRONTEND_SA, self.BACKEND_AUDIENCE, time.time() - 1)

        with self._patch_verify({
            token: (self.BACKEND_AUDIENCE, {
                "email": self.FRONTEND_SA,
                "email_verified": True,
                "exp": self._far_future_exp(),
            }),
        }) as mock_verify:
            ip = trusted_proxy_client_ip(
                xff="1.1.1.1, 5.5.5.5, 9.9.9.9",
                peer=None,
                x_frontend_identity=token,
                x_client_ip="198.51.100.42",
                frontend_proxy_sa=self.FRONTEND_SA,
                backend_audience=self.BACKEND_AUDIENCE,
            )
        assert ip == "198.51.100.42"
        mock_verify.assert_called_once()  # re-verified, not served from the stale entry

    def test_cache_entry_for_a_different_audience_is_not_reused(self):
        """Independent-review follow-up: a cache hit must re-check the
        audience it was originally verified against, not just the email +
        exp. Without this, reconfiguring BACKEND_AUDIENCE mid-token-
        lifetime could keep trusting a still-unexpired entry that was only
        ever verified against the OLD audience -- this token's signature
        was never checked against the new one."""
        from app.auth.rate_limiter import trusted_proxy_client_ip, _verified_identity_cache
        token = "genuine-token-verified-for-a-different-audience"
        # Manually seed a still-valid-looking cache entry for the SAME
        # token but a DIFFERENT audience than the one this call will use.
        _verified_identity_cache[token] = (self.FRONTEND_SA, self.OTHER_AUDIENCE, self._far_future_exp())

        # Nothing in `valid` for self.BACKEND_AUDIENCE -- if the cache hit
        # were (wrongly) accepted without re-checking audience, this test
        # would never even reach verify_oauth2_token and would pass for
        # the wrong reason; asserting it WAS called proves the cache miss
        # happened and real (here: failing) verification ran instead.
        with self._patch_verify({}) as mock_verify:
            ip = trusted_proxy_client_ip(
                xff="1.1.1.1, 5.5.5.5, 9.9.9.9",
                peer=None,
                x_frontend_identity=token,
                x_client_ip="198.51.100.42",
                frontend_proxy_sa=self.FRONTEND_SA,
                backend_audience=self.BACKEND_AUDIENCE,
            )
        assert ip == "5.5.5.5"  # not trusted -- stale cross-audience cache entry ignored
        mock_verify.assert_called_once_with(token, ANY, self.BACKEND_AUDIENCE)

    def test_non_string_email_claim_is_ignored(self):
        """Defensive type-check: a verified token whose `email` claim is
        present but not a string (malformed/unexpected claims shape) must
        not crash and must not be trusted -- `isinstance(email, str)`
        already guards this in the implementation; this test locks that
        behavior rather than leaving it unverified."""
        from app.auth.rate_limiter import trusted_proxy_client_ip
        token = "genuine-token-non-string-email"
        with self._patch_verify({
            token: (self.BACKEND_AUDIENCE, {
                "email": 12345,  # not a string
                "email_verified": True,
                "exp": self._far_future_exp(),
            }),
        }):
            ip = trusted_proxy_client_ip(
                xff="1.1.1.1, 5.5.5.5, 9.9.9.9",
                peer=None,
                x_frontend_identity=token,
                x_client_ip="198.51.100.42",
                frontend_proxy_sa=self.FRONTEND_SA,
                backend_audience=self.BACKEND_AUDIENCE,
            )
        assert ip == "5.5.5.5"


# ===========================================================================
# #3227 — CORS preflight must not consume the rate-limit budget
# ===========================================================================


class TestPreflightExemptFromRateLimit:
    """OPTIONS preflight 不可以吃 read 額度。

    前後端在每個環境都是**不同 origin**（frontend Cloud Run ↔ backend Cloud Run），
    所以瀏覽器對每一個帶 Authorization 的請求都會先發一次 CORS preflight。
    preflight 也算進 read 額度的話：

      ① 每個真實使用者的有效額度直接砍半（300 變成 150 次真請求）
      ② preflight 自己被 429 時，那個回應**沒有 CORS 標頭** → 瀏覽器直接把真請求
         擋掉，並報成「blocked by CORS policy」、status 撈不到（-1 / ERR_FAILED）
         → 前端根本看不出自己被限流了，只看到一個網路層失敗

    而限流 preflight 擋不到任何攻擊者 —— preflight 是瀏覽器發的，
    腳本攻擊直接送真請求、不會有 preflight。所以把它算進去是純粹的副作用：
    只懲罰真的用瀏覽器的人。真請求仍然計數，防護沒有變弱。

    2026-09-16 實測（staging，E2E 跑的那 12 分鐘）：
        read 額度尖峰 310 > 300 → 觸發限流
        其中 OPTIONS 貢獻 57 次；4 個 429 直接落在 preflight 上
        只數 GET/HEAD 是 253，**低於額度** —— 所以少了 OPTIONS 這一項就解釋不通
    """

    def test_preflight_passes_through_when_read_budget_is_exhausted(self, client):
        """⭐ 額度用光時，OPTIONS preflight 仍然要過（這條在修掉之前是紅的）。"""
        from app.main import GlobalRateLimitMiddleware
        general_rate_limiter.reset()

        ip = "testclient"
        for _ in range(GlobalRateLimitMiddleware.READ_LIMIT):
            general_rate_limiter.check_with_info(
                f"global:ip:{ip}:read",
                GlobalRateLimitMiddleware.READ_LIMIT,
                GlobalRateLimitMiddleware.WINDOW,
            )

        resp = client.options(
            "/api/stories",
            headers={
                "Origin": "https://lingoleap-frontend-staging-958347263320.asia-east1.run.app",
                "Access-Control-Request-Method": "GET",
                "Access-Control-Request-Headers": "authorization",
            },
        )
        assert resp.status_code != 429, (
            "preflight 被限流了 → 瀏覽器會把真請求擋掉並報成 CORS error，"
            "前端看不到 429、也無法重試"
        )

    def test_preflight_does_not_consume_budget(self, client):
        """發一堆 preflight 不可以把後面的真 GET 擠掉。"""
        from app.main import GlobalRateLimitMiddleware
        general_rate_limiter.reset()

        headers = {
            "Origin": "https://lingoleap-frontend-staging-958347263320.asia-east1.run.app",
            "Access-Control-Request-Method": "GET",
            "Access-Control-Request-Headers": "authorization",
        }
        # 打滿一整個額度的 preflight
        for _ in range(GlobalRateLimitMiddleware.READ_LIMIT + 5):
            client.options("/api/stories", headers=headers)

        # 真請求還要能過
        resp = client.get("/api/stories")
        assert resp.status_code != 429, "preflight 吃掉了真請求的額度"

    def test_real_get_still_counted(self, client):
        """⛔ 正向對照：真的 GET 仍然要被計數，防護沒有被這次改動關掉。"""
        from app.main import GlobalRateLimitMiddleware
        general_rate_limiter.reset()

        ip = "testclient"
        for _ in range(GlobalRateLimitMiddleware.READ_LIMIT):
            general_rate_limiter.check_with_info(
                f"global:ip:{ip}:read",
                GlobalRateLimitMiddleware.READ_LIMIT,
                GlobalRateLimitMiddleware.WINDOW,
            )
        assert client.get("/api/stories").status_code == 429

    def test_write_still_counted(self, client):
        """⛔ 正向對照：寫入額度也沒被放掉。"""
        from app.main import GlobalRateLimitMiddleware
        general_rate_limiter.reset()

        ip = "testclient"
        for _ in range(GlobalRateLimitMiddleware.WRITE_LIMIT):
            general_rate_limiter.check_with_info(
                f"global:ip:{ip}:write",
                GlobalRateLimitMiddleware.WRITE_LIMIT,
                GlobalRateLimitMiddleware.WINDOW,
            )
        resp = client.post("/api/auth/login", json={"email": "x@example.com", "password": "demo1234"})
        assert resp.status_code == 429

    def test_options_not_in_read_methods(self):
        """OPTIONS 不該再出現在「被計數的 read method」那一行（防止有人加回去）。

        ⚠️ 這條的第一版是空轉的：我寫 `src.split("is_read")[-1]`，而 `is_read`
        在 __call__ 裡出現兩次（賦值 + 後面組 key 用），`[-1]` 拿到的是 key 那一行，
        本來就不含 OPTIONS → 不管程式怎麼寫都會綠。改成掃「賦值那一行」本身。
        """
        import inspect
        from app.main import GlobalRateLimitMiddleware
        src = inspect.getsource(GlobalRateLimitMiddleware.__call__)
        assign_lines = [ln for ln in src.splitlines() if "is_read" in ln and "=" in ln.split("is_read")[1][:3]]
        assert assign_lines, "找不到 is_read 的賦值行 —— 這條測試已經量不到東西了，要修測試"
        for ln in assign_lines:
            assert "OPTIONS" not in ln, (
                f"OPTIONS 又被算進 read 額度了：{ln.strip()} —— 見本類 docstring"
            )


class TestGzipIsOn:
    """#3234：回應要壓縮。

    ⛔ 上線前一個端點都沒壓：課文 23 KB、注音表 39 KB（最大那課 109 KB）全部
    原封不動送出去，而學生多半在手機的行動網路上。#3230 把注音表放大 4 倍
    之後這件事才浮上來（E2E 的 `waitForLoadState` 開始吃緊）。
    """

    def test_大回應在_client_要求時會壓縮(self, client):
        general_rate_limiter.reset()
        r = client.get("/api/stories", headers={"Accept-Encoding": "gzip"})
        assert r.status_code == 200
        assert len(r.content) > 1000, "這個回應太小，量不到壓縮 —— 換一個端點"
        assert r.headers.get("content-encoding") == "gzip", (
            "大回應沒有被壓縮 —— GZipMiddleware 沒裝或順序不對"
        )

    def test_client_沒要求就不壓(self, client):
        """⛔ 負向對照：不是不管三七二十一都壓（否則上面那條證明不了 middleware 有在判斷）。"""
        general_rate_limiter.reset()
        r = client.get("/api/stories", headers={"Accept-Encoding": "identity"})
        assert r.status_code == 200
        assert "gzip" not in (r.headers.get("content-encoding") or "")
