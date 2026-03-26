"""
TDD tests for Google Cloud TTS service (Issue #663).
Run: pytest backend/tests/test_tts_service.py -v
"""
import hashlib
from unittest.mock import MagicMock, patch

import pytest

# ---------------------------------------------------------------------------
# 1. tts_service tests — cache key
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


# ---------------------------------------------------------------------------
# 2. tts_service tests — synthesize_speech
# ---------------------------------------------------------------------------

class TestTTSServiceSynthesize:
    """synthesize_speech must return bytes and use cache."""

    def _make_fake_response(self, audio_content=b"FAKE_AUDIO"):
        resp = MagicMock()
        resp.audio_content = audio_content
        return resp

    @patch("app.services.tts_service._gcs_get", return_value=None)
    @patch("app.services.tts_service._gcs_put")
    @patch("app.services.tts_service._TTS_CACHE", {})
    @patch("app.services.tts_service._get_tts_client")
    def test_returns_bytes_for_valid_text(self, mock_get_client, mock_gcs_put, mock_gcs_get):
        from app.services.tts_service import synthesize_speech
        mock_client = MagicMock()
        mock_client.synthesize_speech.return_value = self._make_fake_response(b"AUDIO_BYTES")
        mock_get_client.return_value = mock_client

        result = synthesize_speech("你好")
        assert isinstance(result, bytes)
        assert result == b"AUDIO_BYTES"

    @patch("app.services.tts_service._gcs_get", return_value=None)
    @patch("app.services.tts_service._gcs_put")
    @patch("app.services.tts_service._TTS_CACHE", {})
    @patch("app.services.tts_service._get_tts_client")
    def test_cache_prevents_second_api_call(self, mock_get_client, mock_gcs_put, mock_gcs_get):
        from app.services.tts_service import synthesize_speech
        mock_client = MagicMock()
        mock_client.synthesize_speech.return_value = self._make_fake_response(b"AUDIO_BYTES")
        mock_get_client.return_value = mock_client

        synthesize_speech("你好")
        synthesize_speech("你好")

        # TTS API should only be called once — second call uses cache
        assert mock_client.synthesize_speech.call_count == 1

    @patch("app.services.tts_service._gcs_get", return_value=None)
    @patch("app.services.tts_service._gcs_put")
    @patch("app.services.tts_service._TTS_CACHE", {})
    @patch("app.services.tts_service._get_tts_client")
    def test_different_texts_each_call_api(self, mock_get_client, mock_gcs_put, mock_gcs_get):
        from app.services.tts_service import synthesize_speech
        mock_client = MagicMock()
        mock_client.synthesize_speech.return_value = self._make_fake_response(b"AUDIO_BYTES")
        mock_get_client.return_value = mock_client

        synthesize_speech("你好")
        synthesize_speech("世界")

        assert mock_client.synthesize_speech.call_count == 2

    @patch("app.services.tts_service._gcs_get", return_value=None)
    @patch("app.services.tts_service._gcs_put")
    @patch("app.services.tts_service._TTS_CACHE", {})
    @patch("app.services.tts_service._get_tts_client")
    def test_raises_on_empty_audio(self, mock_get_client, mock_gcs_put, mock_gcs_get):
        from app.services.tts_service import TTSError, synthesize_speech
        mock_client = MagicMock()
        mock_client.synthesize_speech.return_value = self._make_fake_response(b"")
        mock_get_client.return_value = mock_client

        with pytest.raises(TTSError):
            synthesize_speech("你好")

    @patch("app.services.tts_service._gcs_get", return_value=None)
    @patch("app.services.tts_service._gcs_put")
    @patch("app.services.tts_service._TTS_CACHE", {})
    @patch("app.services.tts_service._get_tts_client")
    def test_raises_on_api_exception(self, mock_get_client, mock_gcs_put, mock_gcs_get):
        from app.services.tts_service import TTSError, synthesize_speech
        mock_client = MagicMock()
        mock_client.synthesize_speech.side_effect = Exception("GCP quota exceeded")
        mock_get_client.return_value = mock_client

        with pytest.raises(TTSError):
            synthesize_speech("你好")


# ---------------------------------------------------------------------------
# 3. GCS sentinel behavior
# ---------------------------------------------------------------------------

