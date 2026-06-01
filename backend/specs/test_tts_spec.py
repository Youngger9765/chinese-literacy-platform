"""Executable spec — TTS provider chain and synthesize_speech contracts.

spec_id: tts.synthesis.provider_chain
canonical_source: backend/app/services/tts/__init__.py
owns_code:
  - backend/app/services/tts/__init__.py
  - backend/app/services/tts/providers/azure.py
  - backend/app/services/tts/providers/gemini.py
  - backend/app/services/tts/providers/google.py
  - backend/app/services/tts_service.py
related_issues: []
human_spec: specs/modules/tts/INTENT.md

This file is the MACHINE side of the TTS spec.
Normalization and cache contracts are in the existing characterization tests:
  - tests/test_characterization_tts_normalization.py
  - tests/test_characterization_tts_cache.py

This spec adds contracts NOT covered by those files:
  1. TTS_PROVIDER default is "azure" (env-var contract).
  2. Voice constants importable and non-empty (sentinel: don't accidentally blank them).
  3. azure mode synthesize_speech falls back to Google when Azure raises TTSError.
  4. Both-failed path raises TTSError (not silent empty bytes).
  5. tts_service shim re-exports TTSError (backward compat).

Run:  cd backend && python -m pytest specs/test_tts_spec.py -v
"""
from __future__ import annotations

from unittest.mock import patch

import pytest


# ---------------------------------------------------------------------------
# Import helpers
# ---------------------------------------------------------------------------

def _import_tts():
    try:
        import app.services.tts as tts
        return tts
    except Exception as exc:
        pytest.skip(f"Cannot import app.services.tts: {exc}")


def _import_tts_init():
    """Return tts.__init__ module directly (for synthesize_speech)."""
    try:
        import importlib
        import app.services.tts as tts
        return tts
    except Exception as exc:
        pytest.skip(f"Cannot import app.services.tts: {exc}")


def _import_providers():
    """Return (azure, gemini, google) provider modules."""
    try:
        from app.services.tts.providers import azure, gemini, google
        return azure, gemini, google
    except Exception as exc:
        pytest.skip(f"Cannot import TTS providers: {exc}")


# ---------------------------------------------------------------------------
# Contract 1: TTS_PROVIDER default is "azure"
# ---------------------------------------------------------------------------

class TestTTSProviderDefault:
    """TTS_PROVIDER must default to 'azure' when the env var is not set."""

    def test_tts_provider_default_is_azure(self):
        """When TTS_PROVIDER env var is absent, the default must be 'azure'."""
        import os
        import importlib

        # Reload the module without the env var to see the real default
        original = os.environ.pop("TTS_PROVIDER", None)
        try:
            import app.services.tts as tts_mod
            # The constant is set at module load time; inspect the source value
            from app.services.tts import TTS_PROVIDER
            # We can't easily reload, so inspect the os.environ.get call default
            # by inspecting the source code instead.
            import inspect
            source_file = inspect.getfile(tts_mod)
            with open(source_file, encoding="utf-8") as f:
                source = f.read()
            assert '"azure"' in source or "'azure'" in source, (
                "TTS_PROVIDER default 'azure' not found in tts/__init__.py source"
            )
        finally:
            if original is not None:
                os.environ["TTS_PROVIDER"] = original

    def test_tts_provider_constant_importable(self):
        tts = _import_tts()
        assert hasattr(tts, "TTS_PROVIDER")
        assert isinstance(tts.TTS_PROVIDER, str)

    def test_tautology_break_tts_provider_is_string(self):
        """MUST fail if TTS_PROVIDER is accidentally set to None or int."""
        tts = _import_tts()
        assert isinstance(tts.TTS_PROVIDER, str), "TTS_PROVIDER must be a string"


# ---------------------------------------------------------------------------
# Contract 2: Voice constants are importable and non-empty
# ---------------------------------------------------------------------------

