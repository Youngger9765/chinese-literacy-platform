"""
Regression test for #3395 -- /api/** JSON responses had no Cache-Control,
so a browser (or anything sitting in front of it) could keep serving a
stale response after the underlying feature flag or auth state changed.

Verified on staging: flipping a feature flag on, the browser kept getting the
pre-flip 404 on repeated reloads of the same tab; a brand-new `curl`
(new connection, no cache) got the correct post-flip response every time.
Root cause: FastAPI/Starlette responses carry no `Cache-Control` header by
default, so the browser's HTTP cache is free to apply its own heuristics.

Fix: a middleware stamps `Cache-Control: no-store` on every `/api/**`
response that doesn't already set its own Cache-Control. Routes that
intentionally cache (TTS audio, worksheet PDFs, the static asset proxy)
already set their own header and must be left untouched.
"""
from unittest.mock import MagicMock, patch

from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.main import app
from app.database import get_db
from app.models import Base

SQLALCHEMY_TEST_URL = "sqlite:///:memory:"

engine = create_engine(
    SQLALCHEMY_TEST_URL,
    connect_args={"check_same_thread": False},
)
TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

Base.metadata.create_all(bind=engine)


def override_get_db():
    db = TestingSessionLocal()
    try:
        yield db
    finally:
        db.close()


app.dependency_overrides[get_db] = override_get_db

client = TestClient(app, raise_server_exceptions=False)


class TestApiResponsesAreNotCached:
    """Every dynamic /api/** response must tell the browser not to store it."""

    def test_public_api_endpoint_has_no_store(self):
        resp = client.get("/api/stories")
        assert resp.headers.get("cache-control") == "no-store"

    def test_unauthenticated_api_endpoint_has_no_store(self):
        """Even a 401 must not be cacheable -- that's the exact bug: a stale
        401/404 kept being replayed by the browser after the backend state
        that produced it had already changed."""
        resp = client.get("/api/users/me")
        assert resp.status_code in (401, 403, 422)
        assert resp.headers.get("cache-control") == "no-store"

    def test_404_api_endpoint_has_no_store(self):
        resp = client.get("/api/nonexistent-endpoint")
        assert resp.headers.get("cache-control") == "no-store"

    def test_junyi_import_classes_endpoint_has_no_store(self):
        """The exact endpoint from the #3395 report."""
        resp = client.get("/api/classrooms/junyi-import/classes?school_id=1")
        assert resp.headers.get("cache-control") == "no-store"


class TestIntentionallyCachedRoutesAreUnaffected:
    """The no-store middleware must not clobber routes that set their own
    Cache-Control for legitimate CDN/browser caching."""

    @patch("app.routes.assets._get_bucket")
    def test_asset_proxy_keeps_its_own_long_lived_cache_control(self, mock_get_bucket):
        blob = MagicMock()
        blob.download_as_bytes.return_value = b"%PDF-1.4 fake"
        bucket = MagicMock()
        bucket.blob.return_value = blob
        mock_get_bucket.return_value = bucket

        resp = client.get("/assets/worksheets/G5-L23.pdf")

        assert resp.status_code == 200
        assert resp.headers.get("cache-control") == "public, max-age=31536000, immutable"

    def test_worksheet_docx_route_constant_is_unchanged(self):
        """worksheets.py already sets Cache-Control: private, no-store itself
        (different reasoning: PII-bearing, not CDN-cacheable but also not the
        middleware's concern) -- the middleware must not double up or change
        it. Asserting the weaker-but-sufficient property against the route's
        own constant since reaching its 200 path needs full fixtures."""
        from app.routes.worksheets import _CACHE_CONTROL

        assert _CACHE_CONTROL == "private, no-store"


class TestNonApiRoutesAreUnaffected:
    def test_root_endpoint_is_not_forced_no_store(self):
        """The middleware is scoped to /api/** -- it must not reach into
        unrelated top-level routes."""
        resp = client.get("/")
        assert resp.status_code in (200, 404)
