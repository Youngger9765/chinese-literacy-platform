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
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]  # backend/
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


class TestUploadIsWiredToTheLiveRoute:
    """上傳這條路在某次重構搬家了，而守它的測試沒跟著搬。

    ⚠️ 原本這裡是 `TestTranscribeRouteGcsPatch`，5 條全紅，錯誤是

        AttributeError: module 'app.routes.learning.learning_reading'
                        does not have the attribute 'upload_reading_audio_to_gcs'

    因為 `learning_reading` 早就不 import 它了 —— 背景上傳（BackgroundTasks）
    被換成「學生按下接受分數之後，前端明確呼叫 POST /reading/save-audio」，
    由 `learning_save_audio.py` 走 `upload_reading_audio_to_gcs_sync`。

    而這支檔案**不在 CI 具名清單裡**，所以那 5 條紅了很久沒有人看到。

    這一版改成守**活的那條路**。用靜態層驗就夠了 —— 要抓的是「接線有沒有斷」，
    那是靜態事實，不需要起整個 app（qa-layering：用能忠實抓到它的最低層）。

    2026-08-29 同一輪查到的相關事實：`lingoleap-reading-audio-prod` 與
    `-staging` 兩顆桶**都沒有任何 `reading-audio/` 物件**。這裡的鎖只能保證
    接線在，不能保證真的有人錄過 —— 那件事另外追。
    """

    LIVE_ROUTE = ROOT / "app" / "routes" / "learning" / "learning_save_audio.py"
    OLD_ROUTE = ROOT / "app" / "routes" / "learning" / "learning_reading.py"

    def test_the_files_are_where_we_think(self):
        """正向對照。少了這條，下面每一條都會在空字串上通過。"""
        assert self.LIVE_ROUTE.is_file(), f"找不到 {self.LIVE_ROUTE}"
        assert self.OLD_ROUTE.is_file(), f"找不到 {self.OLD_ROUTE}"
        assert len(self.LIVE_ROUTE.read_text(encoding="utf-8")) > 500, "檔案短得不像真的"

    def test_the_live_route_actually_calls_the_upload(self):
        src = self.LIVE_ROUTE.read_text(encoding="utf-8")
        assert "upload_reading_audio_to_gcs_sync" in src, (
            "活的那條路沒有在呼叫上傳 —— 學生的朗讀錄音不會落地，"
            "而且失敗是被吞掉的（route 回 {ok:false}，不會 raise）"
        )
        assert "import" in src.split("upload_reading_audio_to_gcs_sync")[0][-400:], (
            "只在字串裡出現不算 —— 要真的 import 進來"
        )

    def test_the_blob_path_shape_is_locked(self):
        src = self.LIVE_ROUTE.read_text(encoding="utf-8")
        assert 'f"reading-audio/attempts/' in src, (
            "物件路徑的前綴變了。桶裡是用這個前綴在找東西的（老師端回放、稽核），"
            "改前綴等於把既有錄音變成孤兒"
        )

    def test_the_old_route_no_longer_owns_the_upload(self):
        """記錄搬家這件事本身 —— 有人搬回去的話這條會紅，逼他一起更新鎖。"""
        src = self.OLD_ROUTE.read_text(encoding="utf-8")
        assert "upload_reading_audio_to_gcs" not in src, (
            "上傳又出現在 learning_reading 裡了。那不一定是錯的，"
            "但這支測試的 patch 目標要跟著改，否則又會變成一堆紅著沒人看的斷言"
        )

    def test_the_background_variant_has_no_production_caller(self):
        """背景版目前是死 code（0 個正式呼叫者）。有人接回去要知道。"""
        import subprocess

        out = subprocess.run(
            # ⛔ 不限定 `.py` 的話會掃到 `__pycache__` 的 .pyc（第一版就中了），
            #    那會讓這條永遠紅 —— 一條永遠紅的鎖跟沒有一樣，會被關掉。
            ["grep", "-rn", "--include=*.py", "--exclude-dir=__pycache__",
             "upload_reading_audio_to_gcs", str(ROOT / "app")],
            capture_output=True, text=True,
        ).stdout
        lines = [l for l in out.split("\n") if l.strip()]
        assert lines, "grep 一行都沒抓到 —— 查法壞了，不是沒有呼叫者"
        callers = [
            l for l in lines
            if "_sync" not in l and "def upload_reading_audio_to_gcs(" not in l
        ]
        assert not callers, (
            "背景版又被接回去了：\n  " + "\n  ".join(callers)
            + "\n（不一定是錯的，但要一起更新這支的斷言與 blob path 的鎖）"
        )
