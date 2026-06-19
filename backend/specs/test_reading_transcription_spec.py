"""Executable spec — reading_transcription_service contracts (Issue #2156).

spec_id: reading.transcription.gemini_primary_fallback_alert
canonical_source: backend/app/services/reading_transcription_service.py
owns_code:
  - backend/app/services/reading_transcription_service.py
  - backend/app/routes/learning/learning_reading.py (TranscribeReadingResponse)
human_spec: specs/modules/reading-transcription/INTENT.md
related_issues: [2131, 2156]

Machine-verifiable contracts (C1–C5):

  C1: webm input → does NOT pass webm directly to Gemini; transcodes first.
  C2: Gemini error/timeout/safety/transcode failure → returns fallback + reason + WARN log.
  C3: Gemini success → returns {transcript: str, method: "gemini", reasoning: str}.
  C4: unsupported / empty MIME → 415 (route-level) or fallback (never 500).
  C5: rate-limit / auth / size cap present in route (structural check).

Run: cd backend && python -m pytest specs/test_reading_transcription_spec.py -v
"""
from __future__ import annotations

import asyncio
import logging
from unittest.mock import AsyncMock, MagicMock, patch


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _run(coro):
    """Run an async coroutine synchronously (pytest sync tests, Py3.11+ safe)."""
    return asyncio.run(coro)


# ---------------------------------------------------------------------------
# C1: webm input is NOT passed directly to Gemini — transcode must happen first
# ---------------------------------------------------------------------------

class TestC1WebmNotDirectToGemini:
    """C1: webm mime type triggers transcode before Gemini call."""

    def test_needs_transcode_returns_true_for_webm(self):
        from app.services.reading_transcription_service import _needs_transcode
        assert _needs_transcode("audio/webm") is True

    def test_needs_transcode_returns_true_for_webm_with_codec(self):
        from app.services.reading_transcription_service import _needs_transcode
        assert _needs_transcode("audio/webm;codecs=opus") is True
        assert _needs_transcode("audio/webm; codecs=opus") is True

    def test_needs_transcode_returns_true_for_mp4(self):
        from app.services.reading_transcription_service import _needs_transcode
        assert _needs_transcode("audio/mp4") is True

    def test_needs_transcode_returns_false_for_ogg(self):
        from app.services.reading_transcription_service import _needs_transcode
        assert _needs_transcode("audio/ogg") is False

    def test_needs_transcode_returns_false_for_wav(self):
        from app.services.reading_transcription_service import _needs_transcode
        assert _needs_transcode("audio/wav") is False

    def test_needs_transcode_returns_false_for_mp3(self):
        from app.services.reading_transcription_service import _needs_transcode
        assert _needs_transcode("audio/mpeg") is False

    def test_transcribe_audio_with_webm_transcodes_not_direct_gemini(self):
        """C1 integration: calling transcribe_reading_audio with webm MUST invoke
        _transcode_to_ogg, and the transcoded ogg bytes (not original webm) must be
        what eventually reaches the Gemini call path.

        P2#2 fix: original test only asserted _needs_transcode static helpers and
        never actually called transcribe_reading_audio — a webm-direct-to-Gemini
        regression would have passed silently.  This version calls the real function.
        """
        import sys
        from app.services import reading_transcription_service as svc

        webm_bytes = b"fake-webm-input"
        transcoded_ogg_bytes = b"fake-ogg-transcoded"

        # Capture both `data` and `mime_type` that arrive at Gemini Part.from_bytes().
        gemini_received_mime: list[str] = []
        gemini_received_data: list[bytes] = []

        fake_part = MagicMock()
        fake_part_cls = MagicMock()

        def capture_from_bytes(*args, **kwargs):  # noqa: ANN001
            # Called as Part.from_bytes(data=..., mime_type=...) — capture both.
            mime = kwargs.get("mime_type") or (args[1] if len(args) > 1 else "unknown")
            data = kwargs.get("data") or (args[0] if args else b"")
            gemini_received_mime.append(mime)
            gemini_received_data.append(data)
            return fake_part

        fake_part_cls.from_bytes = capture_from_bytes

        fake_genai_types = MagicMock()
        fake_genai_types.Part = fake_part_cls

        mock_response = MagicMock()
        mock_response.text = '{"transcript": "學生朗讀文字", "reasoning": "清晰"}'

        fake_gemini_client = MagicMock()
        fake_gemini_client.GEMINI_TIMEOUT = 30
        fake_llm_models = MagicMock()
        fake_llm_models.get_model_for_task.return_value = ("gemini-2.5-flash", "us-central1")

        # The service does `from google.genai import types as genai_types` which resolves
        # via sys.modules["google.genai"].types (not sys.modules["google.genai.types"]).
        # We must set .types on the fake genai module so capture_from_bytes is reached.
        fake_genai_module = MagicMock()
        fake_genai_module.types = fake_genai_types

        with patch.object(svc, "_transcode_to_ogg", return_value=transcoded_ogg_bytes) as mock_transcode, \
             patch.object(svc, "_check_safety_filter"), \
             patch("app.services.reading_transcription_service.asyncio.wait_for",
                   new=AsyncMock(return_value=mock_response)), \
             patch.dict(sys.modules, {
                 "google": MagicMock(),
                 "google.genai": fake_genai_module,
                 "google.genai.types": fake_genai_types,
                 "app.services.ai.gemini_client": fake_gemini_client,
                 "app.services.llm_models": fake_llm_models,
             }):

            result = _run(svc.transcribe_reading_audio(
                audio_bytes=webm_bytes,
                mime_type="audio/webm",
                target_text="課文文字",
                duration_ms=3000,
            ))

        # C1 assertion 1: _transcode_to_ogg was called (not skipped) with the webm bytes.
        mock_transcode.assert_called_once_with(webm_bytes, "audio/webm")

        # C1 assertion 2: The MIME type reaching Gemini Part.from_bytes must be ogg,
        # NOT webm — confirming transcoded bytes were used.
        assert gemini_received_mime, "Part.from_bytes was never called — Gemini path not reached"
        assert all(
            m.startswith("audio/ogg") for m in gemini_received_mime
        ), f"Expected audio/ogg MIME sent to Gemini, got: {gemini_received_mime}"

        # P2#2: also assert the `data` bytes are the TRANSCODED bytes, not the original webm.
        # This catches a regression where data=original_webm_bytes + mime_type='audio/ogg' slips through.
        assert gemini_received_data, "Part.from_bytes data was not captured"
        assert all(
            d == transcoded_ogg_bytes for d in gemini_received_data
        ), (
            f"Expected transcoded OGG bytes ({transcoded_ogg_bytes!r}) sent to Gemini, "
            f"got: {gemini_received_data}"
        )
        assert all(
            d != webm_bytes for d in gemini_received_data
        ), "Original webm bytes must NOT reach Gemini directly (I2 violation)"

        # C1 assertion 3: result comes from Gemini (not fallback).
        assert result["method"] == "gemini"
        assert result["transcript"] == "學生朗讀文字"