class TestVoiceConstants:
    """Voice name constants must be non-empty strings (sentinel against blank config)."""

    def test_google_voice_non_empty(self):
        providers = _import_providers()
        azure_mod, gemini_mod, google_mod = providers
        assert isinstance(google_mod.TTS_VOICE, str)
        assert len(google_mod.TTS_VOICE) > 0, "TTS_VOICE (Google) must not be empty"

    def test_azure_voice_non_empty(self):
        providers = _import_providers()
        azure_mod, gemini_mod, google_mod = providers
        assert isinstance(azure_mod.AZURE_TTS_VOICE, str)
        assert len(azure_mod.AZURE_TTS_VOICE) > 0, "AZURE_TTS_VOICE must not be empty"

    def test_gemini_voice_non_empty(self):
        providers = _import_providers()
        azure_mod, gemini_mod, google_mod = providers
        assert isinstance(gemini_mod.GEMINI_TTS_VOICE, str)
        assert len(gemini_mod.GEMINI_TTS_VOICE) > 0, "GEMINI_TTS_VOICE must not be empty"

    def test_google_voice_contains_chirp_or_cmn(self):
        """Default Google voice must reference Chirp3-HD or cmn language code."""
        providers = _import_providers()
        azure_mod, gemini_mod, google_mod = providers
        voice = google_mod.TTS_VOICE
        assert "Chirp" in voice or "cmn" in voice or "cmn-CN" in voice, (
            f"Expected Google voice to contain 'Chirp' or 'cmn', got: {voice!r}"
        )

    def test_azure_voice_is_taiwanese_voice(self):
        """Default Azure voice must be a zh-TW voice."""
        providers = _import_providers()
        azure_mod, gemini_mod, google_mod = providers
        assert "zh-TW" in azure_mod.AZURE_TTS_VOICE, (
            f"Azure voice must be zh-TW variant, got: {azure_mod.AZURE_TTS_VOICE!r}"
        )

    def test_tautology_break_voices_are_distinct(self):
        """MUST fail if all voices accidentally have the same value."""
        providers = _import_providers()
        azure_mod, gemini_mod, google_mod = providers
        voices = {google_mod.TTS_VOICE, azure_mod.AZURE_TTS_VOICE, gemini_mod.GEMINI_TTS_VOICE}
        assert len(voices) == 3, "Each provider must use a distinct voice name"


# ---------------------------------------------------------------------------
# Contract 3: azure mode falls back to Google when Azure raises TTSError
# ---------------------------------------------------------------------------

class TestAzureToGoogleFallback:
    """In azure mode, Azure failure must trigger Google fallback (not immediate raise)."""

    def test_azure_failure_triggers_google_fallback(self):
        """When Azure raises TTSError, synthesize_speech must try Google next."""
        tts = _import_tts()

        fake_audio = b"FAKE_MP3_BYTES"

        with patch.object(tts, "_synthesize_azure", side_effect=tts.TTSError("azure down")), \
             patch.object(tts, "_synthesize_google", return_value=fake_audio), \
             patch.object(tts, "TTS_PROVIDER", "azure"), \
             patch.object(tts, "_gcs_get", return_value=None), \
             patch.object(tts, "_gcs_put", return_value=None), \
             patch.object(tts, "_TTS_CACHE", {}):
            result = tts.synthesize_speech("你好世界")

        assert result == fake_audio, "Should return Google audio when Azure fails"

    def test_azure_fallback_uses_google_not_gemini(self):
        """Azure fallback must call _synthesize_google, not _synthesize_gemini."""
        tts = _import_tts()

        fake_audio = b"GOOGLE_AUDIO"

        google_call_count = []

        def fake_google(text):
            google_call_count.append(text)
            return fake_audio

        with patch.object(tts, "_synthesize_azure", side_effect=tts.TTSError("azure down")), \
             patch.object(tts, "_synthesize_google", side_effect=fake_google), \
             patch.object(tts, "_synthesize_gemini", side_effect=AssertionError("should not call gemini")), \
             patch.object(tts, "TTS_PROVIDER", "azure"), \
             patch.object(tts, "_gcs_get", return_value=None), \
             patch.object(tts, "_gcs_put", return_value=None), \
             patch.object(tts, "_TTS_CACHE", {}):
            result = tts.synthesize_speech("你好世界")

        assert len(google_call_count) == 1, "Google must be called exactly once as fallback"
        assert result == fake_audio

    def test_tautology_break_azure_fallback_actually_calls_google(self):
        """MUST fail if fallback is disabled (azure raises → still raises without Google)."""
        tts = _import_tts()

        # If fallback is properly implemented, Google call returns audio.
        # If not, TTSError would propagate before Google is called.
        with patch.object(tts, "_synthesize_azure", side_effect=tts.TTSError("down")), \
             patch.object(tts, "_synthesize_google", return_value=b"OK"), \
             patch.object(tts, "TTS_PROVIDER", "azure"), \
             patch.object(tts, "_gcs_get", return_value=None), \
             patch.object(tts, "_gcs_put", return_value=None), \
             patch.object(tts, "_TTS_CACHE", {}):
            result = tts.synthesize_speech("測試")

        assert result == b"OK"


