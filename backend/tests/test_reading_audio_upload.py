"""Tests for async GCS audio upload on /reading/transcribe (Issue #2266).

This file tests:
1. audio_upload_service.py — unit tests for the service functions
2. Route integration — proves TestClient does NOT call real GCS

KEY RULE (Pit #1 guard):
    BackgroundTasks in TestClient / Starlette execute synchronously in the
    test thread.  If upload_reading_audio_to_gcs is NOT patched, it will
    attempt to initialise a real GCS Storage client.  Tests MUST patch the
    function at the *route module* import site:

        "app.routes.learning.learning_reading.upload_reading_audio_to_gcs"

    NOT at the service module (that would be too late — the route already
    has a reference to the original).

Proof of safety (no real GCS calls):
    - Tests that send requests to the route patch the upload function and
      assert it was called with the correct args but never actually ran.
    - The service unit tests clear the module-level client sentinel before
      each test to start fresh, and mock google.cloud.storage entirely.

Run:
    cd backend
    python -m pytest tests/test_reading_audio_upload.py -v
"""

import sys
import os

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import threading
import pytest
from unittest.mock import MagicMock, patch, call


# ─────────────────────────────────────────────────────────────────────────────
# Helpers
# ─────────────────────────────────────────────────────────────────────────────


def _reset_gcs_sentinel():
    """Clear the module-level GCS client between tests so each starts fresh."""
    import app.services.audio_upload_service as svc
    svc._gcs_bucket_client = None


# ─────────────────────────────────────────────────────────────────────────────
# 1. Service unit tests
# ─────────────────────────────────────────────────────────────────────────────


class TestAudioUploadServiceNoBucket:
    """READING_AUDIO_GCS_BUCKET not set → uploads disabled, no GCS calls."""

    def setup_method(self):
        _reset_gcs_sentinel()

    def test_upload_skipped_when_bucket_env_not_set(self, caplog):
        """When READING_AUDIO_GCS_BUCKET is unset, upload silently skips."""
        import app.services.audio_upload_service as svc

        original_bucket = svc.READING_AUDIO_GCS_BUCKET
        try:
            svc.READING_AUDIO_GCS_BUCKET = None  # simulate env var absent
            _reset_gcs_sentinel()

            with patch("google.cloud.storage.Client") as mock_gcs:
                svc.upload_reading_audio_to_gcs(
                    audio_bytes=b"fake",
                    mime_type="audio/webm",
                    user_id=1,
                    lesson_id=None,
                    duration_ms=3000,
                )
                # GCS Client must NOT be instantiated
                mock_gcs.assert_not_called()
        finally:
            svc.READING_AUDIO_GCS_BUCKET = original_bucket

    def test_no_bucket_env_logs_warning(self, caplog):
        """Missing READING_AUDIO_GCS_BUCKET produces exactly one WARNING."""
        import logging
        import app.services.audio_upload_service as svc

        original_bucket = svc.READING_AUDIO_GCS_BUCKET
        try:
            svc.READING_AUDIO_GCS_BUCKET = None
            _reset_gcs_sentinel()

            with caplog.at_level(logging.WARNING, logger="app.services.audio_upload_service"):
                svc.upload_reading_audio_to_gcs(
                    audio_bytes=b"fake",
                    mime_type="audio/webm",
                    user_id=1,
                    lesson_id=None,
                    duration_ms=None,
                )

            # Should emit exactly 1 warning about missing env var
            warn_msgs = [r for r in caplog.records if r.levelname == "WARNING"]
            assert len(warn_msgs) == 1
            assert "READING_AUDIO_GCS_BUCKET" in warn_msgs[0].message
        finally:
            svc.READING_AUDIO_GCS_BUCKET = original_bucket


