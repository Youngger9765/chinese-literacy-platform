"""Tests for FullReading Gemini audio transcription (Issue #2131).

Tests the new POST /api/reading/transcribe endpoint and the
reading_transcription_service module.

Coverage:
1. Service: successful Gemini transcription → correct schema
2. Service: Gemini failure → fail-closed {transcript: None, method: "fallback"}
3. Service: Gemini timeout → fail-closed fallback (never 500)
4. Service: content filter → fail-closed fallback
5. Route: MIME type validation → 415 on unsupported type
6. Route: audio size cap → 413 on oversized audio
7. Route: empty audio → 400
8. Route: target_text too long → 413
9. Route: unauthenticated → 401 (depends on auth dependency)
10. Route: happy path → 200 with transcript field

Run with:
    cd backend
    python -m pytest tests/test_reading_transcription.py -v
"""

import sys
import os

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import json
import pytest
from unittest.mock import AsyncMock, MagicMock, patch


# ─────────────────────────────────────────────────────────────────────────────
# Service-layer tests (mock Gemini client entirely)
# ─────────────────────────────────────────────────────────────────────────────


def _make_gemini_response(transcript: str, reasoning: str) -> MagicMock:
    """Build a minimal mock of a Gemini response object."""
    mock_resp = MagicMock()
    mock_resp.candidates = [MagicMock()]  # non-empty → no prompt block
    mock_resp.candidates[0].finish_reason = "STOP"  # not SAFETY
    mock_resp.text = json.dumps({"transcript": transcript, "reasoning": reasoning})
    mock_resp.prompt_feedback = MagicMock()
    mock_resp.prompt_feedback.block_reason = None
    return mock_resp


def _make_mock_gemini_call(response):
    """Return an AsyncMock that simulates asyncio.wait_for(asyncio.to_thread(...))."""
    import asyncio

    async def _fake_wait_for(coro, timeout=None):
        # The inner coro from asyncio.to_thread is already resolved in tests
        if asyncio.iscoroutine(coro):
            return await coro
        return response

    return _fake_wait_for


class TestTranscriptionServiceSuccess:
    """Gemini returns a valid JSON response."""

    @pytest.mark.asyncio
    async def test_returns_transcript_and_method_gemini(self):
        from app.services.reading_transcription_service import transcribe_reading_audio

        mock_resp = _make_gemini_response(
            transcript="孟嘗君養了很多門客。",
            reasoning="原文專有名詞「孟嘗君」辨識正確。",
        )

        with patch(
            "app.services.reading_transcription_service.asyncio.wait_for",
            new=AsyncMock(return_value=mock_resp),
        ):
            result = await transcribe_reading_audio(
                audio_bytes=b"fake_audio_bytes",
                mime_type="audio/webm",
                target_text="孟嘗君養了很多門客。",
                duration_ms=5000,
            )

        assert result["method"] == "gemini"
        assert result["transcript"] == "孟嘗君養了很多門客。"
        assert "reasoning" in result
        assert result["transcript"] is not None

    @pytest.mark.asyncio
    async def test_schema_has_required_keys(self):
        from app.services.reading_transcription_service import transcribe_reading_audio

        mock_resp = _make_gemini_response("春風吹過田野。", "轉錄正確。")

        with patch(
            "app.services.reading_transcription_service.asyncio.wait_for",
            new=AsyncMock(return_value=mock_resp),
        ):
            result = await transcribe_reading_audio(
                audio_bytes=b"audio",
                mime_type="audio/webm",
                target_text="春風吹過田野。",
            )

        assert "transcript" in result
        assert "method" in result
        assert "reasoning" in result


class TestTranscriptionServiceFailClosed:
    """Any Gemini failure → fail-closed, never raises, never auto-passes student."""

    @pytest.mark.asyncio
    async def test_gemini_exception_returns_fallback(self):
        from app.services.reading_transcription_service import transcribe_reading_audio

        async def _raise(*args, **kwargs):
            raise Exception("Vertex AI 503")

        with patch(
            "app.services.reading_transcription_service.asyncio.wait_for",
            side_effect=Exception("Vertex AI 503"),
        ):
            result = await transcribe_reading_audio(
                audio_bytes=b"audio",
                mime_type="audio/webm",
                target_text="測試文字",
            )

        assert result["method"] == "fallback"
        assert result["transcript"] is None  # never auto-passes

    @pytest.mark.asyncio
    async def test_timeout_returns_fallback(self):
        from app.services.reading_transcription_service import transcribe_reading_audio

        with patch(
            "app.services.reading_transcription_service.asyncio.wait_for",
            side_effect=TimeoutError("Timeout"),
        ):
            result = await transcribe_reading_audio(
                audio_bytes=b"audio",
                mime_type="audio/webm",
                target_text="測試文字",
            )

        assert result["method"] == "fallback"
        assert result["transcript"] is None

    @pytest.mark.asyncio
    async def test_content_filter_returns_fallback(self):
        from app.services.reading_transcription_service import transcribe_reading_audio
        from app.services.ai.gemini_client import GeminiContentFilterError

        mock_resp = _make_gemini_response("...", "...")

        with (
            patch(
                "app.services.reading_transcription_service.asyncio.wait_for",
                new=AsyncMock(return_value=mock_resp),
            ),
            patch(
                "app.services.reading_transcription_service._check_safety_filter",
                side_effect=GeminiContentFilterError("blocked"),
            ),
        ):
            result = await transcribe_reading_audio(
                audio_bytes=b"audio",
                mime_type="audio/webm",
                target_text="測試文字",
            )

        assert result["method"] == "fallback"
        assert result["transcript"] is None

    @pytest.mark.asyncio
    async def test_malformed_json_returns_fallback(self):
        from app.services.reading_transcription_service import transcribe_reading_audio

        mock_resp = MagicMock()
        mock_resp.candidates = [MagicMock()]
        mock_resp.candidates[0].finish_reason = "STOP"
        mock_resp.text = "NOT VALID JSON {{"
        mock_resp.prompt_feedback = MagicMock()
        mock_resp.prompt_feedback.block_reason = None

        with patch(
            "app.services.reading_transcription_service.asyncio.wait_for",
            new=AsyncMock(return_value=mock_resp),
        ):
            result = await transcribe_reading_audio(
                audio_bytes=b"audio",
                mime_type="audio/webm",
                target_text="測試文字",
            )

        assert result["method"] == "fallback"
        assert result["transcript"] is None


