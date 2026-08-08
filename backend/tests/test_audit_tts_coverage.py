"""TDD lock for backend/scripts/audit_tts_coverage.py (#2619).

Two TTS bugs shipped the night of 2026-08-08 with no regression lock behind
them: (1) every "AI 朗讀" click regenerated audio from scratch instead of
hitting the pre-generated GCS cache, and (2) the first playback attempt fell
back to the browser's machine voice. The two locks that already existed —
frontend/scripts/eval/tts-alignment.eval.ts (cache *key* alignment) and
frontend/src/hooks/useTtsPlayback.test.ts (fallback *visibility*) — both
stay green even if every object in the GCS cache is deleted, because neither
one checks that an object actually EXISTS. That is exactly what happened in
2026-07 (an `age:90` lifecycle rule wiped the bucket, unnoticed for 4 months).

This is the missing check: every speakable sentence in the manifest
(backend/data/sentences.v2.jsonl) must have a real object in GCS under the
active TTS_PROVIDER's prefix.

Two layers, same split as test_audit_tts_objects.py:
  - Always-run unit tests against FakeBucket doubles (no GCS, no credentials).
  - An opt-in class that hits the real bucket (RUN_REAL_GCS_TESTS=1), mirroring
    TestAzureRealAPIPhonemeCorrections in test_tts_service.py.

Loaded via importlib.util (same pattern as test_audit_tts_objects.py /
test_batch_azure_tts.py) because it's a standalone script, not a package
module.
"""
from __future__ import annotations

import importlib.util
import os
from pathlib import Path

import pytest

SCRIPT_PATH = Path(__file__).parent.parent / "scripts" / "audit_tts_coverage.py"


def _load_module():
    spec = importlib.util.spec_from_file_location("audit_tts_coverage_under_test", SCRIPT_PATH)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


@pytest.fixture()
def coverage_mod():
    return _load_module()


class FakeBlob:
    def __init__(self, name: str):
        self.name = name


class FakeBucket:
    """Stand-in for google.cloud.storage.Bucket — list_blobs only, this
    module never reads or mutates object contents."""

    def __init__(self, names: list[str]):
        self._names = names

    def list_blobs(self, prefix: str = ""):
        return [FakeBlob(n) for n in self._names if n.startswith(prefix)]


# ---------------------------------------------------------------------------
# expected_keys() — must reuse batch_azure_tts.load_sentences() (zero drift
# from what the real generator actually queues), not re-derive the punctuation
# filter here.
# ---------------------------------------------------------------------------


class TestExpectedKeysMatchesManifest:
    def test_excludes_punctuation_only_sentences(self, coverage_mod):
        """。／」／」。 are unspeakable — batch_azure_tts.py's own
        _has_speakable_content skips them before they ever reach Azure
        (#2614/#2615). expected_keys() must inherit that exclusion, not
        re-derive its own (weaker or drifted) copy of the filter."""
        from app.services.tts.normalization import _cache_key

        expected = coverage_mod.expected_keys()
        for punctuation_only in ("。", "」", "」。"):
            assert _cache_key(punctuation_only) not in expected

    def test_count_matches_known_manifest_state(self, coverage_mod):
        """Pins the current manifest: 6,359 unique raw sentences in
        sentences.v2.jsonl, 3 of them punctuation-only → 6,356 speakable.
        If the manifest legitimately grows (new lessons), update this number
        — do not delete the assertion, that is exactly the kind of silent
        threshold-loosening this lock exists to prevent."""
        expected = coverage_mod.expected_keys()
        assert len(expected) == 6356

    def test_returns_a_set_of_hex_strings(self, coverage_mod):
        expected = coverage_mod.expected_keys()
        assert isinstance(expected, set)
        sample = next(iter(expected))
        assert isinstance(sample, str)
        int(sample, 16)  # must be valid hex (sha256 cache key)


# ---------------------------------------------------------------------------
# existing_keys() — one list_blobs, prefix-scoped, no per-object exists()
# ---------------------------------------------------------------------------


