#!/usr/bin/env python3
"""Build the 重點表 QA manifest + snapshots from the lessons the platform serves.

Usage:
  python scripts/build_keypoints_qa_manifest.py --all     # the whole served corpus
  python scripts/build_keypoints_qa_manifest.py --smoke   # SMOKE_LESSONS only

Output:
  backend/data/curriculum_qa/keypoints_manifest.json
  backend/data/curriculum_qa/snapshots/{lesson_id}/structure.json
  backend/data/curriculum_qa/snapshots/{lesson_id}/keypoints.json

WHERE THE MANIFEST COMES FROM (#2749)
-------------------------------------
Until 2026-08-19 this read two first-edition directories:

    private/curriculum-source/_online-schema   (the curation workspace)
    backend/data/lessons/_parsed_2026-05-01    (the batch parser's output)

Both were deleted in the second-edition re-ink, so `--all` exited 1 on a missing
path and the manifest could not be regenerated — which left
`keypoints_manifest_verify.py` comparing a first-edition baseline against a
second-edition runtime, red on every PR for 147 lessons. A gate whose baseline
cannot be rebuilt is a gate that gets deleted, and this one is the only thing
that caught the 2026-08-17 regression where the 重點表 rendered five empty
display rows and no student could answer it (see the note at
`keypoints_to_structure._columns_to_structure_table`).

So the source is now the corpus the platform actually serves:
`backend/data/lessons/<uid>/<version>/keypoints.yml` → `get_all_lessons()` →
`story_structure_table` → the route's own formatter. Same functions, same order
as `GET /stories/{id}/structure`, so what is recorded is what a student gets.

This absorbed `scripts/rebuild_keypoints_manifest.py`, written 2026-08-14 as a
second builder because this one could not run. Two builders for one artifact —
with the dead one named in every error message and CI path filter — is how the
gate stayed red for five days, so there is one again.

WHAT IT DOES NOT DO
-------------------
1. It does not decide whether a 重點表 is *correct*. `overall_pass` and
   `known_data_gap` are human review verdicts, carried forward per lesson (by
   uid, so a renumber cannot move a verdict onto another lesson) and never
   regenerated. A lesson new to this edition is recorded without a verdict —
   `summary.unreviewed` counts those — rather than being handed an invented pass.
   Deriving a QA verdict from the output being QA'd makes the gate agree with
   whatever it is given.

2. It does not run the L1/L2/L3 content gates. Those diffed the served table
   against the DOCX curation schema, and that schema is the directory the re-ink
   deleted; L2 fidelity for the second edition is covered by the content evidence
   gate instead. Entries carry `gates: {}` so the QA dashboard renders them as
   "not run" rather than claiming a pass nobody produced.

3. It does not write `previews/{lesson_id}/original.html`. `render_keypoints_html`
   reads the first edition's schema (`sub_label`, `template`, `blanks` as a list
   of strings); v3 writes `label`/`prompt`/`options` and `blanks` as a list of
   `{answer}` dicts, so pointing it at v3 raises on the first blank. Rendering a
   half-understood preview and labelling it 「原文抽取預覽」 would be worse than
   the 136 first-edition previews still on disk, which are at least what they say
   they are. Those need a v3 renderer — tracked separately, not invented here.
"""

from __future__ import annotations

import argparse
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))
sys.path.insert(0, str(ROOT / "scripts"))

from app.services.lesson_code_normalization import normalize_manifest_code  # noqa: E402
from story_structure_qa_lib import SMOKE_LESSONS  # noqa: E402

OUT_DIR = ROOT / "backend/data/curriculum_qa"
MANIFEST_PATH = OUT_DIR / "keypoints_manifest.json"
SNAPSHOTS_DIR = OUT_DIR / "snapshots"

# The four fields `keypoints_manifest_verify` compares. Kept in one place so the
# builder and the gate cannot drift into recording and checking different things.
PROFILE_KEYS = ("mode", "layout", "fill_blank_count", "checkbox_count")

