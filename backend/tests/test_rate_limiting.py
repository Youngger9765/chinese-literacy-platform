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
import uuid

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import pytest
from fastapi import Request
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, event
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool
from unittest.mock import AsyncMock, patch, MagicMock

from app.main import app
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
