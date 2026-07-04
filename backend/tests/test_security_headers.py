"""
Tests for OWASP security headers added by SecurityHeadersMiddleware.

Verifies that every response (success, error, CORS preflight) carries
the required headers defined in backend/app/main.py.
"""
from unittest.mock import MagicMock, patch

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.main import app
from app.database import get_db
from app.models import Base

# ---------------------------------------------------------------------------
# In-memory SQLite database for tests
# ---------------------------------------------------------------------------
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


# ---------------------------------------------------------------------------
# Helper
# ---------------------------------------------------------------------------

REQUIRED_HEADERS = {
    "x-content-type-options": "nosniff",
    "x-frame-options": "DENY",
    "x-xss-protection": "1; mode=block",
    "referrer-policy": "strict-origin-when-cross-origin",
    "strict-transport-security": "max-age=31536000; includeSubDomains",
}


def assert_security_headers(response):
    """Assert all mandatory security headers are present with correct values."""
    for header, expected_value in REQUIRED_HEADERS.items():
        actual = response.headers.get(header, "")
        assert actual == expected_value, (
            f"Header '{header}': expected '{expected_value}', got '{actual}'"
        )

    # CSP must be present and contain key directives
    csp = response.headers.get("content-security-policy", "")
    assert csp, "Content-Security-Policy header is missing"
    for directive in ("default-src", "script-src", "frame-ancestors"):
        assert directive in csp, f"CSP missing directive: {directive}"


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------

class TestSecurityHeadersOnSuccessResponse:
    def test_root_endpoint_has_security_headers(self):
        response = client.get("/")
        assert_security_headers(response)

    def test_stories_endpoint_has_security_headers(self):
        response = client.get("/api/stories")
        assert_security_headers(response)

    def test_x_content_type_options_is_nosniff(self):
        response = client.get("/")
        assert response.headers.get("x-content-type-options") == "nosniff"

    def test_x_frame_options_is_deny(self):
        response = client.get("/")
        assert response.headers.get("x-frame-options") == "DENY"

    def test_x_xss_protection_is_set(self):
        response = client.get("/")
        assert response.headers.get("x-xss-protection") == "1; mode=block"

    def test_referrer_policy_is_strict(self):
        response = client.get("/")
        assert response.headers.get("referrer-policy") == "strict-origin-when-cross-origin"

    def test_hsts_is_set(self):
        response = client.get("/")
        hsts = response.headers.get("strict-transport-security", "")
        assert "max-age=31536000" in hsts
        assert "includeSubDomains" in hsts

    def test_csp_frame_ancestors_is_none(self):
        """Ensure clickjacking protection via CSP frame-ancestors."""
        response = client.get("/")
        csp = response.headers.get("content-security-policy", "")
        assert "frame-ancestors 'none'" in csp


class TestSecurityHeadersOnErrorResponse:
    def test_404_response_has_security_headers(self):
        response = client.get("/api/nonexistent-endpoint")
        assert_security_headers(response)

    def test_401_response_has_security_headers(self):
        # Endpoint requires auth; should return 401 or 403 with headers present
        response = client.get("/api/users/me")
        assert response.status_code in (401, 403, 422)
        assert_security_headers(response)


class TestCspDirectives:
    def test_csp_allows_google_fonts(self):
        response = client.get("/")
        csp = response.headers.get("content-security-policy", "")
        assert "fonts.googleapis.com" in csp
        assert "fonts.gstatic.com" in csp

    def test_csp_allows_vertex_ai(self):
        response = client.get("/")
        csp = response.headers.get("content-security-policy", "")
        assert "us-central1-aiplatform.googleapis.com" in csp

    def test_csp_allows_firebase(self):
        response = client.get("/")
        csp = response.headers.get("content-security-policy", "")
        assert "firebaseapp.com" in csp

    def test_csp_default_src_is_self(self):
        response = client.get("/")
        csp = response.headers.get("content-security-policy", "")
        assert "default-src 'self'" in csp

    def test_csp_img_src_includes_blob(self):
        """Regression test for #1917 — OMO cropped image previews use blob: URLs.

        Without blob: in img-src, the browser silently blocks the preview image,
        giving no feedback to the teacher uploading the OMO worksheet.
        """
        response = client.get("/")
        csp = response.headers.get("content-security-policy", "")
        # Extract the img-src directive value
        img_src_directive = ""
        for part in csp.split(";"):
            stripped = part.strip()
            if stripped.startswith("img-src"):
                img_src_directive = stripped
                break
        assert img_src_directive, "CSP is missing img-src directive entirely"
        assert "blob:" in img_src_directive, (
            f"CSP img-src must include 'blob:' for OMO cropped image previews (#1917). "
            f"Got: {img_src_directive!r}"
        )

    def test_csp_frame_src_allows_cross_origin_run_app_backend(self):
        """Regression test for #2486 (critic-found regression on the asset-proxy PR).

        The worksheet PDF iframe (Intro.tsx) now points at whatever ASSET_BASE
        resolves to. On the Firebase Hosting build that's a same-origin relative
        "/assets/..." path — 'self' covers it. But on the Cloud-Run-direct
        frontend (staging, prod, PR previews), ASSET_BASE resolves to the
        *backend's own* Cloud Run origin (a different host from the frontend),
        so the iframe src is genuinely cross-origin.

        `frame-src 'self'` blocks that cross-origin iframe outright — confirmed
        via real-browser reproduction on staging: iframe navigation is blocked
        with "Framing '<backend-url>' violates ... frame-src 'self'", and the
        worksheet modal renders permanently blank.

        Fix: extend frame-src with the same `https://*.run.app` wildcard already
        used by connect-src, covering prod/staging/PR-preview backends without
        hardcoding per-environment URLs.
        """
        response = client.get("/")
        csp = response.headers.get("content-security-policy", "")
        frame_src_directive = ""
        for part in csp.split(";"):
            stripped = part.strip()
            if stripped.startswith("frame-src"):
                frame_src_directive = stripped
                break
        assert frame_src_directive, "CSP is missing frame-src directive entirely"
        assert "https://*.run.app" in frame_src_directive, (
            "CSP frame-src must allow https://*.run.app so the worksheet PDF "
            "iframe isn't blocked on Cloud-Run-direct deploys (frontend and "
            "backend on different *.run.app origins). "
            f"Got: {frame_src_directive!r}"
        )