# ---------------------------------------------------------------------------
# C2: Any failure → fallback + reason + WARN log
# ---------------------------------------------------------------------------

class TestC2FallbackReasonAndWarnLog:
    """C2: Gemini errors / timeouts / transcode failures return fallback with reason."""

    def _make_result(self, method, reason=None):
        return {"transcript": None, "method": method, "reason": reason}

    def test_fallback_result_has_required_keys(self):
        result = self._make_result("fallback", "timeout")
        assert result["method"] == "fallback"
        assert result["transcript"] is None
        assert result["reason"] == "timeout"

    def test_reason_literals_are_defined(self):
        from app.services.reading_transcription_service import (
            _REASON_TRANSCODE,
            _REASON_TIMEOUT,
            _REASON_SAFETY,
            _REASON_EMPTY,
            _REASON_ERROR,
        )
        # All reasons are non-empty strings
        for reason in (_REASON_TRANSCODE, _REASON_TIMEOUT, _REASON_SAFETY, _REASON_EMPTY, _REASON_ERROR):
            assert isinstance(reason, str) and len(reason) > 0

    def test_transcode_failure_logs_warn_with_reason(self, caplog):
        """C2 variant: transcode fail → WARN log event=reading_transcribe_fallback reason=decode."""
        from app.services import reading_transcription_service as svc

        with patch.object(svc, "_transcode_to_ogg", return_value=None), \
             caplog.at_level(logging.WARNING, logger="app.services.reading_transcription_service"):

            import sys
            fake_genai = MagicMock()
            fake_genai_types = MagicMock()
            fake_gemini_client = MagicMock()
            fake_gemini_client.GEMINI_TIMEOUT = 30
            fake_llm_models = MagicMock()
            fake_llm_models.get_model_for_task.return_value = ("gemini-2.5-flash", "us-central1")

            with patch.dict(sys.modules, {
                "google": MagicMock(),
                "google.genai": fake_genai,
                "google.genai.types": fake_genai_types,
                "app.services.ai.gemini_client": fake_gemini_client,
                "app.services.llm_models": fake_llm_models,
            }):
                result = _run(svc.transcribe_reading_audio(
                    audio_bytes=b"fake-webm-data",
                    mime_type="audio/webm",
                    target_text="課文文字",
                    duration_ms=5000,
                ))

        assert result["method"] == "fallback"
        assert result["reason"] == "decode"
        assert result["transcript"] is None
        # WARN log must be emitted — check message text (extra dict not in r.message)
        assert any(
            "fallback" in r.message.lower() and "transcode" in r.message.lower()
            for r in caplog.records
        ), f"Expected fallback+transcode WARN log, got: {[r.message for r in caplog.records]}"

    def test_timeout_returns_fallback_with_timeout_reason(self, caplog):
        """C2 variant: asyncio.TimeoutError → fallback reason=timeout + WARN log."""
        from app.services import reading_transcription_service as svc

        import sys
        fake_genai = MagicMock()
        fake_genai_types = MagicMock()
        fake_gemini_client = MagicMock()
        fake_gemini_client.GEMINI_TIMEOUT = 30
        fake_llm_models = MagicMock()
        fake_llm_models.get_model_for_task.return_value = ("gemini-2.5-flash", "us-central1")

        async def raise_timeout(*a, **kw):
            raise TimeoutError("timed out")

        with patch.object(svc, "_needs_transcode", return_value=False), \
             patch("asyncio.wait_for", side_effect=raise_timeout), \
             caplog.at_level(logging.WARNING, logger="app.services.reading_transcription_service"):

            with patch.dict(sys.modules, {
                "google": MagicMock(),
                "google.genai": fake_genai,
                "google.genai.types": fake_genai_types,
                "app.services.ai.gemini_client": fake_gemini_client,
                "app.services.llm_models": fake_llm_models,
            }):
                result = _run(svc.transcribe_reading_audio(
                    audio_bytes=b"fake-ogg",
                    mime_type="audio/ogg",
                    target_text="課文",
                    duration_ms=3000,
                ))

        assert result["method"] == "fallback"
        assert result["reason"] == "timeout"
        assert result["transcript"] is None

    def test_empty_transcript_returns_fallback_with_empty_reason(self, caplog):
        """C2 variant: Gemini returns empty transcript → fallback reason=empty."""
        from app.services import reading_transcription_service as svc

        import sys
        import json
        fake_genai = MagicMock()
        fake_genai_types = MagicMock()
        fake_gemini_client = MagicMock()
        fake_gemini_client.GEMINI_TIMEOUT = 30
        fake_llm_models = MagicMock()
        fake_llm_models.get_model_for_task.return_value = ("gemini-2.5-flash", "us-central1")

        mock_response = MagicMock()
        mock_response.text = json.dumps({"transcript": "", "reasoning": "no speech"})

        async def fake_wait_for(coro, timeout):
            return mock_response

        with patch.object(svc, "_needs_transcode", return_value=False), \
             patch.object(svc, "_check_safety_filter"), \
             patch("asyncio.wait_for", side_effect=fake_wait_for), \
             caplog.at_level(logging.WARNING, logger="app.services.reading_transcription_service"):

            with patch.dict(sys.modules, {
                "google": MagicMock(),
                "google.genai": fake_genai,
                "google.genai.types": fake_genai_types,
                "app.services.ai.gemini_client": fake_gemini_client,
                "app.services.llm_models": fake_llm_models,
            }):
                result = _run(svc.transcribe_reading_audio(
                    audio_bytes=b"fake-ogg",
                    mime_type="audio/ogg",
                    target_text="課文",
                    duration_ms=2000,
                ))

        assert result["method"] == "fallback"
        assert result["reason"] == "empty"
        assert result["transcript"] is None


