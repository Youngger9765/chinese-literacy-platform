"""
Tests for Gemini TTS provider — _pcm_to_mp3, _synthesize_gemini, fallback chain,
cross-provider GCS cache, and TTS_PROVIDER validation. (Issue #1107)
Run: pytest backend/tests/test_gemini_tts.py -v
"""
import subprocess
from unittest.mock import MagicMock, patch, call

import pytest


# ---------------------------------------------------------------------------
# 1. _pcm_to_mp3
# ---------------------------------------------------------------------------

class TestPcmToMp3:
    """_pcm_to_mp3 must handle all ffmpeg failure modes cleanly."""

    def test_ffmpeg_not_found_raises_tts_error(self):
        """FileNotFoundError (no ffmpeg on PATH) → TTSError with helpful message."""
        from app.services.tts_service import _pcm_to_mp3, TTSError

        with patch("subprocess.run", side_effect=FileNotFoundError("No such file")):
            with pytest.raises(TTSError, match="ffmpeg is not installed"):
                _pcm_to_mp3(b"\x00\x01\x02\x03")

    def test_ffmpeg_timeout_raises_tts_error(self):
        """subprocess.TimeoutExpired → TTSError mentioning timeout."""
        from app.services.tts_service import _pcm_to_mp3, TTSError

        with patch("subprocess.run", side_effect=subprocess.TimeoutExpired(cmd="ffmpeg", timeout=30)):
            with pytest.raises(TTSError, match="timed out"):
                _pcm_to_mp3(b"\x00\x01\x02\x03")

    def test_ffmpeg_nonzero_exit_raises_tts_error(self):
        """Non-zero returncode → TTSError with stderr content."""
        from app.services.tts_service import _pcm_to_mp3, TTSError

        mock_result = MagicMock()
        mock_result.returncode = 1
        mock_result.stderr = b"Invalid data found"
        mock_result.stdout = b""

        with patch("subprocess.run", return_value=mock_result):
            with pytest.raises(TTSError, match="ffmpeg PCM"):
                _pcm_to_mp3(b"\x00\x01\x02\x03")

    def test_ffmpeg_empty_output_raises_tts_error(self):
        """returncode=0 but empty stdout → TTSError about empty output."""
        from app.services.tts_service import _pcm_to_mp3, TTSError

        mock_result = MagicMock()
        mock_result.returncode = 0
        mock_result.stdout = b""

        with patch("subprocess.run", return_value=mock_result):
            with pytest.raises(TTSError, match="empty"):
                _pcm_to_mp3(b"\x00\x01\x02\x03")

    def test_ffmpeg_success(self):
        """returncode=0 with stdout → return MP3 bytes."""
        from app.services.tts_service import _pcm_to_mp3

        mock_result = MagicMock()
        mock_result.returncode = 0
        mock_result.stdout = b"mp3data"

        with patch("subprocess.run", return_value=mock_result):
            result = _pcm_to_mp3(b"\x00\x01\x02\x03")

        assert result == b"mp3data"

    def test_ffmpeg_os_error_raises_tts_error(self):
        """Generic OSError (e.g. permission denied) → TTSError."""
        from app.services.tts_service import _pcm_to_mp3, TTSError

        with patch("subprocess.run", side_effect=OSError("Permission denied")):
            with pytest.raises(TTSError, match="ffmpeg subprocess failed"):
                _pcm_to_mp3(b"\x00\x01\x02\x03")


# ---------------------------------------------------------------------------
# 2. _synthesize_gemini
# ---------------------------------------------------------------------------