class TestAssetProxyFramingHeaders:
    """Regression test for #2486 — SecurityHeadersMiddleware blanket-denied
    framing of its OWN `/assets/*` responses, defeating the frame-src fix above.

    Widening the *parent* page's `frame-src` (TestCspDirectives above) is
    necessary but not sufficient: the middleware unconditionally stamps
    every response — including the PDF/image bytes served by
    app/routes/assets.py — with `X-Frame-Options: DENY` and
    `frame-ancestors 'none'`. Both of those govern whether the *resource
    itself* may be framed by anyone, including our own frontend. DENY /
    'none' block that unconditionally, regardless of frame-src.

    Confirmed via real-browser QA against a live PR preview: after fixing
    frame-src alone, the iframe network request succeeded (200
    application/pdf, no CSP console error) but the worksheet modal stayed
    visually blank — because the framed PDF response itself refused to be
    framed. curl against the same URL confirmed `x-frame-options: DENY` and
    `frame-ancestors 'none'` on the PDF response.

    This didn't matter pre-#2488 because storage.googleapis.com (which
    doesn't set X-Frame-Options) served these files directly; it only
    surfaced once they started flowing through our own
    SecurityHeadersMiddleware-wrapped backend.
    """

    @staticmethod
    def _mock_bucket_with_blob(content: bytes):
        blob = MagicMock()
        blob.download_as_bytes.return_value = content
        bucket = MagicMock()
        bucket.blob.return_value = blob
        return bucket

    @patch("app.routes.assets._get_bucket")
    def test_asset_pdf_response_does_not_send_x_frame_options_deny(self, mock_get_bucket):
        mock_get_bucket.return_value = self._mock_bucket_with_blob(b"%PDF-1.4 fake")

        resp = client.get("/assets/worksheets/G5-L23.pdf")

        assert resp.status_code == 200
        assert resp.headers.get("x-frame-options") != "DENY", (
            "X-Frame-Options: DENY on /assets/* blocks our own worksheet PDF "
            "iframe from framing it, in every browser (DENY has no same-origin "
            "exception, unlike SAMEORIGIN)."
        )

    @patch("app.routes.assets._get_bucket")
    def test_asset_pdf_response_frame_ancestors_allows_own_origins(self, mock_get_bucket):
        mock_get_bucket.return_value = self._mock_bucket_with_blob(b"%PDF-1.4 fake")

        resp = client.get("/assets/worksheets/G5-L23.pdf")

        csp = resp.headers.get("content-security-policy", "")
        frame_ancestors_directive = ""
        for part in csp.split(";"):
            stripped = part.strip()
            if stripped.startswith("frame-ancestors"):
                frame_ancestors_directive = stripped
                break
        assert frame_ancestors_directive, "Asset response is missing frame-ancestors entirely"
        assert "'none'" not in frame_ancestors_directive, (
            f"frame-ancestors 'none' blocks our own worksheet PDF iframe "
            f"unconditionally. Got: {frame_ancestors_directive!r}"
        )
        assert "'self'" in frame_ancestors_directive, (
            f"frame-ancestors must allow 'self' (Firebase Hosting same-origin "
            f"rewrite). Got: {frame_ancestors_directive!r}"
        )
        assert "https://*.run.app" in frame_ancestors_directive, (
            f"frame-ancestors must allow https://*.run.app (Cloud-Run-direct "
            f"frontend framing the backend's own cross-origin asset URL). "
            f"Got: {frame_ancestors_directive!r}"
        )

    def test_html_routes_are_unaffected_by_the_asset_carveout(self):
        """Anti-clickjacking on regular pages/API responses must stay intact —
        the relaxed framing policy is scoped to /assets/* only."""
        resp = client.get("/")
        assert resp.headers.get("x-frame-options") == "DENY"
        csp = resp.headers.get("content-security-policy", "")
        assert "frame-ancestors 'none'" in csp
