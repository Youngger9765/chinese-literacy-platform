"""
TDD tests for Google Cloud TTS service (Issue #663).
Run: pytest backend/tests/test_tts_service.py -v
"""
import hashlib
from unittest.mock import MagicMock, patch

import pytest

# ---------------------------------------------------------------------------
# 1. tts_service tests
# ---------------------------------------------------------------------------

class TestTTSServiceCacheKey:
    """Cache key derivation must be deterministic."""

    def test_same_text_gives_same_key(self):
        from app.services.tts_service import _cache_key
        assert _cache_key("你好世界") == _cache_key("你好世界")

    def test_different_text_gives_different_key(self):
        from app.services.tts_service import _cache_key
        assert _cache_key("你好") != _cache_key("世界")

    def test_key_is_hex_string(self):
        from app.services.tts_service import _cache_key
        key = _cache_key("測試")
        assert isinstance(key, str)
        int(key, 16)  # must be valid hex

    def test_empty_string_has_stable_key(self):
        from app.services.tts_service import _cache_key
        key = _cache_key("")
        assert isinstance(key, str)
        assert len(key) > 0


class TestTTSServiceSynthesize:
    """synthesize_speech must return bytes and use cache."""

    def _make_fake_response(self, audio_content=b"FAKE_AUDIO"):
        resp = MagicMock()
        resp.audio_content = audio_content
        return resp

    @patch("app.services.tts_service._TTS_CACHE", {})
    @patch("app.services.tts_service._get_tts_client")
    def test_returns_bytes_for_valid_text(self, mock_get_client):
        from app.services.tts_service import synthesize_speech
        mock_client = MagicMock()
        mock_client.synthesize_speech.return_value = self._make_fake_response(b"AUDIO_BYTES")
        mock_get_client.return_value = mock_client

        result = synthesize_speech("你好")
        assert isinstance(result, bytes)
        assert result == b"AUDIO_BYTES"

    @patch("app.services.tts_service._TTS_CACHE", {})
    @patch("app.services.tts_service._get_tts_client")
    def test_cache_prevents_second_api_call(self, mock_get_client):
        from app.services.tts_service import synthesize_speech
        mock_client = MagicMock()
        mock_client.synthesize_speech.return_value = self._make_fake_response(b"AUDIO_BYTES")
        mock_get_client.return_value = mock_client

        synthesize_speech("你好")
        synthesize_speech("你好")

        # TTS API should only be called once — second call uses cache
        assert mock_client.synthesize_speech.call_count == 1

    @patch("app.services.tts_service._TTS_CACHE", {})
    @patch("app.services.tts_service._get_tts_client")
    def test_different_texts_each_call_api(self, mock_get_client):
        from app.services.tts_service import synthesize_speech
        mock_client = MagicMock()
        mock_client.synthesize_speech.return_value = self._make_fake_response(b"AUDIO_BYTES")
        mock_get_client.return_value = mock_client

        synthesize_speech("你好")
        synthesize_speech("世界")

        assert mock_client.synthesize_speech.call_count == 2

    @patch("app.services.tts_service._TTS_CACHE", {})
    @patch("app.services.tts_service._get_tts_client")
    def test_raises_on_empty_audio(self, mock_get_client):
        from app.services.tts_service import TTSError, synthesize_speech
        mock_client = MagicMock()
        mock_client.synthesize_speech.return_value = self._make_fake_response(b"")
        mock_get_client.return_value = mock_client

        with pytest.raises(TTSError):
            synthesize_speech("你好")

    @patch("app.services.tts_service._TTS_CACHE", {})
    @patch("app.services.tts_service._get_tts_client")
    def test_raises_on_api_exception(self, mock_get_client):
        from app.services.tts_service import TTSError, synthesize_speech
        mock_client = MagicMock()
        mock_client.synthesize_speech.side_effect = Exception("GCP quota exceeded")
        mock_get_client.return_value = mock_client

        with pytest.raises(TTSError):
            synthesize_speech("你好")


# ---------------------------------------------------------------------------
# 2. TTS route tests
# ---------------------------------------------------------------------------

class TestTTSRoute:
    """POST /api/tts/synthesize must return audio/mpeg on success."""

    @patch("app.services.tts_service._TTS_CACHE", {})
    @patch("app.services.tts_service._get_tts_client")
    def test_synthesize_returns_audio_response(self, mock_get_client):
        from fastapi.testclient import TestClient
        from app.routes.tts import router
        from fastapi import FastAPI
        app = FastAPI()
        app.include_router(router)

        mock_client = MagicMock()
        resp = MagicMock()
        resp.audio_content = b"FAKEAUDIO"
        mock_client.synthesize_speech.return_value = resp
        mock_get_client.return_value = mock_client

        client = TestClient(app)
        response = client.post("/api/tts/synthesize", json={"text": "你好世界"})
        assert response.status_code == 200
        assert response.headers["content-type"].startswith("audio/")

    def test_synthesize_rejects_empty_text(self):
        from fastapi.testclient import TestClient
        from app.routes.tts import router
        from fastapi import FastAPI
        app = FastAPI()
        app.include_router(router)

        client = TestClient(app)
        response = client.post("/api/tts/synthesize", json={"text": ""})
        assert response.status_code == 422  # validation error

    def test_synthesize_rejects_too_long_text(self):
        from fastapi.testclient import TestClient
        from app.routes.tts import router
        from fastapi import FastAPI
        app = FastAPI()
        app.include_router(router)

        client = TestClient(app)
        long_text = "你" * 5001
        response = client.post("/api/tts/synthesize", json={"text": long_text})
        assert response.status_code == 422