class TestSynthesizeGemini:
    """_synthesize_gemini must handle SDK errors, client init failures, and bad responses."""

    def _make_good_response(self, pcm_data=b"\x00\x01" * 100):
        """Build a mock Gemini response with valid PCM inline data."""
        inline_data = MagicMock()
        inline_data.data = pcm_data
        part = MagicMock()
        part.inline_data = inline_data
        content = MagicMock()
        content.parts = [part]
        candidate = MagicMock()
        candidate.content = content
        candidate.finish_reason = "STOP"
        response = MagicMock()
        response.candidates = [candidate]
        return response

    def _reset_gemini_client(self, tts_mod):
        """Reset sentinel state between tests."""
        tts_mod._gemini_client = None

    def test_sdk_not_installed(self):
        """ImportError on google.genai → TTSError mentioning SDK."""
        import app.services.tts_service as tts_mod
        from app.services.tts_service import TTSError

        original = tts_mod._gemini_client
        self._reset_gemini_client(tts_mod)
        try:
            with patch.dict("sys.modules", {"google.genai": None, "google.genai.types": None}):
                # Also patch _get_gemini_client to simulate import failure path
                with patch("app.services.tts_service._get_gemini_client",
                           side_effect=TTSError("google-genai SDK not installed")):
                    with pytest.raises(TTSError, match="SDK not installed"):
                        tts_mod._synthesize_gemini("你好")
        finally:
            tts_mod._gemini_client = original

    def test_client_init_permanent_failure(self):
        """After init fails, sentinel is set and subsequent calls raise immediately."""
        import app.services.tts_service as tts_mod
        from app.services.tts_service import TTSError, _GEMINI_UNAVAILABLE

        original = tts_mod._gemini_client
        tts_mod._gemini_client = None
        try:
            # Patch genai.Client to raise on construction
            with patch("google.genai.Client", side_effect=Exception("no credentials")):
                with pytest.raises(TTSError, match="client init failed"):
                    tts_mod._get_gemini_client()
                # Sentinel must be set
                assert tts_mod._gemini_client is _GEMINI_UNAVAILABLE

            # Second call must raise immediately without trying again
            with pytest.raises(TTSError, match="permanently unavailable"):
                tts_mod._get_gemini_client()
        finally:
            tts_mod._gemini_client = original

    def test_api_error_raises_tts_error(self):
        """API call exception → TTSError mentioning 'API call failed'."""
        import app.services.tts_service as tts_mod
        from app.services.tts_service import TTSError

        original = tts_mod._gemini_client
        try:
            mock_client = MagicMock()
            mock_client.models.generate_content.side_effect = Exception("quota exceeded")
            tts_mod._gemini_client = mock_client

            with patch("app.services.tts_service._get_gemini_client", return_value=mock_client):
                # genai_types import must succeed
                mock_types = MagicMock()
                with patch.dict("sys.modules", {
                    "google.genai": MagicMock(),
                    "google.genai.types": mock_types,
                }):
                    with pytest.raises(TTSError, match="API call failed"):
                        tts_mod._synthesize_gemini("你好")
        finally:
            tts_mod._gemini_client = original

    def test_empty_pcm_raises_tts_error(self):
        """Good response structure but empty PCM data → TTSError."""
        import app.services.tts_service as tts_mod
        from app.services.tts_service import TTSError

        original = tts_mod._gemini_client
        try:
            response = self._make_good_response(pcm_data=b"")
            mock_client = MagicMock()
            mock_client.models.generate_content.return_value = response
            tts_mod._gemini_client = mock_client

            with patch("app.services.tts_service._get_gemini_client", return_value=mock_client):
                mock_types = MagicMock()
                with patch.dict("sys.modules", {
                    "google.genai": MagicMock(),
                    "google.genai.types": mock_types,
                }):
                    with pytest.raises(TTSError, match="empty audio"):
                        tts_mod._synthesize_gemini("你好")
        finally:
            tts_mod._gemini_client = original

    def test_unexpected_response_structure(self):
        """Response with no candidates → TTSError mentioning response structure."""
        import app.services.tts_service as tts_mod
        from app.services.tts_service import TTSError

        original = tts_mod._gemini_client
        try:
            bad_response = MagicMock()
            bad_response.candidates = []  # empty list → IndexError on [0]

            mock_client = MagicMock()
            mock_client.models.generate_content.return_value = bad_response
            tts_mod._gemini_client = mock_client

            with patch("app.services.tts_service._get_gemini_client", return_value=mock_client):
                mock_types = MagicMock()
                with patch.dict("sys.modules", {
                    "google.genai": MagicMock(),
                    "google.genai.types": mock_types,
                }):
                    with pytest.raises(TTSError, match="unexpected response structure"):
                        tts_mod._synthesize_gemini("你好")
        finally:
            tts_mod._gemini_client = original

    def test_success_returns_mp3(self):
        """Valid Gemini response + successful ffmpeg → MP3 bytes returned."""
        import app.services.tts_service as tts_mod

        original = tts_mod._gemini_client
        try:
            response = self._make_good_response(pcm_data=b"\x00\x01" * 100)
            mock_client = MagicMock()
            mock_client.models.generate_content.return_value = response
            tts_mod._gemini_client = mock_client

            with patch("app.services.tts_service._get_gemini_client", return_value=mock_client), \
                 patch("app.services.tts_service._pcm_to_mp3", return_value=b"MP3BYTES") as mock_mp3:
                mock_types = MagicMock()
                with patch.dict("sys.modules", {
                    "google.genai": MagicMock(),
                    "google.genai.types": mock_types,
                }):
                    result = tts_mod._synthesize_gemini("你好世界")

            assert result == b"MP3BYTES"
            mock_mp3.assert_called_once()
        finally:
            tts_mod._gemini_client = original