class TestAudioUploadServiceWithBucket:
    """READING_AUDIO_GCS_BUCKET is set → uploads proceed (real GCS mocked)."""

    def setup_method(self):
        _reset_gcs_sentinel()

    def test_upload_calls_gcs_blob_upload(self):
        """Happy path: bytes are uploaded with correct content-type."""
        import app.services.audio_upload_service as svc

        original_bucket = svc.READING_AUDIO_GCS_BUCKET
        try:
            svc.READING_AUDIO_GCS_BUCKET = "test-bucket"
            _reset_gcs_sentinel()

            mock_blob = MagicMock()
            mock_bucket = MagicMock()
            mock_bucket.blob.return_value = mock_blob

            with patch("google.cloud.storage.Client") as mock_gcs_cls:
                mock_gcs_cls.return_value.bucket.return_value = mock_bucket

                svc.upload_reading_audio_to_gcs(
                    audio_bytes=b"real_audio",
                    mime_type="audio/webm",
                    user_id=99,
                    lesson_id="L7",
                    duration_ms=5000,
                )

            mock_blob.upload_from_string.assert_called_once_with(
                b"real_audio", content_type="audio/webm"
            )
        finally:
            svc.READING_AUDIO_GCS_BUCKET = original_bucket

    def test_upload_blob_path_format(self):
        """GCS blob path follows reading-audio/{lesson_id}/{user_id}/{ts}{ext}."""
        import app.services.audio_upload_service as svc

        original_bucket = svc.READING_AUDIO_GCS_BUCKET
        try:
            svc.READING_AUDIO_GCS_BUCKET = "test-bucket"
            _reset_gcs_sentinel()

            mock_bucket = MagicMock()
            with patch("google.cloud.storage.Client") as mock_gcs_cls:
                mock_gcs_cls.return_value.bucket.return_value = mock_bucket

                svc.upload_reading_audio_to_gcs(
                    audio_bytes=b"x",
                    mime_type="audio/ogg",
                    user_id=42,
                    lesson_id="G6-L11",
                    duration_ms=None,
                )

            # Verify blob path structure
            blob_path_arg = mock_bucket.blob.call_args[0][0]
            assert blob_path_arg.startswith("reading-audio/G6-L11/42/")
            assert blob_path_arg.endswith(".ogg")
        finally:
            svc.READING_AUDIO_GCS_BUCKET = original_bucket

    def test_unknown_lesson_id_when_none(self):
        """lesson_id=None → path uses 'unknown' as segment."""
        import app.services.audio_upload_service as svc

        original_bucket = svc.READING_AUDIO_GCS_BUCKET
        try:
            svc.READING_AUDIO_GCS_BUCKET = "test-bucket"
            _reset_gcs_sentinel()

            mock_bucket = MagicMock()
            with patch("google.cloud.storage.Client") as mock_gcs_cls:
                mock_gcs_cls.return_value.bucket.return_value = mock_bucket

                svc.upload_reading_audio_to_gcs(
                    audio_bytes=b"x",
                    mime_type="audio/wav",
                    user_id=7,
                    lesson_id=None,
                    duration_ms=1000,
                )

            blob_path_arg = mock_bucket.blob.call_args[0][0]
            assert "/unknown/" in blob_path_arg
        finally:
            svc.READING_AUDIO_GCS_BUCKET = original_bucket

    def test_gcs_exception_swallowed_fail_silently(self):
        """Any GCS exception during upload is caught — never raises to caller."""
        import app.services.audio_upload_service as svc

        original_bucket = svc.READING_AUDIO_GCS_BUCKET
        try:
            svc.READING_AUDIO_GCS_BUCKET = "test-bucket"
            _reset_gcs_sentinel()

            mock_blob = MagicMock()
            mock_blob.upload_from_string.side_effect = Exception("GCS 503")
            mock_bucket = MagicMock()
            mock_bucket.blob.return_value = mock_blob

            with patch("google.cloud.storage.Client") as mock_gcs_cls:
                mock_gcs_cls.return_value.bucket.return_value = mock_bucket

                # Must NOT raise
                svc.upload_reading_audio_to_gcs(
                    audio_bytes=b"x",
                    mime_type="audio/webm",
                    user_id=1,
                    lesson_id=None,
                    duration_ms=None,
                )
        finally:
            svc.READING_AUDIO_GCS_BUCKET = original_bucket

    def test_no_public_acl_set(self):
        """make_public / predefined_acl are NEVER called (privacy guard)."""
        import app.services.audio_upload_service as svc

        original_bucket = svc.READING_AUDIO_GCS_BUCKET
        try:
            svc.READING_AUDIO_GCS_BUCKET = "test-bucket"
            _reset_gcs_sentinel()

            mock_blob = MagicMock()
            mock_bucket = MagicMock()
            mock_bucket.blob.return_value = mock_blob

            with patch("google.cloud.storage.Client") as mock_gcs_cls:
                mock_gcs_cls.return_value.bucket.return_value = mock_bucket

                svc.upload_reading_audio_to_gcs(
                    audio_bytes=b"x",
                    mime_type="audio/webm",
                    user_id=1,
                    lesson_id=None,
                    duration_ms=None,
                )

            mock_blob.make_public.assert_not_called()
            # Also verify predefined_acl was not passed to upload_from_string
            call_kwargs = mock_blob.upload_from_string.call_args[1]
            assert "predefined_acl" not in call_kwargs
        finally:
            svc.READING_AUDIO_GCS_BUCKET = original_bucket