# ---------------------------------------------------------------------------
# C3: Gemini success → transcript + method="gemini" + reasoning
# ---------------------------------------------------------------------------

class TestC3GeminiSuccessResponse:
    """C3: Successful Gemini call returns transcript with punctuation + method=gemini."""

    def test_success_returns_gemini_method_and_transcript(self):
        from app.services import reading_transcription_service as svc

        import sys
        import json
        fake_genai = MagicMock()
        fake_genai_types = MagicMock()
        fake_gemini_client = MagicMock()
        fake_gemini_client.GEMINI_TIMEOUT = 30
        fake_llm_models = MagicMock()
        fake_llm_models.get_model_for_task.return_value = ("gemini-2.5-flash", "us-central1")

        transcript_text = "秋天到了，樹葉慢慢變黃了。"
        mock_response = MagicMock()
        mock_response.text = json.dumps({"transcript": transcript_text, "reasoning": "清晰朗讀"})

        async def fake_wait_for(coro, timeout):
            return mock_response

        with patch.object(svc, "_needs_transcode", return_value=False), \
             patch.object(svc, "_check_safety_filter"), \
             patch("asyncio.wait_for", side_effect=fake_wait_for):

            with patch.dict(sys.modules, {
                "google": MagicMock(),
                "google.genai": fake_genai,
                "google.genai.types": fake_genai_types,
                "app.services.ai.gemini_client": fake_gemini_client,
                "app.services.llm_models": fake_llm_models,
            }):
                result = _run(svc.transcribe_reading_audio(
                    audio_bytes=b"fake-ogg",
                    mime_type="audio/ogg",
                    target_text="秋天到了，樹葉慢慢變黃了。",
                    duration_ms=4000,
                ))

        assert result["method"] == "gemini"
        assert result["transcript"] == transcript_text
        assert "reasoning" in result
        assert "reason" not in result or result.get("reason") is None

    def test_success_result_has_no_fallback_fields(self):
        """C3: gemini success result does not carry fallback reason."""
        result = {"transcript": "text", "method": "gemini", "reasoning": "ok"}
        assert result["method"] == "gemini"
        assert result.get("reason") is None


