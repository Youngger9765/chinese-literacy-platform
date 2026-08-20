"""The pronunciation fingerprint the cached audio was last measured against.

Why this file exists
--------------------
`_cache_key` mixes `CORRECTIONS_FINGERPRINT` into every key, so a change to the
pronunciation table moves the whole key space at once. That is the right
design — it makes "the table says hè but the cached clip still says hē"
impossible, because the old object stops being addressable instead of staying
wrong.

The cost is that nothing about the failure is visible. Measured on 2026-08-20
against the real bucket: adding one entry to PHONEME_CORRECTIONS moved the
fingerprint cda4399d726e -> 79e1c52637d3, and of the 6356 keys the lesson
corpus asks for, the number still answered by an object in GCS went from 2764
to **zero**. Tests stay green, the build stays green, the deploy succeeds, no
log line is emitted, and the only symptom a student has is that playback got
slow — which reads as a bad connection, not as a regression. Three
`_backup-*-20260810/` directories in the bucket say the table has already been
changed at least three times.

So this module holds the one fact that makes the drift checkable: the
fingerprint that the objects sitting in the bucket actually answer to. Compare
it against the fingerprint the code computes now, and a silent invalidation
becomes a red test.

What this does NOT do
---------------------
It does not regenerate anything, and it does not claim the corpus is warm —
`reachable_keys` in the lock is a measurement taken at `measured_at`, not a
promise about now. The gate is about *drift*: the code moved, the bucket did
not.

It also cannot prove that a measurement happened. Nothing readable from inside
a test can distinguish "the updater listed the bucket and wrote these numbers"
from "somebody copied the previous numbers and pasted a new fingerprint over
them". What the checks below do is narrower and worth being precise about: they
reject a lock that is *shaped* wrong — missing provenance, impossible counts, a
digest that is not a digest, a knowingly-partial run — so that faking one stops
being a one-character edit and becomes a deliberate act, visible in the diff, by
someone who had to invent self-consistent numbers to do it. That is a cost, not
a proof.

It also only covers what the fingerprint itself covers. `he_exceptions.json`
and the 和-conjunction rule change how text is pronounced without moving the
key at all, so a change to those is still silently *wrong* audio rather than a
silent cache miss. Different bug, different fix (widen the fingerprint, and pay
for one more full regeneration) — tracked separately rather than papered over
here.
"""
from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Any

LOCK_PATH = (
    Path(__file__).resolve().parents[3] / "data" / "tts" / "corrections_fingerprint.lock.json"
)

# _compute_corrections_fingerprint truncates sha256 to 12 hex characters.
FINGERPRINT_RE = re.compile(r"^[0-9a-f]{12}$")

# Provenance, not decoration. A lock carrying nothing but a fingerprint is
# indistinguishable from one somebody hand-edited to silence this gate — which
# is the failure this gate exists to prevent — so a lock that does not carry the
# shape of a real measurement is not accepted. (On what that can and cannot
# establish, see "What this does NOT do" above.)
REQUIRED_FIELDS = (
    "fingerprint",
    "measured_at",
    "bucket",
    "provider",
    "expected_keys",
    "reachable_keys",
    "bucket_objects",
)

_COUNT_FIELDS = ("expected_keys", "reachable_keys", "bucket_objects")

