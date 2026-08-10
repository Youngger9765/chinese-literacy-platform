"""Regression tests for scripts/verify_lesson_audio.py's own checks.

Three defects found by kiro gpt-5.6-terra review of the #2649/#2627 TTS work:

  A2  The fingerprint probe mutated normalization.CORRECTIONS_FINGERPRINT and
      restored it without try/finally. An exception between the mutate and
      the restore left the shared module poisoned for the rest of the
      process — every _cache_key call after that point, for every lesson
      checked later in the same run, would silently use the wrong key.

  A1  Whether the audio came from the Google fallback was inferred from
      pause duration (>890ms) instead of asked directly of the synthesis
      path. A short paragraph with no long internal pause of its own looked
      identical to a fallback under that heuristic, and — the direction that
      matters more — a paragraph genuinely served by Azure that happens to
      have a long pause would have been misreported as the fallback.

  A4  The comma-pause check was gated on the paragraph having *any* detected
      internal silence at all (`if internal and not commas`). The worst case
      of the exact failure it exists to catch — pause-shortening flattening
      every gap below the silence detector's floor — makes `internal` empty,
      which skipped the check instead of failing it.
"""
from __future__ import annotations

from unittest.mock import patch

import pytest

from scripts.verify_lesson_audio import (
    COMMA_PAUSE_RANGE,
    MAX_INTERNAL_PAUSE_MS,
    _fingerprint_moves_the_key,
    _paragraph_findings,
)


# ---------------------------------------------------------------------------
# A2 — fingerprint probe must restore on exception, not just on success
# ---------------------------------------------------------------------------

class TestFingerprintProbeExceptionSafety:
    def test_moves_when_fingerprint_differs(self):
        """Sanity: the real (unmutated) code path returns True — the key
        does move when the fingerprint changes, which is what A2 wants."""
        assert _fingerprint_moves_the_key("測試句子") is True

    def test_fingerprint_is_restored_even_when_computing_the_probe_key_raises(self):
        import app.services.tts.normalization as norm

        original = norm.CORRECTIONS_FINGERPRINT
        real_cache_key = norm._cache_key

        def _boom(text):
            if norm.CORRECTIONS_FINGERPRINT == "probe":
                raise RuntimeError("simulated failure while computing the probe key")
            return real_cache_key(text)

        with patch.object(norm, "_cache_key", side_effect=_boom):
            with pytest.raises(RuntimeError):
                _fingerprint_moves_the_key("測試句子")

        assert norm.CORRECTIONS_FINGERPRINT == original, (
            "an exception during the probe left the shared module's "
            "fingerprint poisoned — every _cache_key call for the rest of "
            "the process now silently uses the wrong key"
        )

    def test_a_later_call_is_unaffected_by_an_earlier_raised_probe(self):
        """The real-world consequence of the bug: one lesson erroring out
        during the probe must not corrupt the check for the next lesson in
        the same run."""
        import app.services.tts.normalization as norm

        original = norm.CORRECTIONS_FINGERPRINT
        real_cache_key = norm._cache_key

        def _boom_once(text):
            if norm.CORRECTIONS_FINGERPRINT == "probe":
                raise RuntimeError("simulated")
            return real_cache_key(text)

        with patch.object(norm, "_cache_key", side_effect=_boom_once):
            with pytest.raises(RuntimeError):
                _fingerprint_moves_the_key("第一課的句子")

        # No patch active now — a later, unrelated call must behave normally.
        assert norm.CORRECTIONS_FINGERPRINT == original
        assert _fingerprint_moves_the_key("第二課的句子") is True


# ---------------------------------------------------------------------------
# A1 — provider comes from the synthesis path, not pause-duration inference
# ---------------------------------------------------------------------------

