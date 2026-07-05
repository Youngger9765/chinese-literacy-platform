"""Route-level integration TDD for POST /api/testset/upload magic-bytes wiring.

Companion to test_testset_upload_magic_bytes.py (which unit-tests the pure
_audio_bytes_match_declared_mime function). That unit test does NOT lock the
WIRING: if someone deletes the `if not _audio_bytes_match_declared_mime(...):
raise 400` call site in the route, the unit test stays green while the spoof
bug returns. This file closes that gap by driving the real HTTP route.

GCS is mocked so the happy path is reachable — that makes the spoof lock
precise: with the check present a spoof gets 400; if the check were removed the
spoof would reach the (mocked) bucket and return 200. The test asserts 400, so
removing the wiring fails the test.

Run:
    cd backend && python -m pytest tests/test_testset_upload_route.py -v
"""
from __future__ import annotations

import os
import sys
from unittest.mock import MagicMock, patch

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import pytest
from fastapi.testclient import TestClient

from app.main import app

# Public endpoint — no auth override needed.
client = TestClient(app, raise_server_exceptions=False)

# Real RIFF/WAVE header (>=12 bytes, RIFF at 0, WAVE at 8) — passes magic-bytes.
REAL_WAV = b"RIFF\x24\x00\x00\x00WAVEfmt " + b"\x00" * 20
SPOOF = b"this is not audio at all, just text pretending to be audio"


def _mock_bucket() -> MagicMock:
    """Bucket whose blob().upload_from_string() succeeds silently."""
    bucket = MagicMock()
    blob = MagicMock()
    blob.upload_from_string.return_value = None
    bucket.blob.return_value = blob
    return bucket


def _post(audio_bytes: bytes, mime: str, lesson_id: str = "1", version: str = "correct"):
    return client.post(
        "/api/testset/upload",
        data={"contributor_name": "QA-route", "lesson_id": lesson_id, "version": version},
        files={"audio": (f"x.{mime.split('/')[-1]}", audio_bytes, mime)},
    )


class TestMagicBytesWiring:
    """The critical lock: spoofed content must be rejected by the ROUTE, not just
    the pure function. GCS mocked so a removed check would otherwise 200."""

    def test_spoof_wav_rejected_400(self):
        with patch("app.routes.testset._get_gcs_bucket", return_value=_mock_bucket()):
            resp = _post(SPOOF, "audio/wav")
        assert resp.status_code == 400, resp.text
        assert "does not match declared type" in resp.json()["detail"]

    def test_spoof_ogg_rejected_400(self):
        with patch("app.routes.testset._get_gcs_bucket", return_value=_mock_bucket()):
            resp = _post(SPOOF, "audio/ogg")
        assert resp.status_code == 400, resp.text
        assert "does not match declared type" in resp.json()["detail"]

    def test_real_wav_accepted_200(self):
        """Valid audio is NOT false-rejected and flows through the route to storage."""
        bucket = _mock_bucket()
        with patch("app.routes.testset._get_gcs_bucket", return_value=bucket):
            resp = _post(REAL_WAV, "audio/wav")
        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert body["ok"] is True
        assert body["path"].endswith(".webm")
        # storage actually invoked (audio blob + meta blob)
        assert bucket.blob.call_count >= 2

    def test_unsupported_mime_rejected_415(self):
        """deny-by-default at the MIME whitelist layer (before magic-bytes)."""
        with patch("app.routes.testset._get_gcs_bucket", return_value=_mock_bucket()):
            resp = _post(REAL_WAV, "text/plain")
        assert resp.status_code == 415, resp.text

    def test_gcs_down_fails_closed_503(self):
        """Real audio but bucket unavailable → fail-closed 503, never silent pass."""
        with patch("app.routes.testset._get_gcs_bucket", return_value=None):
            resp = _post(REAL_WAV, "audio/wav")
        assert resp.status_code == 503, resp.text


class TestUploadValidation:
    """Remaining upload validation branches — incl. the lesson_id whitelist
    (path-injection guard, security #2304)."""

    def test_lesson_id_path_injection_rejected_400(self):
        """lesson_id outside [A-Za-z0-9_-] whitelist (path traversal) → 400."""
        with patch("app.routes.testset._get_gcs_bucket", return_value=_mock_bucket()):
            resp = _post(REAL_WAV, "audio/wav", lesson_id="../../etc/passwd")
        assert resp.status_code == 400, resp.text
        assert "lesson_id" in resp.json()["detail"]

    def test_empty_audio_rejected_400(self):
        with patch("app.routes.testset._get_gcs_bucket", return_value=_mock_bucket()):
            resp = _post(b"", "audio/wav")
        assert resp.status_code == 400, resp.text
        assert "empty" in resp.json()["detail"]

    def test_oversize_rejected_413(self):
        """Size cap fires before magic-bytes (patch cap small to keep payload tiny)."""
        with patch("app.routes.testset._MAX_AUDIO_BYTES", 8), \
             patch("app.routes.testset._get_gcs_bucket", return_value=_mock_bucket()):
            resp = _post(REAL_WAV, "audio/wav")  # 32 bytes > 8
        assert resp.status_code == 413, resp.text

    def test_bad_version_rejected_400(self):
        with patch("app.routes.testset._get_gcs_bucket", return_value=_mock_bucket()):
            resp = _post(REAL_WAV, "audio/wav", version="bogus")
        assert resp.status_code == 400, resp.text
        assert "version" in resp.json()["detail"]

    def test_blank_contributor_rejected_400(self):
        with patch("app.routes.testset._get_gcs_bucket", return_value=_mock_bucket()):
            resp = client.post(
                "/api/testset/upload",
                data={"contributor_name": "  ", "lesson_id": "1", "version": "correct"},
                files={"audio": ("x.wav", REAL_WAV, "audio/wav")},
            )
        assert resp.status_code == 400, resp.text
        assert "required" in resp.json()["detail"]


class TestUploadWritesContentType:
    """#2434 write side: upload persists the real content_type into meta so
    batch-eval can pass the true mime (read side locked in test_testset_batch_eval)."""

    def test_meta_records_content_type(self):
        bucket = MagicMock()
        blob = MagicMock()
        bucket.blob.return_value = blob
        with patch("app.routes.testset._get_gcs_bucket", return_value=bucket):
            resp = _post(REAL_WAV, "audio/wav")
        assert resp.status_code == 200, resp.text
        # the meta upload is the call whose first positional arg is a JSON string
        meta_jsons = [
            c.args[0]
            for c in blob.upload_from_string.call_args_list
            if c.args and isinstance(c.args[0], str)
        ]
        assert any('"content_type": "audio/wav"' in j for j in meta_jsons), meta_jsons