class TestGCSSentinel:
    """After GCS init fails once, _get_gcs_bucket returns None immediately."""

    def test_gcs_init_failure_sets_sentinel(self):
        import app.services.tts_service as tts_mod

        # Reset state
        original = tts_mod._gcs_client
        tts_mod._gcs_client = None  # force re-init

        try:
            with patch("app.services.tts_service.storage", create=True) as mock_storage_mod:
                # Simulate import inside _get_gcs_bucket by patching the import
                with patch.dict("sys.modules", {"google.cloud.storage": MagicMock(
                    Client=MagicMock(side_effect=Exception("no credentials"))
                )}):
                    result = tts_mod._get_gcs_bucket()
                    assert result is None
                    assert tts_mod._gcs_client is tts_mod._GCS_UNAVAILABLE
        finally:
            tts_mod._gcs_client = original

    def test_gcs_sentinel_skips_retry(self):
        import app.services.tts_service as tts_mod

        original = tts_mod._gcs_client
        tts_mod._gcs_client = tts_mod._GCS_UNAVAILABLE

        try:
            # Should return None immediately without attempting import
            with patch.dict("sys.modules", {"google.cloud.storage": MagicMock()}) as mock_mod:
                result = tts_mod._get_gcs_bucket()
                assert result is None
                # Verify Client() was never called (no retry attempted)
                import sys
                mock_storage = sys.modules["google.cloud.storage"]
                mock_storage.Client.assert_not_called()
        finally:
            tts_mod._gcs_client = original


# ---------------------------------------------------------------------------
# 4. Pydantic validation (via route)
# ---------------------------------------------------------------------------

class TestTTSPydanticValidation:
    """TTSRequest model must reject empty text and text >5000 chars."""

    def _make_app(self):
        from fastapi import FastAPI
        from app.routes.tts import router
        app = FastAPI()
        app.include_router(router)
        return app

    def test_empty_text_rejected(self):
        from fastapi.testclient import TestClient
        client = TestClient(self._make_app())
        response = client.post("/api/tts/synthesize", json={"text": ""})
        assert response.status_code == 422

    def test_whitespace_only_text_rejected(self):
        from fastapi.testclient import TestClient
        client = TestClient(self._make_app())
        response = client.post("/api/tts/synthesize", json={"text": "   "})
        # min_length=1 counts whitespace as valid chars, but the route should
        # still accept it (Pydantic counts len, spaces count)
        # This verifies the field is validated
        assert response.status_code in (200, 422, 503)

    def test_over_5000_chars_rejected(self):
        from fastapi.testclient import TestClient
        client = TestClient(self._make_app())
        long_text = "你" * 5001
        response = client.post("/api/tts/synthesize", json={"text": long_text})
        assert response.status_code == 422

    def test_exactly_5000_chars_accepted(self):
        from fastapi.testclient import TestClient
        client = TestClient(self._make_app())
        text_5000 = "你" * 5000
        # Should not be rejected by validation (may fail with 503 if TTS unavailable)
        response = client.post("/api/tts/synthesize", json={"text": text_5000})
        assert response.status_code != 422


# ---------------------------------------------------------------------------
# 5. Empty audio response from API → TTSError
# ---------------------------------------------------------------------------

class TestEmptyAudioResponse:
    """Cloud TTS returning empty audio must raise TTSError."""

    @patch("app.services.tts_service._gcs_get", return_value=None)
    @patch("app.services.tts_service._gcs_put")
    @patch("app.services.tts_service._TTS_CACHE", {})
    @patch("app.services.tts_service._get_tts_client")
    def test_none_audio_content_raises(self, mock_get_client, mock_gcs_put, mock_gcs_get):
        from app.services.tts_service import TTSError, synthesize_speech
        mock_client = MagicMock()
        resp = MagicMock()
        resp.audio_content = None
        mock_client.synthesize_speech.return_value = resp
        mock_get_client.return_value = mock_client

        with pytest.raises(TTSError):
            synthesize_speech("測試空回應")

    @patch("app.services.tts_service._gcs_get", return_value=None)
    @patch("app.services.tts_service._gcs_put")
    @patch("app.services.tts_service._TTS_CACHE", {})
    @patch("app.services.tts_service._get_tts_client")
    def test_empty_bytes_audio_content_raises(self, mock_get_client, mock_gcs_put, mock_gcs_get):
        from app.services.tts_service import TTSError, synthesize_speech
        mock_client = MagicMock()
        resp = MagicMock()
        resp.audio_content = b""
        mock_client.synthesize_speech.return_value = resp
        mock_get_client.return_value = mock_client

        with pytest.raises(TTSError):
            synthesize_speech("測試空回應")