# Verdicts a human recorded. Carried across a rebuild, never recomputed.
CARRIED_VERDICT_KEYS = ("overall_pass", "known_data_gap", "review_note")


def _profile(struct: dict) -> dict:
    prof = struct.get("interaction_profile") or {}
    out = {k: prof.get(k) for k in PROFILE_KEYS}
    # Not compared by the gate — it is here so a human reading the manifest can
    # tell a 3-row table from a 30-row one without opening the snapshot.
    out["row_count"] = len(struct.get("rows") or [])
    return out


def _prior_verdicts() -> tuple[dict[str, dict], dict[str, dict]]:
    """The committed manifest's human verdicts, indexed by uid and by code.

    Uid first: the second edition renumbered every code, and a verdict carried by
    code alone would land on whatever lesson now holds that number.
    """
    if not MANIFEST_PATH.is_file():
        return {}, {}
    prior = json.loads(MANIFEST_PATH.read_text(encoding="utf-8"))
    by_uid, by_code = {}, {}
    for entry in prior.get("lessons") or []:
        verdicts = {k: entry[k] for k in CARRIED_VERDICT_KEYS if k in entry}
        if not verdicts:
            continue
        if entry.get("lesson_uid"):
            by_uid[entry["lesson_uid"]] = verdicts
        if entry.get("lesson_id"):
            by_code[entry["lesson_id"]] = verdicts
    return by_uid, by_code


def _raw_keypoints_by_uid() -> dict[str, dict]:
    """Each lesson's keypoints module as the loader read it off disk.

    Read from `lesson_uid_loader` rather than the assembled lesson row because
    the row's `keypoints` field is `(l.get("keypoints") or {}).get("keypoints")`
    — the loader has already unwrapped that layer, so the row's field is None for
    all 175 lessons (a separate bug in `lesson_indexes`, reported not fixed here).
    """
    from app.services.lesson_uid_loader import load_all

    return {l["lesson_uid"]: l.get("keypoints") for l in load_all() if l.get("keypoints")}


def build_manifest(*, smoke_only: bool = False) -> tuple[dict, dict[str, dict]]:
    """Return (manifest, {lesson_id: {filename: payload}}). Writes nothing."""
    from app.routes.stories import _format_yaml_structure_table, _sanitize_structure_for_client
    from app.services.lesson_loader import get_all_lessons

    by_uid, by_code = _prior_verdicts()
    raw_keypoints = _raw_keypoints_by_uid()
    smoke = {normalize_manifest_code(c) for c in SMOKE_LESSONS}

    lessons_out: list[dict] = []
    snapshots: dict[str, dict] = {}

    for lesson in get_all_lessons():
        code = normalize_manifest_code(lesson.get("grade_code") or lesson.get("lesson_code") or "")
        table = lesson.get("story_structure_table")
        if not code or not table:
            # No table is not a failure to record — 25 lessons have no 重點表 in
            # their worksheet at all. Recording them with an empty profile would
            # put 25 display_only rows into the ratchet that mean nothing.
            continue
        if smoke_only and code not in smoke:
            continue

        struct = _sanitize_structure_for_client(_format_yaml_structure_table(table))
        uid = lesson.get("lesson_uid")

        entry = {
            "lesson_id": code,
            "lesson_uid": uid,
            "title": lesson.get("title"),
            "tier": "keypoints_yml",
            "layout": _profile(struct),
            # See "WHAT IT DOES NOT DO" (2) — not run, not passed.
            "gates": {},
            "artifacts": {
                "has_structure_snapshot": True,
                "has_keypoints_snapshot": uid in raw_keypoints,
            },
        }
        entry.update(by_uid.get(uid) or by_code.get(code) or {})
        lessons_out.append(entry)

        files = {"structure.json": struct}
        if uid in raw_keypoints:
            files["keypoints.json"] = raw_keypoints[uid]
        snapshots[code] = files

    lessons_out.sort(key=lambda x: x["lesson_id"])

    failures = [e for e in lessons_out if e.get("overall_pass") is False]
    gaps = [e for e in lessons_out if e.get("known_data_gap")]
    unreviewed = [e for e in lessons_out if "overall_pass" not in e]
    display_only = [e for e in lessons_out if e["layout"]["mode"] == "display_only"]

    manifest = {
        "schema_version": 2,
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "generated_by": "scripts/build_keypoints_qa_manifest.py",
        "source": "served corpus — backend/data/lessons/<uid>/<version>/keypoints.yml (#2749)",
        "smoke_only": smoke_only,
        "summary": {
            "total": len(lessons_out),
            # "not known to fail", NOT "reviewed and approved" — it counts every
            # lesson without a recorded failure, including the ones nobody has
            # looked at. `unreviewed` keeps that distinction on the page.
            "pass": len(lessons_out) - len(failures),
            "fail": len(failures),
            "known_gap_count": len(gaps),
            "failure_count": len(failures),
            "unreviewed": len(unreviewed),
            # The ratchet `keypoints_manifest_verify.DISPLAY_ONLY_LESSONS` holds.
            "display_only": len(display_only),
        },
        "raw_failures": [e["lesson_id"] for e in failures],
        "lessons": lessons_out,
    }
    return manifest, snapshots


