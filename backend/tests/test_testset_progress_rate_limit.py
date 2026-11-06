"""GET /api/testset/progress rate limiting (find_01TL9kSA8F5UJPZqyxSyYd5y).

The endpoint is unauthenticated by design (contributors have no account) and
resolves purely by caller-supplied nickname -- Claude Security finding
find_01TL9kSA8F5UJPZqyxSyYd5y (medium, CWE-639). The full fix (a
per-contributor secret) would contradict the endpoint's own documented
cross-device-resume design (see #3907 for why), so this is a partial,
honest mitigation: a dedicated per-IP rate limit on this specific route,
separate from the shared global /api/* limiter, raising the cost of
nickname-enumeration attacks.
"""
from __future__ import annotations

import sys
import os
from unittest.mock import MagicMock, patch

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.auth.rate_limiter import ai_rate_limiter


@pytest.fixture(autouse=True)
def _reset_rate_limiter():
    ai_rate_limiter.reset()
    yield
    ai_rate_limiter.reset()


@pytest.fixture
def client():
    with TestClient(app) as c:
        yield c


def _empty_bucket():
    """A GCS bucket stub whose list_blobs always returns nothing -- the
    progress lookup itself is not what's under test here, just the gate
    in front of it."""
    bucket = MagicMock()
    bucket.list_blobs.return_value = []
    return bucket


class TestTestsetProgressRateLimit:
    def test_requests_within_the_limit_succeed(self, client):
        with patch("app.routes.testset._get_gcs_bucket", return_value=_empty_bucket()):
            for _ in range(10):
                resp = client.get("/api/testset/progress", params={"name": "小明", "lesson": "1"})
                assert resp.status_code == 200, resp.text

    def test_requests_beyond_the_limit_are_rate_limited(self, client):
        with patch("app.routes.testset._get_gcs_bucket", return_value=_empty_bucket()):
            for _ in range(10):
                resp = client.get("/api/testset/progress", params={"name": "小明", "lesson": "1"})
                assert resp.status_code == 200

            # the 11th request in the same window must be refused -- this is
            # what makes guessing many nicknames in a burst slower than the
            # shared 300/min global limiter alone allowed.
            resp = client.get("/api/testset/progress", params={"name": "小明", "lesson": "1"})
            assert resp.status_code == 429, resp.text

    def test_rate_limit_is_scoped_to_this_route_not_shared_globally(self, client):
        """The dependency used (make_ai_rate_limit_dependency) keys by route
        path -- confirm exhausting /testset/progress's budget does not
        affect a different route using the same dependency factory
        (/testset/batch-eval, unauthenticated here so it 401s first, but
        that 401 proves it was never rate-limited)."""
        with patch("app.routes.testset._get_gcs_bucket", return_value=_empty_bucket()):
            for _ in range(11):
                client.get("/api/testset/progress", params={"name": "小明", "lesson": "1"})

        resp = client.post("/api/testset/batch-eval", json={"lesson_id": "1"})
        assert resp.status_code != 429, (
            "exhausting /testset/progress's budget must not bleed into "
            "/testset/batch-eval's separate budget"
        )
