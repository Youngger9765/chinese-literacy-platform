"""L1 (in-process) cache must never serve one provider's bytes to a request
for another provider — the in-memory sibling of #2649 item 4.

The GCS layer already carries the provider in its blob path (azure/sentences/
vs the google prefix), so an Azure miss can never accidentally read back a
Google object. L1 used to have no such thing: synthesize_speech's very first
line was `if key in _TTS_CACHE: return _TTS_CACHE[key]`, keyed on text alone.

Concretely, this made a momentary Azure hiccup permanent for that sentence:

    1. A request for some text arrives while Azure is down. It falls back to
       Google (cmn-CN-Chirp3-HD, the mainland accent rejected in 2026-04) and
       writes those bytes into L1 under the bare text key.
    2. Azure recovers. A second request for the *same text* hits L1's
       provider-blind key first, returns the stale Google bytes, and never
       even asks the provider chain again.

Fixed by namespacing the L1 entry's identity with the provider that produced
it (_l1_key), mirroring what _blob_path already does for GCS. A provider
mismatch is treated as a miss, which costs one fresh synthesis — the same
trade-off already accepted for the GCS layer's equivalent fix.
"""
from unittest.mock import patch

import pytest

from app.services import tts as tts_module
from app.services.tts import cache as tts_cache_module


AZURE_BYTES = b"AZURE-zh-TW-HsiaoChenNeural-BYTES"
GOOGLE_BYTES = b"GOOGLE-cmn-CN-Chirp3-HD-MAINLAND-ACCENT-BYTES"


@pytest.fixture(autouse=True)
def _clear_caches():
    tts_module._TTS_CACHE.clear()
    yield
    tts_module._TTS_CACHE.clear()


class TestL1DoesNotServeStaleFallbackBytes:
    def test_azure_recovering_is_not_stuck_behind_a_stale_google_l1_entry(self):
        """The exact production scenario: one bad request must not poison
        every later one for the rest of the process."""
        with patch.object(tts_module, "TTS_PROVIDER", "azure"), \
             patch.object(tts_module, "_gcs_get", return_value=None), \
             patch.object(tts_module, "_gcs_put"), \
             patch.object(tts_module, "_synthesize_azure", side_effect=tts_module.TTSError("down")), \
             patch.object(tts_module, "_synthesize_google", return_value=GOOGLE_BYTES):
            first = tts_module.synthesize_speech("小戴的攻擊千變萬化。")
        assert first == GOOGLE_BYTES, "sanity: the fallback itself must still work"

        # Azure is healthy again. Same text, brand new request.
        with patch.object(tts_module, "TTS_PROVIDER", "azure"), \
             patch.object(tts_module, "_gcs_get", return_value=None), \
             patch.object(tts_module, "_gcs_put"), \
             patch.object(tts_module, "_synthesize_azure", return_value=AZURE_BYTES) as azure_call:
            second = tts_module.synthesize_speech("小戴的攻擊千變萬化。")

        assert second == AZURE_BYTES, (
            "served the stale Google fallback bytes from a provider-blind L1 "
            "entry instead of asking Azure again"
        )
        assert azure_call.call_count == 1, "must have actually re-asked Azure, not just gotten lucky"

    def test_repeated_calls_under_one_healthy_provider_still_hit_l1(self):
        """Positive control (Fix 1's constraint): do not simply disable L1.

        Repeated classroom sentences under a healthy, consistent provider
        must still be free — only a provider *mismatch* should force a
        fresh synthesis.
        """
        with patch.object(tts_module, "TTS_PROVIDER", "azure"), \
             patch.object(tts_module, "_gcs_get", return_value=None), \
             patch.object(tts_module, "_gcs_put"), \
             patch.object(tts_module, "_synthesize_azure", return_value=AZURE_BYTES) as azure_call:
            r1 = tts_module.synthesize_speech("重複的句子。")
            r2 = tts_module.synthesize_speech("重複的句子。")
            r3 = tts_module.synthesize_speech("重複的句子。")

        assert r1 == r2 == r3 == AZURE_BYTES
        assert azure_call.call_count == 1, "L1 must still be doing its job when nothing failed"


class TestGetCachedTtsIsProviderScoped:
    """Direct unit tests of the get_cached_tts / _l1_put contract change."""

    def test_a_put_under_one_provider_is_not_visible_under_another(self):
        tts_module._l1_put("some-key", GOOGLE_BYTES, provider="google")
        assert tts_module._TTS_CACHE.get(tts_module._l1_key("some-key", "azure")) is None

    def test_get_cached_tts_reads_back_what_was_put_for_that_provider(self):
        tts_module._l1_put(tts_module._cache_key("測試句子"), AZURE_BYTES, provider="azure")
        assert tts_module.get_cached_tts("測試句子", provider="azure") == AZURE_BYTES
        assert tts_module.get_cached_tts("測試句子", provider="google") is None


class TestDeleteTtsCacheClearsEveryProvider:
    """delete_tts_cache must not miss an L1 entry just because it happens to
    be tagged with a provider other than the first one checked."""

    def test_l1_deleted_regardless_of_which_provider_wrote_it(self):
        key = tts_module._cache_key("被 regenerate 的句子")
        tts_module._l1_put(key, GOOGLE_BYTES, provider="google")

        # delete_tts_cache is defined in app.services.tts.cache and resolves
        # _get_gcs_bucket against that module's own globals — patching
        # tts_module (the __init__.py re-export) is inert post-#2649
        # consolidation and would let a real GCS client run here.
        with patch.object(tts_cache_module, "_get_gcs_bucket", return_value=None):
            result = tts_module.delete_tts_cache("被 regenerate 的句子")

        assert result["l1_deleted"] is True
        for provider in ("azure", "gemini31", "google"):
            assert tts_module._TTS_CACHE.get(tts_module._l1_key(key, provider)) is None

    def test_l1_deleted_false_when_nothing_was_cached(self):
        with patch.object(tts_cache_module, "_get_gcs_bucket", return_value=None):
            result = tts_module.delete_tts_cache("從來沒被合成過的句子")
        assert result["l1_deleted"] is False