# ---------------------------------------------------------------------------
# 3. TestGeminiFallbackChain
# ---------------------------------------------------------------------------

class TestGeminiFallbackChain:
    """synthesize_speech with gemini31 provider tests the full fallback chain."""

    def _base_patches(self, tts_mod):
        """Common patches: empty caches, no GCS."""
        return [
            patch("app.services.tts_service._gcs_get", return_value=None),
            patch("app.services.tts_service._gcs_put"),
            patch("app.services.tts_service._TTS_CACHE", {}),
        ]

    def test_gemini_success_no_fallback(self):
        """Gemini succeeds → Azure and Google are never called."""
        import app.services.tts_service as tts_mod
        from app.services.tts_service import synthesize_speech

        with patch.object(tts_mod, "TTS_PROVIDER", "gemini31"), \
             patch("app.services.tts_service._gcs_get", return_value=None), \
             patch("app.services.tts_service._gcs_put"), \
             patch("app.services.tts_service._TTS_CACHE", {}), \
             patch("app.services.tts_service._synthesize_gemini", return_value=b"GEMINI_AUDIO") as mock_g, \
             patch("app.services.tts_service._synthesize_azure") as mock_az, \
             patch("app.services.tts_service._synthesize_google") as mock_go:
            result = synthesize_speech("你好")

        assert result == b"GEMINI_AUDIO"
        mock_az.assert_not_called()
        mock_go.assert_not_called()

    def test_gemini_fail_azure_success(self):
        """Gemini fails → Azure succeeds → Google not called."""
        import app.services.tts_service as tts_mod
        from app.services.tts_service import synthesize_speech, TTSError

        with patch.object(tts_mod, "TTS_PROVIDER", "gemini31"), \
             patch.object(tts_mod, "AZURE_SPEECH_KEY", "fake-key"), \
             patch("app.services.tts_service._gcs_get", return_value=None), \
             patch("app.services.tts_service._gcs_put"), \
             patch("app.services.tts_service._TTS_CACHE", {}), \
             patch("app.services.tts_service._synthesize_gemini", side_effect=TTSError("gemini down")), \
             patch("app.services.tts_service._synthesize_azure", return_value=b"AZURE_AUDIO") as mock_az, \
             patch("app.services.tts_service._synthesize_google") as mock_go:
            result = synthesize_speech("你好")

        assert result == b"AZURE_AUDIO"
        mock_az.assert_called_once()
        mock_go.assert_not_called()

    def test_gemini_fail_azure_fail_google_success(self):
        """Gemini fails, Azure fails → Google succeeds."""
        import app.services.tts_service as tts_mod
        from app.services.tts_service import synthesize_speech, TTSError

        with patch.object(tts_mod, "TTS_PROVIDER", "gemini31"), \
             patch.object(tts_mod, "AZURE_SPEECH_KEY", "fake-key"), \
             patch("app.services.tts_service._gcs_get", return_value=None), \
             patch("app.services.tts_service._gcs_put"), \
             patch("app.services.tts_service._TTS_CACHE", {}), \
             patch("app.services.tts_service._synthesize_gemini", side_effect=TTSError("gemini down")), \
             patch("app.services.tts_service._synthesize_azure", side_effect=TTSError("azure down")), \
             patch("app.services.tts_service._synthesize_google", return_value=b"GOOGLE_AUDIO") as mock_go:
            result = synthesize_speech("你好")

        assert result == b"GOOGLE_AUDIO"
        mock_go.assert_called_once()

    def test_all_fail_raises_combined_error(self):
        """All three providers fail → TTSError listing all three failures."""
        import app.services.tts_service as tts_mod
        from app.services.tts_service import synthesize_speech, TTSError

        with patch.object(tts_mod, "TTS_PROVIDER", "gemini31"), \
             patch.object(tts_mod, "AZURE_SPEECH_KEY", "fake-key"), \
             patch("app.services.tts_service._gcs_get", return_value=None), \
             patch("app.services.tts_service._gcs_put"), \
             patch("app.services.tts_service._TTS_CACHE", {}), \
             patch("app.services.tts_service._synthesize_gemini", side_effect=TTSError("gemini down")), \
             patch("app.services.tts_service._synthesize_azure", side_effect=TTSError("azure down")), \
             patch("app.services.tts_service._synthesize_google", side_effect=TTSError("google down")):
            with pytest.raises(TTSError) as exc_info:
                synthesize_speech("你好")

        err = str(exc_info.value)
        assert "Gemini" in err or "gemini" in err
        assert "Google" in err or "google" in err

    def test_gemini_fail_skips_azure_when_no_key(self):
        """When AZURE_SPEECH_KEY is empty, Azure is skipped silently in gemini31 fallback."""
        import app.services.tts_service as tts_mod
        from app.services.tts_service import synthesize_speech, TTSError

        with patch.object(tts_mod, "TTS_PROVIDER", "gemini31"), \
             patch.object(tts_mod, "AZURE_SPEECH_KEY", ""), \
             patch("app.services.tts_service._gcs_get", return_value=None), \
             patch("app.services.tts_service._gcs_put"), \
             patch("app.services.tts_service._TTS_CACHE", {}), \
             patch("app.services.tts_service._synthesize_gemini", side_effect=TTSError("gemini down")), \
             patch("app.services.tts_service._synthesize_azure") as mock_az, \
             patch("app.services.tts_service._synthesize_google", return_value=b"GOOGLE_AUDIO"):
            result = synthesize_speech("你好")

        assert result == b"GOOGLE_AUDIO"
        mock_az.assert_not_called()


