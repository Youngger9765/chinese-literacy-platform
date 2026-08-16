#!/usr/bin/env python3
"""聚光燈結構指紋 — 全 175 課的回歸 ratchet (#2727).

WHY THIS REPLACES THE dev7 / test15 FIXTURES
--------------------------------------------
The gate compared seven checked-in first-edition lessons against
`backend/data/lessons/spotlight/dev7/gold_manifest.json`. The re-ink deleted that whole
directory on purpose — those fixtures are keyed by first-edition lesson codes, which is
the identity the re-ink removed. So the gate has been exiting 1 on a FileNotFoundError
ever since, and nothing was running it: `content_evidence_gate` / `run_spotlight_dev_gate`
appear in no workflow and in no `specs/run-ci.sh`.

Seven lessons was also the wrong shape of coverage now. The fingerprint is cheap —
`fingerprint_spotlight` already existed and is reused unchanged — so this covers all 175
rather than a sample, keyed by `lesson_uid`.

WHAT A FINGERPRINT IS, AND WHY NOT A JUDGE
------------------------------------------
Structure only: strategy_type, block count, the histogram and sequence of block types,
question/guide/passage counts, null answers, MCQ leakage. Deterministic — the same tree
gives the same bytes, so a diff is a real change and never a model's mood. A vision judge
over rendered pages answers a different question (is this CONTENT right) and cannot be
compared across runs without manufacturing regressions in lessons nobody touched.

It cannot see a wrong sentence inside a block. It is not meant to: it is the ratchet that
says 「something moved」 before a full rebuild lands, which is exactly the guard that was
missing while #2713 and #2714 both plan to rebuild all 175.

Usage:
    python3 scripts/spotlight_fingerprints.py --write     # regenerate after an intended change
    python3 scripts/spotlight_fingerprints.py --check     # gate: exit 1 on any drift
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO_ROOT / "backend"))

LESSONS_ROOT = REPO_ROOT / "backend" / "data" / "lessons"
FINGERPRINTS = REPO_ROOT / "backend" / "data" / "spotlight_fingerprints.json"


def _current() -> dict[str, dict]:
    """Fingerprint every lesson that has a spotlight, keyed by uid."""
    import yaml

    from app.services.spotlight_contract import fingerprint_spotlight

    out: dict[str, dict] = {}
    for path in sorted(LESSONS_ROOT.glob("*/v*/spotlight.yml")):
        uid = path.parts[-3]
        doc = yaml.safe_load(path.read_text(encoding="utf-8")) or {}
        spotlight = doc.get("spotlight") or {}
        # A lesson whose extraction failed is stored as {lesson, error} and has no
        # blocks. Recorded with a null fingerprint rather than skipped: going from
        # failed to extracted, or back, is exactly the kind of movement worth catching,
        # and skipping would make a lesson that stopped extracting look untouched.
        out[uid] = fingerprint_spotlight(spotlight) if spotlight.get("blocks") else None
    return out


def _stored() -> dict[str, dict]:
    if not FINGERPRINTS.exists():
        raise SystemExit(
            f"no fingerprint baseline at {FINGERPRINTS.relative_to(REPO_ROOT)} — "
            f"run with --write once to create it.\n"
            f"⛔ Do NOT make a missing baseline pass silently. That is the defect this "
            f"file replaces: `content_evidence_gate._per_lesson_golden` returns None when "
            f"the golden is absent, and a lesson with no baseline is then indistinguishable "
            f"from a lesson that passed."
        )
    return json.loads(FINGERPRINTS.read_text(encoding="utf-8"))["lessons"]


def check() -> int:
    cur, old = _current(), _stored()

    gone = sorted(set(old) - set(cur))
    new = sorted(set(cur) - set(old))
    moved = sorted(uid for uid in set(cur) & set(old) if cur[uid] != old[uid])

    if not (gone or new or moved):
        print(f"SPOTLIGHT_FINGERPRINT_GATE=PASS  {len(cur)} lessons, none moved")
        return 0

    print("SPOTLIGHT_FINGERPRINT_GATE=FAIL", file=sys.stderr)
    if gone:
        print(f"  {len(gone)} lessons disappeared: {gone[:8]}", file=sys.stderr)
    if new:
        print(f"  {len(new)} lessons appeared: {new[:8]}", file=sys.stderr)
    for uid in moved[:6]:
        a, b = old[uid], cur[uid]
        if a is None or b is None:
            print(f"  {uid}: {'lost its spotlight' if b is None else 'gained a spotlight'}",
                  file=sys.stderr)
            continue
        diff = {k: (a.get(k), b.get(k)) for k in set(a) | set(b) if a.get(k) != b.get(k)}
        # type_sequence is long and its own summary; block_count already says it moved.
        diff.pop("type_sequence", None)
        print(f"  {uid}: {diff}", file=sys.stderr)
    if len(moved) > 6:
        print(f"  … and {len(moved) - 6} more moved", file=sys.stderr)
    print(
        "\n  If the change was intended, regenerate with --write and say WHY in the "
        "commit. A ratchet that is re-baselined without a reason is not a ratchet.",
        file=sys.stderr,
    )
    return 1


def write() -> int:
    cur = _current()
    have = sum(1 for v in cur.values() if v)
    FINGERPRINTS.write_text(
        json.dumps(
            {
                "description": (
                    "Structural fingerprints for every lesson's spotlight. Regenerate "
                    "with scripts/spotlight_fingerprints.py --write and state why."
                ),
                "lesson_count": len(cur),
                "with_spotlight": have,
                "lessons": dict(sorted(cur.items())),
            },
            ensure_ascii=False,
            indent=2,
        )
        + "\n",
        encoding="utf-8",
    )
    print(f"  wrote {len(cur)} lessons ({have} with a spotlight) → "
          f"{FINGERPRINTS.relative_to(REPO_ROOT)}")
    return 0


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--write", action="store_true")
    ap.add_argument("--check", action="store_true")
    a = ap.parse_args()
    if a.write == a.check:
        ap.error("pass exactly one of --write / --check")
    return write() if a.write else check()


if __name__ == "__main__":
    sys.exit(main())
