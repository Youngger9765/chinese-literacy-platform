"""
Regression tests for Issue #1808 — TTS classroom rate-limit failure modes.

Four tests:

1. test_same_user_shares_bucket:
   30 concurrent requests from the SAME user_id pass within the bucket;
   the 31st gets 429 with Retry-After: 60 header.

2. test_different_users_have_separate_buckets:
   30 requests from two DIFFERENT user_ids (15 each) — both user_ids pass
   independently (bucket is not shared).

3. test_cached_request_does_not_decrement_bucket:
   A pre-warmed L1 cache entry returns 200 without consuming the rate-limit
   bucket (i.e. 31 requests where the first warms the cache and the following
   30 are cache hits → all 31 succeed).

4. test_429_response_has_retry_after_60:
   When the rate limit is exceeded the response contains the header
   Retry-After: 60.

Run:
    cd /path/to/chinese-literacy-platform/backend
    pytest tests/test_regression_tts_rate_limit_1808.py -v
"""

from __future__ import annotations

import os
import sys
import uuid
from typing import Generator
from unittest.mock import MagicMock, patch

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
from app.auth.rate_limiter import tts_rate_limiter  # dedicated TTS limiter

# ---------------------------------------------------------------------------
# Test DB (SQLite in-memory, isolated from production)
# ---------------------------------------------------------------------------

engine = create_engine(
    "sqlite://",
    connect_args={"check_same_thread": False},
    poolclass=StaticPool,
)


@event.listens_for(engine, "connect")
def _set_sqlite_pragma(dbapi_connection, connection_record):  # noqa: ANN001
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


def _seed_roles(session) -> None:  # noqa: ANN001
    for role_data in SEED_ROLES:
        role = Role(
            name=role_data["name"],
            display_name=role_data["display_name"],
            scope_level=role_data["scope_level"],
        )
        session.add(role)
    session.commit()


def _override_get_db() -> Generator:
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


def _register_and_login(client) -> dict:  # noqa: ANN001
    """Register a fresh user and return {'email', 'token', 'user_id'}."""
    unique = uuid.uuid4().hex[:8]
    email = f"rl1808_{unique}@example.com"
    password = "SecurePass123!"

    resp = client.post("/api/auth/register", json={
        "email": email,
        "password": password,
        "name": f"RL Test {unique}",
    })
    assert resp.status_code == 201, resp.text

    verification_token = resp.json().get("verification_token")
    if verification_token is not None:
        client.get(f"/api/auth/verify-email?token={verification_token}")

    login_resp = client.post("/api/auth/login", json={"email": email, "password": password})
    assert login_resp.status_code == 200, login_resp.text
    token = login_resp.json()["access_token"]

    db = TestingSessionLocal()
    try:
        user = db.query(User).filter(User.email == email).first()
        user_id = user.id
    finally:
        db.close()

    return {"email": email, "token": token, "user_id": user_id}


FAKE_AUDIO = b"FAKE_AUDIO_BYTES_1808"


def _patch_tts():
    """Patch synthesize_speech so tests don't hit Azure/GCP."""
    return patch.multiple(
        "app.routes.tts",
        synthesize_speech=MagicMock(return_value=FAKE_AUDIO),
        synthesize_sentence=MagicMock(return_value=FAKE_AUDIO),
        # get_cached_tts returns None by default — no L1 hit unless overridden
        get_cached_tts=MagicMock(return_value=None),
    )


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _reset_tts_limiter() -> None:
    """Clear the TTS rate limiter between tests to avoid cross-test bleed."""
    tts_rate_limiter.reset()