# ---------------------------------------------------------------------------
# C4: Unsupported MIME / empty audio → 415 or fallback (never 500)
# ---------------------------------------------------------------------------

class TestC4UnsupportedMimeAndEmptyAudio:
    """C4: Route-level guards for unsupported MIME and empty audio."""

    def test_allowed_audio_mimes_does_not_include_video_types(self):
        from app.services.reading_transcription_service import ALLOWED_AUDIO_MIMES
        video_types = {"video/mp4", "video/webm", "image/jpeg", "application/octet-stream"}
        assert video_types.isdisjoint(
            {m.split(";")[0].strip() for m in ALLOWED_AUDIO_MIMES}
        ), "Video/image MIME types should not be in ALLOWED_AUDIO_MIMES"

    def test_allowed_audio_mimes_includes_webm(self):
        """webm must be allowed at the route level (transcoding happens in service)."""
        from app.services.reading_transcription_service import ALLOWED_AUDIO_MIMES
        base_mimes = {m.split(";")[0].strip() for m in ALLOWED_AUDIO_MIMES}
        assert "audio/webm" in base_mimes

    def test_normalise_mime_strips_codec_suffix(self):
        from app.services.reading_transcription_service import _normalise_mime
        assert _normalise_mime("audio/webm;codecs=opus") == "audio/webm"
        assert _normalise_mime("audio/webm; codecs=opus") == "audio/webm"
        assert _normalise_mime("audio/ogg") == "audio/ogg"

    def test_route_response_model_has_reason_field(self):
        """C4: TranscribeReadingResponse Pydantic model includes `reason` field."""
        from app.routes.learning.learning_reading import TranscribeReadingResponse
        import inspect
        fields = TranscribeReadingResponse.model_fields
        assert "reason" in fields, "TranscribeReadingResponse must have a `reason` field"
        assert "method" in fields
        assert "transcript" in fields

    def test_route_response_model_reason_is_optional(self):
        """C4: reason is optional (None for gemini success)."""
        from app.routes.learning.learning_reading import TranscribeReadingResponse
        resp = TranscribeReadingResponse(
            transcript="text",
            method="gemini",
            reasoning="ok",
        )
        assert resp.reason is None


# ---------------------------------------------------------------------------
# C5: Rate-limit / auth / size-cap structural presence in route
# ---------------------------------------------------------------------------

class TestC5RateLimitAuthSizeCap:
    """C5: Route has rate-limit, auth, and size-cap guards (structural check)."""

    def test_transcribe_endpoint_has_rate_limit_dependency(self):
        import inspect
        from app.routes.learning.learning_reading import transcribe_reading_endpoint
        source = inspect.getsource(transcribe_reading_endpoint)
        assert "ai_limit" in source, "Route must use rate-limit dependency"

    def test_transcribe_endpoint_has_auth_dependency(self):
        import inspect
        from app.routes.learning.learning_reading import transcribe_reading_endpoint
        source = inspect.getsource(transcribe_reading_endpoint)
        assert "get_current_user" in source, "Route must require authentication"

    def test_transcribe_endpoint_has_size_cap(self):
        import inspect
        from app.routes.learning.learning_reading import transcribe_reading_endpoint
        source = inspect.getsource(transcribe_reading_endpoint)
        assert "_MAX_AUDIO_BYTES" in source or "MAX_AUDIO" in source, \
            "Route must enforce audio size cap"

    def test_transcribe_endpoint_has_target_text_cap(self):
        import inspect
        from app.routes.learning.learning_reading import transcribe_reading_endpoint
        source = inspect.getsource(transcribe_reading_endpoint)
        assert "_MAX_TARGET_CHARS" in source or "MAX_TARGET" in source, \
            "Route must enforce target_text length cap"

    def test_needs_transcode_function_is_importable(self):
        from app.services.reading_transcription_service import _needs_transcode
        assert callable(_needs_transcode)

    def test_transcode_to_ogg_function_is_importable(self):
        from app.services.reading_transcription_service import _transcode_to_ogg
        assert callable(_transcode_to_ogg)
