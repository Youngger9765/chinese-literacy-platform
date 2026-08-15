#!/usr/bin/env python3
"""rebuild_keypoints_manifest.py — regenerate the 重點表 QA manifest from runtime (#2683).

WHY A SECOND BUILDER
--------------------
`build_keypoints_qa_manifest.py` reads `private/curriculum-source/_online-schema`,
the first edition's curation workspace. That directory does not exist for the second
edition, so the existing builder cannot run at all — it exits on a missing path.

But the thing the manifest records is not curation state. `keypoints_manifest_verify.py`
compares one thing: the interaction profile the manifest remembers versus the profile
the live story-structure endpoint produces. That is derivable from the platform itself,
which is what this script does.

WHAT IT DOES NOT DO
-------------------
It does not decide whether a lesson's 重點表 is *correct*. `overall_pass` and
`known_data_gap` are human review verdicts and are carried over from the existing
manifest where the lesson still exists; a lesson new to this edition gets no verdict
rather than an invented pass. Regenerating a QA verdict from the output being QA'd
would make the gate agree with whatever it is given.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))
sys.path.insert(0, str(ROOT / "scripts"))

from app.services.lesson_code_normalization import normalize_manifest_code  # noqa: E402

QA_ROOT = ROOT / "backend/data/curriculum_qa"
MANIFEST_PATH = QA_ROOT / "keypoints_manifest.json"
SNAPSHOTS_DIR = QA_ROOT / "snapshots"

PROFILE_KEYS = ("mode", "layout", "fill_blank_count", "checkbox_count")


def _profile(struct: dict) -> dict:
    prof = struct.get("interaction_profile") or {}
    return {k: prof.get(k) for k in PROFILE_KEYS}


def main() -> int:
    from app.routes.stories import _format_yaml_structure_table, _sanitize_structure_for_client
    from app.services.lesson_loader import get_all_lessons

    old = {}
    if MANIFEST_PATH.is_file():
        prior = json.loads(MANIFEST_PATH.read_text(encoding="utf-8"))
        old = {l.get("lesson_id"): l for l in (prior.get("lessons") or [])}

    lessons, snapshots = [], 0
    for lesson in get_all_lessons():
        code = normalize_manifest_code(lesson.get("grade_code") or "")
        table = lesson.get("story_structure_table")
        if not code or not table:
            continue

        struct = _sanitize_structure_for_client(_format_yaml_structure_table(table))
        entry = {
            "lesson_id": code,
            "lesson_uid": lesson.get("lesson_uid"),
            "title": lesson.get("title"),
            "layout": _profile(struct),
            "docx_keypoints": None,
        }
        # Human verdicts are carried, never regenerated (see module docstring).
        prev = old.get(code)
        if prev:
            for k in ("overall_pass", "known_data_gap", "review_note"):
                if k in prev:
                    entry[k] = prev[k]
        lessons.append(entry)

        snap_dir = SNAPSHOTS_DIR / code
        snap_dir.mkdir(parents=True, exist_ok=True)
        (snap_dir / "structure.json").write_text(
            json.dumps(struct, ensure_ascii=False, indent=2, sort_keys=True) + "\n",
            encoding="utf-8",
        )
        snapshots += 1

    # `summary` mirrors the shape the previous builder produced; the gate reads it
    # and asserts fail == 0 and pass == total.
    #
    # Read `pass` as "not known to fail", NOT as "reviewed and approved" — it counts
    # every lesson without a recorded failure, including the ones nobody has looked
    # at yet. That is what the gate has always meant (it checks for known-bad, not
    # for coverage), but the two are easy to confuse, so `unreviewed` is emitted
    # alongside to keep the distinction on the page rather than in someone's head.
    failures = [e for e in lessons if e.get("overall_pass") is False]
    gaps = [e for e in lessons if e.get("known_data_gap")]
    unreviewed = [e for e in lessons if "overall_pass" not in e]
    MANIFEST_PATH.write_text(
        json.dumps(
            {
                "schema_version": 2,
                "generated_by": "scripts/rebuild_keypoints_manifest.py",
                "source": "runtime story-structure (uid tree keypoints, #2683)",
                "smoke_only": False,
                "summary": {
                    "total": len(lessons),
                    "pass": len(lessons) - len(failures),
                    "fail": len(failures),
                    "known_gap_count": len(gaps),
                    "failure_count": len(failures),
                    "unreviewed": len(unreviewed),
                },
                "raw_failures": [e["lesson_id"] for e in failures],
                "lessons": sorted(lessons, key=lambda x: x["lesson_id"]),
            },
            ensure_ascii=False,
            indent=2,
        )
        + "\n",
        encoding="utf-8",
    )
    carried = sum(1 for e in lessons if "overall_pass" in e)
    print(f"  manifest: {len(lessons)} lessons ({carried} carried a prior verdict)")
    print(f"  snapshots: {snapshots} written under {SNAPSHOTS_DIR}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