# The updater writes UTC as "%Y-%m-%dT%H:%M:%SZ". Checked so that `measured_at`
# has to be a timestamp rather than any string at all — a free-text field is
# provenance in name only.
MEASURED_AT_RE = re.compile(r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$")

REGENERATE_INSTRUCTIONS = """\
To move the lock forward, regenerate first and re-measure second:

  1. python3 backend/scripts/prewarm_tts_cache.py --base <staging-backend>
  2. python3 backend/scripts/update_tts_fingerprint_lock.py --base <staging-backend>

Step 2 lists the real bucket and refuses to write a lock it could not measure.
Hand-editing backend/data/tts/corrections_fingerprint.lock.json to make this
test pass is precisely what this test is here to stop: it turns thousands of
unreachable objects back into a green build."""


def load_lock(path: Path | None = None) -> dict[str, Any]:
    """Read the lock file. Missing or malformed is an error, not a default.

    Degrading to an empty dict would make deleting the file a way to pass the
    gate, and this gate is the only thing standing between a one-line
    pronunciation edit and a silently cold cache.
    """
    p = path or LOCK_PATH
    return json.loads(p.read_text(encoding="utf-8"))


def check_lock(current_fingerprint: str, lock: dict[str, Any]) -> list[str]:
    """Every reason the lock does not vouch for *current_fingerprint*.

    A list rather than a bool, so a failure can say which of the distinct
    problems it is — drifted, malformed, or never actually measured — because
    the remedy differs for each.
    """
    problems: list[str] = []

    missing = [f for f in REQUIRED_FIELDS if f not in lock]
    if missing:
        problems.append(
            f"lock is missing required provenance field(s): {', '.join(missing)}. "
            "A lock with no evidence of a real measurement behind it is not "
            "accepted — regenerate it with scripts/update_tts_fingerprint_lock.py."
        )

    for field in _COUNT_FIELDS:
        if field in lock:
            value = lock[field]
            if isinstance(value, bool) or not isinstance(value, int) or value < 0:
                problems.append(
                    f"lock field {field!r} must be a non-negative integer, got {value!r}"
                )

    # Counts that contradict each other did not come from one listing of one
    # bucket. Enforced here rather than only in the committed-lock test, so that
    # every caller of check_lock gets it and not just the one test that happens
    # to assert it today.
    counts = {f: lock.get(f) for f in _COUNT_FIELDS}
    if all(isinstance(v, int) and not isinstance(v, bool) and v >= 0 for v in counts.values()):
        if counts["reachable_keys"] > counts["expected_keys"]:
            problems.append(
                f"lock is internally inconsistent: reachable_keys "
                f"({counts['reachable_keys']}) exceeds expected_keys "
                f"({counts['expected_keys']}); no single measurement produces that"
            )
        if counts["bucket_objects"] < counts["reachable_keys"]:
            problems.append(
                f"lock is internally inconsistent: bucket_objects "
                f"({counts['bucket_objects']}) is below reachable_keys "
                f"({counts['reachable_keys']}); the reachable keys are a subset of "
                f"the objects in the bucket"
            )

    # `--allow-partial` exists so a half-warmed corpus can be recorded honestly
    # rather than not at all. It must not then go quiet: a lock that says the
    # cache was cold when it was measured keeps this red until someone finishes
    # the regeneration, because "known cold and invisible" is the state this
    # whole gate exists to abolish.
    if lock.get("partial"):
        problems.append(
            "lock was written with --allow-partial: the corpus was measured as "
            "only partly reachable "
            f"({lock.get('reachable_keys')}/{lock.get('expected_keys')} keys). "
            "Finish the regeneration and re-measure — "
            "scripts/prewarm_tts_cache.py, then "
            "scripts/update_tts_fingerprint_lock.py without --allow-partial."
        )

    measured_at = lock.get("measured_at")
    if "measured_at" in lock and (
        not isinstance(measured_at, str) or not MEASURED_AT_RE.match(measured_at)
    ):
        problems.append(
            f"lock measured_at {measured_at!r} is not a UTC timestamp "
            f"(expected YYYY-MM-DDTHH:MM:SSZ)"
        )

    recorded = lock.get("fingerprint")
    if not isinstance(recorded, str) or not FINGERPRINT_RE.match(recorded):
        problems.append(
            f"lock fingerprint {recorded!r} is not a 12-character lowercase hex digest"
        )
    elif recorded != current_fingerprint:
        problems.append(
            f"pronunciation fingerprint drifted: the code now computes "
            f"{current_fingerprint}, but the audio in GCS is addressed under "
            f"{recorded}.\n\n"
            f"Every cached clip becomes unreachable the moment this deploys. "
            f"Nothing breaks loudly — playback still works, it just re-synthesizes "
            f"from cold on every request (~1.9s, occasional 503), for every student, "
            f"forever, until someone regenerates the corpus.\n\n"
            f"{REGENERATE_INSTRUCTIONS}"
        )

    return problems