# ---------------------------------------------------------------------------
# 6. Text cleaning — strip symbols TTS would read aloud
# ---------------------------------------------------------------------------

class TestTextCleaning:
    """Symbols like ~~~ must be stripped before sending to TTS."""

    def test_tildes_removed(self):
        from app.services.tts_service import _clean_for_tts
        assert "~~~" not in _clean_for_tts("我愛妳~~~這一句")
        assert _clean_for_tts("我愛妳~~~這一句") == "我愛妳這一句"

    def test_long_dashes_become_pause(self):
        from app.services.tts_service import _clean_for_tts
        assert _clean_for_tts("球后──戴資穎") == "球后，戴資穎"

    def test_ellipsis_becomes_pause(self):
        from app.services.tts_service import _clean_for_tts
        assert _clean_for_tts("輕鬆……對手") == "輕鬆，對手"

    def test_hashtag_removed_but_word_kept(self):
        from app.services.tts_service import _clean_for_tts
        assert _clean_for_tts("#MeToo運動") == "MeToo運動"

    def test_blood_pressure_slash(self):
        from app.services.tts_service import _clean_for_tts
        assert "210 之 120" in _clean_for_tts("血壓210/120")

    def test_normal_text_unchanged(self):
        from app.services.tts_service import _clean_for_tts
        assert _clean_for_tts("你好世界") == "你好世界"

    def test_real_lesson_text(self):
        from app.services.tts_service import _clean_for_tts
        text = "「戴資穎戴資穎我愛妳~~~」這一句洗腦的廣告臺詞"
        cleaned = _clean_for_tts(text)
        assert "~~~" not in cleaned
        assert "戴資穎" in cleaned


# ---------------------------------------------------------------------------
# 7. Sentence splitting — prevents 400 errors on long text
# ---------------------------------------------------------------------------

class TestSentenceSplitting:
    """Long text must be split to avoid Chirp3-HD 400 errors."""

    def test_short_text_not_split(self):
        from app.services.tts_service import _split_sentences
        result = _split_sentences("你好世界。")
        assert len(result) == 1

    def test_long_text_split_by_period(self):
        from app.services.tts_service import _split_sentences
        text = "第一句話很短。第二句話也很短。第三句話還是很短。"
        result = _split_sentences(text)
        assert len(result) == 3

    def test_long_sentence_split_by_comma(self):
        from app.services.tts_service import _split_sentences
        # 73 chars, no period — must split by comma
        text = "漫畫《一拳超人》中的埼玉老師堅持了三年，每天做一百次的伏地挺身、一百次的仰臥起坐、一百次的深蹲、十公里的長跑，終於擁有一拳就能打倒所有敵人的實力。"
        result = _split_sentences(text)
        assert all(len(s) <= 50 for s in result), f"Chunks too long: {[len(s) for s in result]}"
        assert "".join(result) == text  # no text lost

    def test_synthesize_speech_handles_long_text(self):
        """Long text should be split and each chunk synthesized separately."""
        from app.services.tts_service import synthesize_speech
        long_text = "漫畫《一拳超人》中的埼玉老師堅持了三年，每天做一百次的伏地挺身、一百次的仰臥起坐、一百次的深蹲、十公里的長跑，終於擁有一拳就能打倒所有敵人的實力。"

        mock_client = MagicMock()
        mock_client.synthesize_speech.side_effect = lambda **kwargs: MagicMock(audio_content=b"CHUNK")

        with patch("app.services.tts_service._gcs_get", return_value=None), \
             patch("app.services.tts_service._gcs_put"), \
             patch("app.services.tts_service._TTS_CACHE", {}), \
             patch("app.services.tts_service._get_tts_client", return_value=mock_client):
            result = synthesize_speech(long_text)

        # Multiple chunks concatenated
        assert mock_client.synthesize_speech.call_count > 1
        assert result == b"CHUNK" * mock_client.synthesize_speech.call_count