class TestGcsClientLock:
    """Thread-safety: concurrent init does not race."""

    def setup_method(self):
        _reset_gcs_sentinel()

    def test_concurrent_init_single_client(self):
        """Multiple threads calling _get_gcs_bucket() result in one Client()."""
        import app.services.audio_upload_service as svc

        original_bucket = svc.READING_AUDIO_GCS_BUCKET
        try:
            svc.READING_AUDIO_GCS_BUCKET = "test-bucket"
            _reset_gcs_sentinel()

            call_count = []
            mock_bucket = MagicMock()

            def _fake_client_init(self):
                call_count.append(1)
                return None  # __init__ returns None

            with patch("google.cloud.storage.Client") as mock_gcs_cls:
                instance = MagicMock()
                instance.bucket.return_value = mock_bucket
                mock_gcs_cls.return_value = instance

                threads = [
                    threading.Thread(target=svc._get_gcs_bucket)
                    for _ in range(10)
                ]
                for t in threads:
                    t.start()
                for t in threads:
                    t.join()

                # Client() instantiated exactly once despite 10 threads
                assert mock_gcs_cls.call_count == 1
        finally:
            svc.READING_AUDIO_GCS_BUCKET = original_bucket


class TestNormaliseMime:
    """Utility function correctness."""

    def test_strips_codec(self):
        from app.services.audio_upload_service import _normalise_mime
        assert _normalise_mime("audio/webm;codecs=opus") == "audio/webm"
        assert _normalise_mime("audio/webm; codecs=opus") == "audio/webm"

    def test_passthrough_clean_mime(self):
        from app.services.audio_upload_service import _normalise_mime
        assert _normalise_mime("audio/ogg") == "audio/ogg"
        assert _normalise_mime("audio/wav") == "audio/wav"


# ─────────────────────────────────────────────────────────────────────────────
# 2. Route integration tests — proves no real GCS calls happen
# ─────────────────────────────────────────────────────────────────────────────


def _build_app():
    """Minimal FastAPI app with transcribe route, auth/rate-limit mocked."""
    from fastapi import FastAPI
    from app.routes.learning.learning_reading import router
    from app.auth.dependencies import get_current_user
    from app.auth.rate_limiter import ai_limit_10_per_min

    app = FastAPI()

    def _mock_user():
        user = MagicMock()
        user.id = 42
        return user

    app.dependency_overrides[get_current_user] = _mock_user
    app.dependency_overrides[ai_limit_10_per_min] = lambda: None
    app.include_router(router, prefix="/api")
    return app