class TestA1UsesTheRealProvider:
    def _clean_samples(self):
        """A short, silence-free PCM buffer — no pause of any length."""
        import array
        return array.array("h", [3000] * 4800)  # 100ms of loud, non-silent audio

    def test_flags_when_provider_is_not_azure_even_with_no_long_pause(self):
        """Old heuristic: no pause > 890ms => looked like Azure. New check:
        ask the synthesis path directly — this is the failure mode the old
        code could not see."""
        with patch("scripts.verify_lesson_audio._decode", return_value=self._clean_samples()):
            findings = _paragraph_findings(0, "測試句子。", b"fake-mp3-bytes", "google")

        assert any("provider=google" in f for f in findings), findings
        assert any(f.startswith("A1") for f in findings)

    def test_does_not_flag_azure_provider_even_with_a_long_pause(self):
        """The direction that matters more: a paragraph genuinely served by
        Azure that happens to have a long internal pause must not be
        misreported as the Google fallback — that is a different problem
        (A3), not evidence of the wrong voice."""
        import array
        # Lead-in/trail-out longer than EDGE_MS(250ms) so the silence run in
        # the middle counts as internal rather than being filtered out as
        # the clip's onset/tail. One very long "silent" run, well past 890ms.
        lead = [3000] * (400 * 48)     # 400ms loud
        silence = [0] * (1000 * 48)    # 1000ms silent
        trail = [3000] * (400 * 48)    # 400ms loud
        samples = array.array("h", lead + silence + trail)

        with patch("scripts.verify_lesson_audio._decode", return_value=samples):
            findings = _paragraph_findings(0, "測試句子。", b"fake-mp3-bytes", "azure")

        assert not any(f.startswith("A1") for f in findings), findings
        assert any(f.startswith("A3") for f in findings), (
            "a real long pause must still be caught, just as A3 rather than A1"
        )


# ---------------------------------------------------------------------------
# A4 — flattened rhythm must be caught even when NO internal pause survives
# ---------------------------------------------------------------------------

class TestA4CatchesTotalFlattening:
    def test_flags_when_comma_text_has_zero_detected_internal_pauses(self):
        """The exact bug: shortening squashed every pause below the silence
        detector's floor, so find_silences returns nothing at all. The old
        `if internal and not commas` check required internal to be
        non-empty first, so this — the worst case of the failure it exists
        to catch — was silently skipped instead of flagged."""
        import array
        samples = array.array("h", [3000] * 4800)  # no silence anywhere

        with patch("scripts.verify_lesson_audio._decode", return_value=samples), \
             patch("scripts.verify_lesson_audio.find_silences", return_value=[]):
            findings = _paragraph_findings(0, "小明，你好。", b"fake-mp3-bytes", "azure")

        assert any(f.startswith("A4") for f in findings), (
            f"total flattening on comma-bearing text went unflagged: {findings}"
        )

    def test_does_not_flag_text_with_no_comma_punctuation_at_all(self):
        """Positive control: a paragraph with nothing that should produce a
        comma pause must not be falsely flagged just because it has none."""
        import array
        samples = array.array("h", [3000] * 4800)

        with patch("scripts.verify_lesson_audio._decode", return_value=samples), \
             patch("scripts.verify_lesson_audio.find_silences", return_value=[]):
            findings = _paragraph_findings(0, "小明你好", b"fake-mp3-bytes", "azure")

        assert not any(f.startswith("A4") for f in findings), findings

    def test_still_passes_when_a_comma_pause_survives_in_range(self):
        """Positive control: a paragraph that DOES keep a proper comma pause
        must not be flagged."""
        import array
        assert COMMA_PAUSE_RANGE[0] <= 250 <= COMMA_PAUSE_RANGE[1]
        # Lead-in/trail-out longer than EDGE_MS(250ms) so this counts as an
        # internal pause rather than the clip's onset/tail.
        lead = [3000] * (400 * 48)   # 400ms loud
        silence = [0] * (250 * 48)   # 250ms silent — inside COMMA_PAUSE_RANGE
        trail = [3000] * (400 * 48)  # 400ms loud
        samples = array.array("h", lead + silence + trail)

        with patch("scripts.verify_lesson_audio._decode", return_value=samples):
            findings = _paragraph_findings(0, "小明，你好。", b"fake-mp3-bytes", "azure")

        assert not any(f.startswith("A4") for f in findings), findings