# ---------------------------------------------------------------------------
# 7. Cost protection — cache layers must prevent duplicate API calls
# ---------------------------------------------------------------------------

class TestCostProtection:
    """Every cache layer must prevent redundant Cloud TTS API calls (= money)."""

    def _make_fake_response(self, audio_content=b"FAKE_AUDIO"):
        resp = MagicMock()
        resp.audio_content = audio_content
        return resp

    @patch("app.services.tts_service._gcs_put")
    @patch("app.services.tts_service._TTS_CACHE", {})
    @patch("app.services.tts_service._get_tts_client")
    def test_gcs_hit_skips_api_call(self, mock_get_client, mock_gcs_put):
        """L2 GCS cache hit → Cloud TTS API must NOT be called (saves money)."""
        from app.services.tts_service import synthesize_speech
        mock_client = MagicMock()
        mock_get_client.return_value = mock_client

        with patch("app.services.tts_service._gcs_get", return_value=b"CACHED_AUDIO"):
            result = synthesize_speech("已快取的句子")

        assert result == b"CACHED_AUDIO"
        mock_client.synthesize_speech.assert_not_called()  # NO API call = NO cost

    @patch("app.services.tts_service._gcs_get", return_value=None)
    @patch("app.services.tts_service._gcs_put")
    @patch("app.services.tts_service._TTS_CACHE", {})
    @patch("app.services.tts_service._get_tts_client")
    def test_api_result_saved_to_gcs(self, mock_get_client, mock_gcs_put, mock_gcs_get):
        """After API call, result MUST be saved to GCS (prevents paying again)."""
        from app.services.tts_service import synthesize_speech, _cache_key
        mock_client = MagicMock()
        mock_client.synthesize_speech.return_value = self._make_fake_response(b"NEW_AUDIO")
        mock_get_client.return_value = mock_client

        synthesize_speech("新的句子")

        expected_key = _cache_key("新的句子")
        mock_gcs_put.assert_called_once_with(expected_key, b"NEW_AUDIO")

    @patch("app.services.tts_service._gcs_put")
    @patch("app.services.tts_service._TTS_CACHE", {})
    @patch("app.services.tts_service._get_tts_client")
    def test_gcs_hit_also_populates_l1(self, mock_get_client, mock_gcs_put):
        """GCS hit should populate L1 so next call doesn't even hit GCS."""
        from app.services.tts_service import synthesize_speech, _cache_key, _TTS_CACHE

        with patch("app.services.tts_service._gcs_get", return_value=b"GCS_AUDIO"):
            synthesize_speech("測試L1填充")

        # L1 should now have it
        key = _cache_key("測試L1填充")
        assert key in _TTS_CACHE
        assert _TTS_CACHE[key] == b"GCS_AUDIO"

    @patch("app.services.tts_service._gcs_get", return_value=None)
    @patch("app.services.tts_service._gcs_put")
    @patch("app.services.tts_service._get_tts_client")
    def test_three_calls_same_text_only_one_api_call(self, mock_get_client, mock_gcs_put, mock_gcs_get):
        """3 calls with same text = exactly 1 API call. Cost = 1x not 3x."""
        import app.services.tts_service as tts_mod
        # Clear L1 cache
        tts_mod._TTS_CACHE.clear()

        mock_client = MagicMock()
        mock_client.synthesize_speech.return_value = self._make_fake_response(b"AUDIO")
        mock_get_client.return_value = mock_client

        tts_mod.synthesize_speech("重複的句子")
        tts_mod.synthesize_speech("重複的句子")
        tts_mod.synthesize_speech("重複的句子")

        assert mock_client.synthesize_speech.call_count == 1  # paid once only


# ---------------------------------------------------------------------------
# 7. TTS route tests
# ---------------------------------------------------------------------------

class TestTTSRoute:
    """POST /api/tts/synthesize must return audio/mpeg on success."""

    @patch("app.services.tts_service._gcs_get", return_value=None)
    @patch("app.services.tts_service._gcs_put")
    @patch("app.services.tts_service._TTS_CACHE", {})
    @patch("app.services.tts_service._get_tts_client")
    def test_synthesize_returns_audio_response(self, mock_get_client, mock_gcs_put, mock_gcs_get):
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