class TestTranscribeRouteGcsPatch:
    """Route-level: BackgroundTasks executes synchronously in TestClient.

    CRITICAL: upload_reading_audio_to_gcs must be patched at the ROUTE MODULE
    import site, not the service module.  The route did:

        from ...services.audio_upload_service import upload_reading_audio_to_gcs

    so the reference lives at:

        app.routes.learning.learning_reading.upload_reading_audio_to_gcs

    Patching at the service module path would NOT intercept calls from the route.
    """

    def test_happy_path_upload_called_with_correct_args(self):
        """Route happy path: upload background task is scheduled, NOT real GCS."""
        from fastapi.testclient import TestClient
        from unittest.mock import AsyncMock

        app = _build_app()
        client = TestClient(app)

        mock_transcribe_result = {
            "transcript": "孟嘗君養了很多門客。",
            "method": "gemini",
            "reasoning": "正確。",
        }

        with (
            patch(
                "app.routes.learning.learning_reading.transcribe_reading_audio",
                new=AsyncMock(return_value=mock_transcribe_result),
            ),
            # Pit #1 fix: patch at ROUTE module, not service module
            patch(
                "app.routes.learning.learning_reading.upload_reading_audio_to_gcs",
            ) as mock_upload,
        ):
            resp = client.post(
                "/api/reading/transcribe",
                files={"audio": ("rec.webm", b"fake_audio", "audio/webm")},
                data={"target_text": "孟嘗君養了很多門客。", "duration_ms": "5000"},
            )

        assert resp.status_code == 200
        body = resp.json()
        assert body["transcript"] == "孟嘗君養了很多門客。"

        # Background task was scheduled and executed by TestClient (synchronous)
        mock_upload.assert_called_once()
        call_kwargs = mock_upload.call_args.kwargs
        assert call_kwargs["audio_bytes"] == b"fake_audio"
        assert call_kwargs["user_id"] == 42
        assert call_kwargs["mime_type"] == "audio/webm"

    def test_upload_not_called_when_mime_rejected(self):
        """MIME gate returns 415 before background task is queued."""
        from fastapi.testclient import TestClient

        app = _build_app()
        client = TestClient(app)

        with patch(
            "app.routes.learning.learning_reading.upload_reading_audio_to_gcs",
        ) as mock_upload:
            resp = client.post(
                "/api/reading/transcribe",
                files={"audio": ("rec.mp3", b"fake", "audio/mpeg_bad_type")},
                data={"target_text": "測試"},
            )

        assert resp.status_code == 415
        mock_upload.assert_not_called()

    def test_upload_not_called_when_audio_empty(self):
        """400 on empty audio → background task is never queued."""
        from fastapi.testclient import TestClient

        app = _build_app()
        client = TestClient(app)

        with patch(
            "app.routes.learning.learning_reading.upload_reading_audio_to_gcs",
        ) as mock_upload:
            resp = client.post(
                "/api/reading/transcribe",
                files={"audio": ("rec.webm", b"", "audio/webm")},
                data={"target_text": "測試"},
            )

        assert resp.status_code == 400
        mock_upload.assert_not_called()

    def test_fallback_result_still_schedules_upload(self):
        """Even when Gemini falls back, the audio is uploaded (for debug)."""
        from fastapi.testclient import TestClient
        from unittest.mock import AsyncMock

        app = _build_app()
        client = TestClient(app)

        fallback_result = {"transcript": None, "method": "fallback", "reason": "timeout"}

        with (
            patch(
                "app.routes.learning.learning_reading.transcribe_reading_audio",
                new=AsyncMock(return_value=fallback_result),
            ),
            patch(
                "app.routes.learning.learning_reading.upload_reading_audio_to_gcs",
            ) as mock_upload,
        ):
            resp = client.post(
                "/api/reading/transcribe",
                files={"audio": ("rec.webm", b"fake_audio", "audio/webm")},
                data={"target_text": "測試文字"},
            )

        assert resp.status_code == 200
        body = resp.json()
        assert body["method"] == "fallback"

        # Upload is still called even on Gemini fallback — debug value remains
        mock_upload.assert_called_once()

    def test_no_real_gcs_client_instantiated_during_route_test(self):
        """Prove TestClient never reaches google.cloud.storage.Client."""
        from fastapi.testclient import TestClient
        from unittest.mock import AsyncMock

        app = _build_app()
        client = TestClient(app)

        mock_result = {
            "transcript": "春風吹過田野。",
            "method": "gemini",
            "reasoning": "OK",
        }

        with (
            patch(
                "app.routes.learning.learning_reading.transcribe_reading_audio",
                new=AsyncMock(return_value=mock_result),
            ),
            patch(
                "app.routes.learning.learning_reading.upload_reading_audio_to_gcs",
            ) as mock_upload,
            # Extra guard: if google.cloud.storage.Client is called it fails the test
            patch(
                "google.cloud.storage.Client",
                side_effect=AssertionError("Real GCS Client was instantiated in test!"),
            ),
        ):
            resp = client.post(
                "/api/reading/transcribe",
                files={"audio": ("rec.webm", b"x", "audio/webm")},
                data={"target_text": "春風吹過田野。"},
            )

        # If we reach here without AssertionError, no real GCS call happened
        assert resp.status_code == 200
        mock_upload.assert_called_once()