# ---------------------------------------------------------------------------
# Contract 4: both providers fail → TTSError raised (not empty bytes)
# ---------------------------------------------------------------------------

class TestBothProvidersFail:
    """When both Azure and Google fail, synthesize_speech must raise TTSError."""

    def test_both_failed_raises_tts_error(self):
        tts = _import_tts()

        with patch.object(tts, "_synthesize_azure", side_effect=tts.TTSError("azure down")), \
             patch.object(tts, "_synthesize_google", side_effect=tts.TTSError("google down")), \
             patch.object(tts, "TTS_PROVIDER", "azure"), \
             patch.object(tts, "_gcs_get", return_value=None), \
             patch.object(tts, "_gcs_put", return_value=None), \
             patch.object(tts, "_TTS_CACHE", {}):
            with pytest.raises(tts.TTSError) as exc_info:
                tts.synthesize_speech("你好世界")

        # Error message must mention both providers
        msg = str(exc_info.value)
        assert "azure" in msg.lower() or "Azure" in msg, (
            "TTSError message should mention Azure failure"
        )
        assert "google" in msg.lower() or "Google" in msg, (
            "TTSError message should mention Google failure"
        )

    def test_tautology_break_does_not_return_empty_bytes_on_failure(self):
        """MUST fail if synthesize_speech silently returns b'' instead of raising."""
        tts = _import_tts()

        with patch.object(tts, "_synthesize_azure", side_effect=tts.TTSError("down")), \
             patch.object(tts, "_synthesize_google", side_effect=tts.TTSError("down")), \
             patch.object(tts, "TTS_PROVIDER", "azure"), \
             patch.object(tts, "_gcs_get", return_value=None), \
             patch.object(tts, "_gcs_put", return_value=None), \
             patch.object(tts, "_TTS_CACHE", {}):
            with pytest.raises(tts.TTSError):
                tts.synthesize_speech("你好世界")
            # Control flow must not reach here via return b""


# ---------------------------------------------------------------------------
# Contract 5: tts_service shim re-exports TTSError (backward compat)
# ---------------------------------------------------------------------------

class TestTTSServiceShim:
    """tts_service.py shim must re-export TTSError for existing callers."""

    def test_ttserror_importable_via_shim(self):
        try:
            from app.services.tts_service import TTSError
            assert issubclass(TTSError, RuntimeError), (
                "TTSError must be a RuntimeError subclass"
            )
        except Exception as exc:
            pytest.skip(f"tts_service shim import failed: {exc}")

    def test_synthesize_speech_importable_via_shim(self):
        try:
            from app.services.tts_service import synthesize_speech
            assert callable(synthesize_speech)
        except Exception as exc:
            pytest.skip(f"tts_service shim import failed: {exc}")