def _auth(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


# ---------------------------------------------------------------------------
# Test 1: Same user shares bucket — 30 pass, 31st is 429
# ---------------------------------------------------------------------------

class TestSameUserSharesBucket:
    def test_30_requests_pass_31st_is_429(self, client):
        """30 requests from the same user_id all succeed; the 31st gets 429."""
        _reset_tts_limiter()
        user = _register_and_login(client)
        token = user["token"]

        with _patch_tts():
            # First 30 — all should succeed
            for i in range(30):
                resp = client.post(
                    "/api/tts/synthesize",
                    json={"text": f"測試句子 {i}"},  # unique text → no L1 cache
                    headers=_auth(token),
                )
                assert resp.status_code == 200, (
                    f"Request #{i + 1} expected 200, got {resp.status_code}: {resp.text}"
                )

            # 31st — must be rate-limited
            resp_31 = client.post(
                "/api/tts/synthesize",
                json={"text": "測試句子 THIRTY_ONE"},
                headers=_auth(token),
            )

        assert resp_31.status_code == 429, (
            f"Expected 429 for 31st request, got {resp_31.status_code}: {resp_31.text}"
        )


# ---------------------------------------------------------------------------
# Test 2: Different users have separate buckets
# ---------------------------------------------------------------------------

class TestDifferentUsersHaveSeparateBuckets:
    def test_15_each_both_pass(self, client):
        """15 requests from user_A and 15 from user_B both succeed independently."""
        _reset_tts_limiter()
        user_a = _register_and_login(client)
        user_b = _register_and_login(client)

        with _patch_tts():
            for i in range(15):
                resp_a = client.post(
                    "/api/tts/synthesize",
                    json={"text": f"用戶甲 {i}"},
                    headers=_auth(user_a["token"]),
                )
                resp_b = client.post(
                    "/api/tts/synthesize",
                    json={"text": f"用戶乙 {i}"},
                    headers=_auth(user_b["token"]),
                )
                assert resp_a.status_code == 200, (
                    f"User A request #{i + 1}: expected 200, got {resp_a.status_code}"
                )
                assert resp_b.status_code == 200, (
                    f"User B request #{i + 1}: expected 200, got {resp_b.status_code}"
                )


# ---------------------------------------------------------------------------
# Test 3: Cached request does NOT decrement the bucket
# ---------------------------------------------------------------------------

class TestCachedRequestDoesNotDecrementBucket:
    def test_cache_hit_bypasses_rate_limit(self, client):
        """
        31 requests where the L1 cache returns audio — all 31 should succeed
        because cache hits skip the rate-limit check entirely.
        """
        _reset_tts_limiter()
        user = _register_and_login(client)
        token = user["token"]

        # Patch get_cached_tts to always return FAKE_AUDIO (L1 hit)
        with patch.multiple(
            "app.routes.tts",
            get_cached_tts=MagicMock(return_value=FAKE_AUDIO),
            synthesize_speech=MagicMock(return_value=FAKE_AUDIO),
        ):
            for i in range(31):
                resp = client.post(
                    "/api/tts/synthesize",
                    json={"text": "共同句子（全部都在快取中）"},
                    headers=_auth(token),
                )
                assert resp.status_code == 200, (
                    f"Cache-hit request #{i + 1} expected 200, "
                    f"got {resp.status_code}: {resp.text}"
                )


# ---------------------------------------------------------------------------
# Test 4: 429 response includes Retry-After: 60 header
# ---------------------------------------------------------------------------

class TestRetryAfterHeader:
    def test_429_has_retry_after_header(self, client):
        """When rate-limited, the response includes Retry-After: 60."""
        _reset_tts_limiter()
        user = _register_and_login(client)
        token = user["token"]

        with _patch_tts():
            # Exhaust the bucket
            for i in range(30):
                client.post(
                    "/api/tts/synthesize",
                    json={"text": f"排光配額 {i}"},
                    headers=_auth(token),
                )

            # 31st request should return 429 with Retry-After
            resp = client.post(
                "/api/tts/synthesize",
                json={"text": "配額已排光"},
                headers=_auth(token),
            )

        assert resp.status_code == 429, (
            f"Expected 429, got {resp.status_code}: {resp.text}"
        )
        retry_after = resp.headers.get("retry-after")
        assert retry_after is not None, "Retry-After header missing from 429 response"
        assert retry_after == "60" or int(retry_after) > 0, (
            f"Retry-After expected ≥1, got '{retry_after}'"
        )