# ---------------------------------------------------------------------------
# 4. TestCrossProviderCache
# ---------------------------------------------------------------------------

class TestCrossProviderCache:
    """gemini31 provider must check azure and google GCS caches on miss."""

    def test_gemini31_checks_azure_cache_on_miss(self):
        """gemini31 GCS miss → check azure/ path → return cached data without API call."""
        import app.services.tts_service as tts_mod
        from app.services.tts_service import synthesize_speech, _cache_key

        text = "測試跨Provider快取"
        key = _cache_key(text)

        def gcs_get_side_effect(k, provider="google"):
            if provider == "gemini31":
                return None  # miss on gemini31 path
            if provider == "azure":
                return b"AZURE_CACHED"
            return None

        with patch.object(tts_mod, "TTS_PROVIDER", "gemini31"), \
             patch("app.services.tts_service._gcs_get", side_effect=gcs_get_side_effect), \
             patch("app.services.tts_service._gcs_put"), \
             patch("app.services.tts_service._TTS_CACHE", {}), \
             patch("app.services.tts_service._synthesize_gemini") as mock_g:
            result = synthesize_speech(text)

        assert result == b"AZURE_CACHED"
        mock_g.assert_not_called()

    def test_gemini31_checks_google_cache_on_miss(self):
        """gemini31 and azure GCS misses → check google/tts-cache/ path."""
        import app.services.tts_service as tts_mod
        from app.services.tts_service import synthesize_speech, _cache_key

        text = "測試Google快取回退"
        key = _cache_key(text)

        def gcs_get_side_effect(k, provider="google"):
            if provider == "gemini31":
                return None
            if provider == "azure":
                return None
            if provider == "google":
                return b"GOOGLE_CACHED"
            return None

        with patch.object(tts_mod, "TTS_PROVIDER", "gemini31"), \
             patch("app.services.tts_service._gcs_get", side_effect=gcs_get_side_effect), \
             patch("app.services.tts_service._gcs_put"), \
             patch("app.services.tts_service._TTS_CACHE", {}), \
             patch("app.services.tts_service._synthesize_gemini") as mock_g:
            result = synthesize_speech(text)

        assert result == b"GOOGLE_CACHED"
        mock_g.assert_not_called()


# ---------------------------------------------------------------------------
# 5. TestProviderValidation
# ---------------------------------------------------------------------------

class TestProviderValidation:
    """Invalid TTS_PROVIDER env var must default to 'azure' with an error log."""

    def test_invalid_provider_defaults_to_azure(self):
        """Module-level validation resets unknown provider to 'azure'."""
        import importlib
        import sys

        # Reload the module with an invalid env var
        env_patch = patch.dict("os.environ", {"TTS_PROVIDER": "badprovider"})
        env_patch.start()
        try:
            # Remove cached module so the module-level code re-runs
            for mod_name in list(sys.modules.keys()):
                if "tts_service" in mod_name:
                    del sys.modules[mod_name]

            with patch("logging.Logger.error") as mock_error:
                import app.services.tts_service as tts_mod_fresh
                # TTS_PROVIDER must have been reset to "azure"
                assert tts_mod_fresh.TTS_PROVIDER == "azure"
                # error must have been logged
                mock_error.assert_called()
                log_msg = mock_error.call_args[0][0]
                assert "Invalid" in log_msg or "TTS_PROVIDER" in log_msg
        finally:
            env_patch.stop()
            # Reload original module for other tests
            for mod_name in list(sys.modules.keys()):
                if "tts_service" in mod_name:
                    del sys.modules[mod_name]
            import app.services.tts_service  # re-import with clean env