def _write(manifest: dict, snapshots: dict[str, dict]) -> None:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    MANIFEST_PATH.write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    for lesson_id, files in snapshots.items():
        lesson_dir = SNAPSHOTS_DIR / lesson_id
        lesson_dir.mkdir(parents=True, exist_ok=True)
        for name, payload in files.items():
            (lesson_dir / name).write_text(
                json.dumps(payload, ensure_ascii=False, indent=2, sort_keys=True) + "\n",
                encoding="utf-8",
            )


def _report_orphan_snapshots(live_ids: set[str]) -> list[str]:
    """Snapshot directories with no 重點表 in the served corpus.

    Two kinds, both first-edition leftovers: codes the re-ink retired entirely
    (G4-L23…G4-L27, G9-L17 …), and codes still served by a lesson whose worksheet
    has no 重點表 section. Reported, not deleted: they are committed artifacts and
    which to keep is a curation call, not this builder's. Silence is the thing to
    avoid — a directory named after a code that no longer exists is exactly how a
    stale baseline hid for five days.
    """
    if not SNAPSHOTS_DIR.is_dir():
        return []
    return sorted(p.name for p in SNAPSHOTS_DIR.iterdir() if p.is_dir() and p.name not in live_ids)


def main() -> int:
    parser = argparse.ArgumentParser(description="Build keypoints QA manifest")
    parser.add_argument("--smoke", action="store_true", help=f"Smoke only: {SMOKE_LESSONS}")
    parser.add_argument("--all", action="store_true", help="Whole served corpus")
    args = parser.parse_args()

    if not args.smoke and not args.all:
        args.smoke = True

    manifest, snapshots = build_manifest(smoke_only=not args.all)
    _write(manifest, snapshots)

    s = manifest["summary"]
    print(f"Wrote {MANIFEST_PATH}")
    print(f"  lessons={s['total']} unreviewed={s['unreviewed']} display_only={s['display_only']}")
    print(f"  snapshots: {len(snapshots)} under {SNAPSHOTS_DIR}")
    # Only meaningful for a full build — under --smoke every non-smoke directory
    # would be reported as an orphan, which is noise, not a finding.
    orphans = _report_orphan_snapshots(set(snapshots)) if args.all else []
    if orphans:
        print(f"  note: {len(orphans)} snapshot dirs have no 重點表 in the served corpus: "
              f"{', '.join(orphans)}")
    return 0 if s["fail"] == 0 else 1


if __name__ == "__main__":
    raise SystemExit(main())