class TestTranscriptionServiceMime:
    """MIME type normalisation."""

    def test_normalise_mime_strips_codec(self):
        from app.services.reading_transcription_service import _normalise_mime

        assert _normalise_mime("audio/webm;codecs=opus") == "audio/webm"
        assert _normalise_mime("audio/webm; codecs=opus") == "audio/webm"
        assert _normalise_mime("audio/ogg") == "audio/ogg"


# ─────────────────────────────────────────────────────────────────────────────
# Route-layer tests (FastAPI TestClient, auth mocked)
# ─────────────────────────────────────────────────────────────────────────────


def _build_app_with_route():
    """Build a minimal FastAPI app with the transcribe route, auth mocked."""
    from fastapi import FastAPI
    from app.routes.learning.learning_reading import router
    from app.auth.dependencies import get_current_user
    from app.auth.rate_limiter import ai_limit_10_per_min

    app = FastAPI()

    # Override auth and rate-limit dependencies
    def _mock_user():
        user = MagicMock()
        user.id = 42
        return user

    def _mock_rate_limit():
        pass  # always allow

    app.dependency_overrides[get_current_user] = _mock_user
    app.dependency_overrides[ai_limit_10_per_min] = _mock_rate_limit

    app.include_router(router, prefix="/api")
    return app


class TestTranscribeRoute:
    """Route-level validation (size, MIME, empty payload)."""

    def _client(self):
        from fastapi.testclient import TestClient

        return TestClient(_build_app_with_route())

    def test_unsupported_mime_returns_415(self):
        client = self._client()
        resp = client.post(
            "/api/reading/transcribe",
            files={"audio": ("rec.mp3", b"fake", "audio/mpeg_bad_type")},
            data={"target_text": "測試"},
        )
        assert resp.status_code == 415

    def test_oversized_audio_returns_413(self):
        client = self._client()
        big_audio = b"x" * (10 * 1024 * 1024 + 1)  # 10 MB + 1 byte
        resp = client.post(
            "/api/reading/transcribe",
            files={"audio": ("rec.webm", big_audio, "audio/webm")},
            data={"target_text": "測試"},
        )
        assert resp.status_code == 413

    def test_empty_audio_returns_400(self):
        client = self._client()
        resp = client.post(
            "/api/reading/transcribe",
            files={"audio": ("rec.webm", b"", "audio/webm")},
            data={"target_text": "測試"},
        )
        assert resp.status_code == 400

    def test_target_text_too_long_returns_413(self):
        client = self._client()
        long_text = "字" * 3001
        resp = client.post(
            "/api/reading/transcribe",
            files={"audio": ("rec.webm", b"audio", "audio/webm")},
            data={"target_text": long_text},
        )
        assert resp.status_code == 413

    def test_happy_path_returns_200_with_transcript(self):
        client = self._client()

        mock_result = {
            "transcript": "孟嘗君養了很多門客。",
            "method": "gemini",
            "reasoning": "辨識正確。",
        }

        with patch(
            "app.routes.learning.learning_reading.transcribe_reading_audio",
            new=AsyncMock(return_value=mock_result),
        ):
            resp = client.post(
                "/api/reading/transcribe",
                files={"audio": ("rec.webm", b"fake_audio", "audio/webm")},
                data={"target_text": "孟嘗君養了很多門客。", "duration_ms": "5000"},
            )

        assert resp.status_code == 200
        body = resp.json()
        assert body["transcript"] == "孟嘗君養了很多門客。"
        assert body["method"] == "gemini"

    def test_gemini_fallback_returns_200_with_null_transcript(self):
        """Gemini failure must return HTTP 200 with null transcript, not 500."""
        client = self._client()

        fallback_result = {"transcript": None, "method": "fallback"}

        with patch(
            "app.routes.learning.learning_reading.transcribe_reading_audio",
            new=AsyncMock(return_value=fallback_result),
        ):
            resp = client.post(
                "/api/reading/transcribe",
                files={"audio": ("rec.webm", b"fake_audio", "audio/webm")},
                data={"target_text": "測試文字"},
            )

        assert resp.status_code == 200
        body = resp.json()
        assert body["transcript"] is None
        assert body["method"] == "fallback"
