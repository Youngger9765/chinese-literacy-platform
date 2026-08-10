"""A cache miss under Azure must never be served from the Google prefix.

The two prefixes hold different voices, and they are not interchangeable:

    azure/sentences/   zh-TW-HsiaoChenNeural   Taiwanese Mandarin — what we ship
    <google prefix>    cmn-CN-Chirp3-HD        mainland accent — rejected 2026-04

The read path used to fall through from the first to the second on a miss.
That turns a momentary Azure failure into a permanent one for that sentence:
the fallback writes a mainland-accent object, every later request finds it, and
Azure coming back healthy does not undo it. 22 sentences reached production
that way (issue #2649 item 4).

So the fallback is gone. A miss now costs one synthesis — the price of always
shipping the right voice.
"""
from unittest.mock import patch

import pytest

from app.services import tts as tts_module


AUDIO_FROM_GOOGLE_PREFIX = b"MAINLAND-ACCENT-BYTES"
AUDIO_FRESHLY_SYNTHESIZED = b"AZURE-BYTES"


@pytest.fixture(autouse=True)
def _clear_l1():
    tts_module._TTS_CACHE.clear()
    yield
    tts_module._TTS_CACHE.clear()


def _gcs_get_only_google_has_it(key, provider):
    """The sentence exists under the google prefix and nowhere else.

    This is the exact state the 22 bad objects are in.
    """
    return AUDIO_FROM_GOOGLE_PREFIX if provider == "google" else None


class TestNoCrossProviderReadThrough:
    def test_azure_miss_synthesizes_rather_than_serving_the_google_object(self):
        with patch.object(tts_module, "TTS_PROVIDER", "azure"), \
             patch.object(tts_module, "_gcs_get", side_effect=_gcs_get_only_google_has_it), \
             patch.object(tts_module, "_gcs_put"), \
             patch.object(tts_module, "_synthesize_azure", return_value=AUDIO_FRESHLY_SYNTHESIZED) as synth:
            result = tts_module.synthesize_speech("小戴的攻擊千變萬化。")

        assert result == AUDIO_FRESHLY_SYNTHESIZED, (
            "served the mainland-accent object that was sitting under the google prefix"
        )
        assert synth.call_count == 1, "should have paid for one synthesis instead"

    def test_never_even_asks_the_google_prefix_while_running_azure(self):
        """Not just 'ignores the answer' — it must not make the lookup.

        Asking and then discarding would still be a live cross-prefix path that
        a later refactor could re-enable by accident.
        """
        seen = []

        def record(key, provider):
            seen.append(provider)
            return None

        with patch.object(tts_module, "TTS_PROVIDER", "azure"), \
             patch.object(tts_module, "_gcs_get", side_effect=record), \
             patch.object(tts_module, "_gcs_put"), \
             patch.object(tts_module, "_synthesize_azure", return_value=AUDIO_FRESHLY_SYNTHESIZED):
            tts_module.synthesize_speech("哀聲嘆息。")

        assert seen == ["azure"], f"looked in prefixes {seen}; only azure is ours to read"

    def test_an_azure_object_that_does_exist_is_still_served_from_cache(self):
        """Positive control.

        Without this, a change that broke *all* GCS reads would leave the two
        tests above green — they only assert what must not happen.
        """
        with patch.object(tts_module, "TTS_PROVIDER", "azure"), \
             patch.object(tts_module, "_gcs_get", side_effect=lambda key, provider: (
                 AUDIO_FRESHLY_SYNTHESIZED if provider == "azure" else None)), \
             patch.object(tts_module, "_gcs_put"), \
             patch.object(tts_module, "_synthesize_azure") as synth:
            result = tts_module.synthesize_speech("摸不著頭緒。")

        assert result == AUDIO_FRESHLY_SYNTHESIZED
        assert synth.call_count == 0, "cache hit should not have synthesized"
