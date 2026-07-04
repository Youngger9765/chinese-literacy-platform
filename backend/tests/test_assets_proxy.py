"""
Tests for GET /assets/{path} — the private-bucket asset proxy.

Issue #2486: `lingoleap-assets` GCS bucket was public-read (allUsers
objectViewer), letting anyone anonymously enumerate + bulk-download the
entire course image/worksheet library (egress cost risk + content
enumeration). This route lets the backend's own service-account credentials
read the (now-private) bucket while the browser only ever talks to our own
origin.

TDD: written before app/routes/assets.py implementation. Red -> Green -> Refactor.
"""
import sys
import os
from unittest.mock import MagicMock, patch

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import pytest
from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)


def _mock_bucket_with_blob(content: bytes):
    """Build a fake GCS bucket whose .blob().download_as_bytes() returns content."""
    blob = MagicMock()
    blob.download_as_bytes.return_value = content
    bucket = MagicMock()
    bucket.blob.return_value = blob
    return bucket, blob


class TestAssetProxyAllowedPrefixes:
    """Requests under an allow-listed prefix should reach GCS and stream back."""

    @patch("app.routes.assets._get_bucket")
    def test_lessons_images_returns_200_with_content_type(self, mock_get_bucket):
        bucket, _blob = _mock_bucket_with_blob(b"\xff\xd8\xfffakejpegbytes")
        mock_get_bucket.return_value = bucket

        resp = client.get("/assets/lessons-images/G4-L1/G4-L1-01.jpg")

        assert resp.status_code == 200
        assert resp.headers["content-type"] == "image/jpeg"
        assert resp.content == b"\xff\xd8\xfffakejpegbytes"
        bucket.blob.assert_called_once_with("lessons-images/G4-L1/G4-L1-01.jpg")

    @patch("app.routes.assets._get_bucket")
    def test_stories_thumbnail_returns_200(self, mock_get_bucket):
        bucket, _blob = _mock_bucket_with_blob(b"webpbytes")
        mock_get_bucket.return_value = bucket

        resp = client.get("/assets/stories/thumbnails/lesson-1.webp")

        assert resp.status_code == 200
        assert resp.headers["content-type"] == "image/webp"

    @patch("app.routes.assets._get_bucket")
    def test_worksheet_pdf_returns_200(self, mock_get_bucket):
        bucket, _blob = _mock_bucket_with_blob(b"%PDF-1.4 fake")
        mock_get_bucket.return_value = bucket

        resp = client.get("/assets/worksheets/G5-L23.pdf")

        assert resp.status_code == 200
        assert resp.headers["content-type"] == "application/pdf"

    @patch("app.routes.assets._get_bucket")
    def test_worksheet_docx_returns_correct_content_type(self, mock_get_bucket):
        bucket, _blob = _mock_bucket_with_blob(b"PKfakedocx")
        mock_get_bucket.return_value = bucket

        resp = client.get("/assets/worksheets/G5-L23.docx")

        assert resp.status_code == 200
        assert resp.headers["content-type"] == (
            "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
        )

    @patch("app.routes.assets._get_bucket")
    def test_response_has_long_lived_cache_control(self, mock_get_bucket):
        bucket, _blob = _mock_bucket_with_blob(b"data")
        mock_get_bucket.return_value = bucket

        resp = client.get("/assets/lessons-images/G4-L1/G4-L1-01.jpg")

        assert resp.headers["cache-control"] == "public, max-age=31536000, immutable"

    @patch("app.routes.assets._get_bucket")
    def test_no_auth_required(self, mock_get_bucket):
        """Public content — no Authorization header needed (matches pre-fix behavior)."""
        bucket, _blob = _mock_bucket_with_blob(b"data")
        mock_get_bucket.return_value = bucket

        resp = client.get("/assets/lessons-images/G4-L1/G4-L1-01.jpg")

        assert resp.status_code == 200


class TestAssetProxyAllowlistRejection:
    """Anything outside the 3 allow-listed prefixes must 404 — no general GCS proxy."""

    @patch("app.routes.assets._get_bucket")
    def test_unknown_prefix_is_404(self, mock_get_bucket):
        resp = client.get("/assets/pr-screenshots/some-screenshot.png")
        assert resp.status_code == 404
        mock_get_bucket.assert_not_called()

    @patch("app.routes.assets._get_bucket")
    def test_qa_prefix_is_404(self, mock_get_bucket):
        resp = client.get("/assets/qa/whatever.png")
        assert resp.status_code == 404
        mock_get_bucket.assert_not_called()

    @patch("app.routes.assets._get_bucket")
    def test_bare_prefix_with_no_object_is_404(self, mock_get_bucket):
        resp = client.get("/assets/lessons-images/")
        assert resp.status_code == 404


class TestAssetProxyPathTraversal:
    """Path traversal attempts must never reach GCS with a decoded '..' segment."""

    @patch("app.routes.assets._get_bucket")
    def test_dotdot_traversal_is_rejected(self, mock_get_bucket):
        resp = client.get("/assets/lessons-images/../../etc/passwd")
        assert resp.status_code in (404, 400)
        mock_get_bucket.assert_not_called()

    @patch("app.routes.assets._get_bucket")
    def test_encoded_dotdot_traversal_is_rejected(self, mock_get_bucket):
        resp = client.get("/assets/lessons-images/%2e%2e/%2e%2e/etc/passwd")
        assert resp.status_code in (404, 400)
        mock_get_bucket.assert_not_called()

    @patch("app.routes.assets._get_bucket")
    def test_absolute_path_style_traversal_is_rejected(self, mock_get_bucket):
        resp = client.get("/assets/lessons-images/..%2f..%2fetc%2fpasswd")
        assert resp.status_code in (404, 400)
        mock_get_bucket.assert_not_called()

    @patch("app.routes.assets._get_bucket")
    def test_unsafe_characters_rejected(self, mock_get_bucket):
        """Backslashes / control chars outside the allow-listed charset are rejected."""
        resp = client.get("/assets/lessons-images/G4-L1/file%00.jpg")
        assert resp.status_code in (400, 404)


class TestAssetProxyMissingObject:
    """A GCS miss (object doesn't exist) must surface as a clean 404, no internals leaked."""

    @patch("app.routes.assets._get_bucket")
    def test_gcs_not_found_returns_404_not_500(self, mock_get_bucket):
        blob = MagicMock()
        blob.download_as_bytes.side_effect = Exception("404 GET ... No such object")
        bucket = MagicMock()
        bucket.blob.return_value = blob
        mock_get_bucket.return_value = bucket

        resp = client.get("/assets/lessons-images/does-not-exist/x.jpg")

        assert resp.status_code == 404
        # Must not leak internal exception text / GCS bucket internals to the client.
        assert "Exception" not in resp.text
        assert "lingoleap-assets" not in resp.text