class TestExistingKeys:
    def test_extracts_cache_key_from_blob_name(self, coverage_mod):
        bucket = FakeBucket(["azure/sentences/aaa111.mp3"])
        found = coverage_mod.existing_keys(bucket, "azure")
        assert found == {"aaa111"}

    def test_ignores_non_mp3_objects_under_the_same_prefix(self, coverage_mod):
        bucket = FakeBucket(["azure/sentences/aaa111.mp3", "azure/sentences/manifest.json"])
        found = coverage_mod.existing_keys(bucket, "azure")
        assert found == {"aaa111"}

    def test_only_matches_the_active_providers_prefix(self, coverage_mod):
        """A fully-populated gemini31 prefix must never count toward azure's
        coverage — no cross-prefix bleed. This is the same guard as
        audit_tts_objects.py's test_only_scans_matching_prefix."""
        bucket = FakeBucket([
            "gemini31-prompt-only-v2/sentences/bbb222.mp3",
            "azure/sentences/aaa111.mp3",
        ])
        found = coverage_mod.existing_keys(bucket, "azure")
        assert found == {"aaa111"}

    def test_empty_bucket_returns_empty_set(self, coverage_mod):
        bucket = FakeBucket([])
        assert coverage_mod.existing_keys(bucket, "azure") == set()


# ---------------------------------------------------------------------------
# missing_keys() — the actual assertion logic every other test/CI check
# depends on. Subset check (expected ⊆ existing), not exact equality: real
# provenance data shows the bucket can hold MORE objects than currently
# expected (e.g. 3 punctuation-only objects generated by an azure batch run
# before #2615's skip-filter landed) — those extras must never fail the gate.
# ---------------------------------------------------------------------------


class TestMissingKeys:
    def test_returns_empty_when_everything_present(self, coverage_mod):
        assert coverage_mod.missing_keys({"a", "b"}, {"a", "b"}) == set()

    def test_tolerates_extra_objects_beyond_the_expected_set(self, coverage_mod):
        """Bucket has MORE than the manifest currently expects (stale/legacy
        objects) — must not be reported as missing."""
        assert coverage_mod.missing_keys({"a"}, {"a", "b", "c"}) == set()

    def test_reports_every_absent_key(self, coverage_mod):
        """This is the mutation-provable case: inject a hole (drop 'b' from
        existing) and confirm it is detected, not silently ignored."""
        missing = coverage_mod.missing_keys({"a", "b", "c"}, {"a", "c"})
        assert missing == {"b"}

    def test_all_missing_when_bucket_is_empty(self, coverage_mod):
        """The exact 2026-07 failure mode this lock exists for: the whole
        prefix got wiped. Every expected key must show up as missing, not
        just some."""
        expected = {"a", "b", "c"}
        assert coverage_mod.missing_keys(expected, set()) == expected


# ---------------------------------------------------------------------------
# Opt-in real GCS test — the actual regression lock. Everything above proves
# the logic is correct; only this class proves the *live bucket* has full
# coverage today. Mirrors TestAzureRealAPIPhonemeCorrections in
# test_tts_service.py (opt-in, skipped without credentials, never runs in CI).
# ---------------------------------------------------------------------------

_REAL_GCS_ENABLED = bool(os.environ.get("RUN_REAL_GCS_TESTS"))


@pytest.mark.skipif(
    not _REAL_GCS_ENABLED,
    reason="opt-in only — set RUN_REAL_GCS_TESTS=1 with real GCS credentials "
           "(ADC or GOOGLE_APPLICATION_CREDENTIALS) to run",
)
class TestRealGCSCoverage:
    """Hits the real lingoleap-tts-cache bucket. This is the only test that
    would actually have caught 'the bucket got wiped' or 'the batch run
    never finished' — every test above is mocked and would stay green
    through either failure."""

    def test_active_provider_has_full_manifest_coverage(self, coverage_mod):
        import os as _os

        from google.cloud import storage

        provider = _os.environ.get("TTS_PROVIDER", "azure")
        gcs = storage.Client()
        bucket = gcs.bucket(coverage_mod.GCS_BUCKET)

        expected = coverage_mod.expected_keys()
        existing = coverage_mod.existing_keys(bucket, provider)
        missing = coverage_mod.missing_keys(expected, existing)

        assert not missing, (
            f"{len(missing)}/{len(expected)} speakable sentences have no GCS "
            f"audio object under provider={provider}. Sample missing keys: "
            f"{sorted(missing)[:5]}"
        )
