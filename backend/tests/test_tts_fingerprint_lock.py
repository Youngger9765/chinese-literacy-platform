"""The gate for #2742: a pronunciation change must not silently orphan the cache.

`_cache_key` mixes the pronunciation fingerprint into every key, so editing the
correction table moves the entire key space at once and every object already in
GCS stops being addressable. Measured against the real bucket on 2026-08-20:
one added entry moved the fingerprint cda4399d726e -> 79e1c52637d3 and took the
number of reachable keys from 6613 to 0. Nothing else notices — the build is
green, the deploy succeeds, no log line fires, and the only symptom is that
playback got slow.

test_fingerprint_matches_the_locked_one is the gate. Everything below it exists
so that the gate cannot pass for the wrong reason: a lock hand-edited down to a
bare fingerprint, a lock with a nonsense digest, or a lock file quietly deleted.
"""
from __future__ import annotations

import json

import pytest

from app.services.tts.fingerprint_lock import (
    LOCK_PATH,
    REQUIRED_FIELDS,
    check_lock,
    load_lock,
)
from app.services.tts.normalization import CORRECTIONS_FINGERPRINT


def _valid_lock(fingerprint: str = "cda4399d726e") -> dict:
    """A lock with every field the real one carries, so a test that removes or
    corrupts exactly one field is testing that field and nothing else."""
    return {
        "fingerprint": fingerprint,
        "measured_at": "2026-08-20T17:09:08Z",
        "bucket": "lingoleap-tts-cache",
        "provider": "azure",
        "expected_keys": 6622,
        "reachable_keys": 6613,
        "bucket_objects": 17623,
    }


class TestTheGate:
    def test_fingerprint_matches_the_locked_one(self):
        """THE GATE. Red means: you changed how words are pronounced, and every
        cached clip in GCS just became unreachable. Read the failure message."""
        problems = check_lock(CORRECTIONS_FINGERPRINT, load_lock())
        assert problems == [], "\n\n".join(problems)

    def test_committed_lock_carries_real_provenance(self):
        """The committed lock must look like something the updater produced, not
        something a person typed to get past the gate."""
        lock = load_lock()
        for field in REQUIRED_FIELDS:
            assert field in lock, f"committed lock is missing {field!r}"
        assert lock["reachable_keys"] <= lock["expected_keys"]
        assert lock["bucket_objects"] >= lock["reachable_keys"]
        assert not lock.get("partial"), (
            "the committed lock records a knowingly half-warm corpus — finish the "
            "regeneration before shipping it"
        )
        assert lock["bucket"] == "lingoleap-tts-cache", (
            "the lock must describe the shared bucket; a measurement against some "
            "other bucket says nothing about what students hear"
        )

    def test_missing_lock_file_raises_rather_than_defaulting(self, tmp_path):
        """Deleting the lock must not be a way to make the gate pass."""
        with pytest.raises(OSError):
            load_lock(tmp_path / "does-not-exist.json")


class TestCheckLock:
    def test_matching_fingerprint_is_clean(self):
        """Positive control. Without this, a check_lock that always complains
        would still make every negative test below pass."""
        assert check_lock("cda4399d726e", _valid_lock("cda4399d726e")) == []

    def test_drifted_fingerprint_is_reported(self):
        problems = check_lock("79e1c52637d3", _valid_lock("cda4399d726e"))
        assert len(problems) == 1
        assert "drifted" in problems[0]
        # The message has to carry both digests and the way out, because the
        # person reading it in CI has no other signal that anything happened.
        assert "79e1c52637d3" in problems[0] and "cda4399d726e" in problems[0]
        assert "update_tts_fingerprint_lock.py" in problems[0]

    @pytest.mark.parametrize("field", REQUIRED_FIELDS)
    def test_each_missing_provenance_field_is_reported(self, field):
        lock = _valid_lock()
        del lock[field]
        problems = check_lock("cda4399d726e", lock)
        assert any(field in p for p in problems), (
            f"dropping {field!r} left the lock acceptable — a lock stripped to a "
            f"bare fingerprint would then pass"
        )

    @pytest.mark.parametrize(
        "bad",
        ["", "CDA4399D726E", "cda4399d726", "cda4399d726eX", "nothexdigits", 12345, None],
    )
    def test_malformed_fingerprint_is_reported(self, bad):
        lock = _valid_lock()
        lock["fingerprint"] = bad
        problems = check_lock("cda4399d726e", lock)
        assert any("hex digest" in p for p in problems), f"{bad!r} was accepted"

    @pytest.mark.parametrize(
        "field", ["expected_keys", "reachable_keys", "bucket_objects"]
    )
    @pytest.mark.parametrize("bad", [-1, "6622", 66.22, True, None])
    def test_nonsense_counts_are_reported(self, field, bad):
        """`True` is in here on purpose: bool is an int subclass, so a naive
        isinstance check accepts `"expected_keys": true` as a real count."""
        lock = _valid_lock()
        lock[field] = bad
        problems = check_lock("cda4399d726e", lock)
        assert any(field in p for p in problems), f"{field}={bad!r} was accepted"

    def test_reachable_exceeding_expected_is_reported(self):
        """Counts that contradict each other cannot both come from one listing
        of one bucket, which is what a fabricated lock looks like."""
        lock = _valid_lock()
        lock["reachable_keys"] = lock["expected_keys"] + 1
        problems = check_lock("cda4399d726e", lock)
        assert any("reachable_keys" in p and "exceeds" in p for p in problems)

    def test_bucket_objects_below_reachable_is_reported(self):
        lock = _valid_lock()
        lock["bucket_objects"] = lock["reachable_keys"] - 1
        problems = check_lock("cda4399d726e", lock)
        assert any("bucket_objects" in p and "below" in p for p in problems)

    def test_partial_lock_stays_red(self):
        """--allow-partial records a cold corpus honestly; it must not then go
        quiet. "Known cold and invisible" is the state this gate abolishes."""
        lock = _valid_lock()
        lock["partial"] = True
        problems = check_lock("cda4399d726e", lock)
        assert any("--allow-partial" in p for p in problems)

    def test_partial_false_is_clean(self):
        """Negative control for the check above: the flag being present and
        false must not itself be a complaint."""
        lock = _valid_lock()
        lock["partial"] = False
        assert check_lock("cda4399d726e", lock) == []

    @pytest.mark.parametrize(
        "bad",
        ["", "yesterday", "2026-08-20", "2026-08-20T17:09:08", "2026-08-20 17:09:08Z", 20260820],
    )
    def test_malformed_measured_at_is_reported(self, bad):
        """A free-text timestamp field is provenance in name only."""
        lock = _valid_lock()
        lock["measured_at"] = bad
        problems = check_lock("cda4399d726e", lock)
        assert any("measured_at" in p for p in problems), f"{bad!r} was accepted"

    def test_lock_file_on_disk_is_valid_json(self):
        json.loads(LOCK_PATH.read_text(encoding="utf-8"))
