"""Verify the committed 重點表 QA manifest still matches what the platform serves.

CI-safe: reads only the lesson tree and the route's own formatter — no private
curation workspace, no network.

WHAT THIS GATE IS FOR
---------------------
It compares one thing per lesson: the `interaction_profile` the manifest
remembers against the profile the live story-structure path produces. That is a
narrow check and it earns its place — on 2026-08-17 the second-edition table
bridge fell through for the column-shaped worksheets and every 重點表 of that
shape became five empty `display_only` rows that no student could answer. The
per-character gate, the module split and the spotlight render were all green;
this profile comparison was the only thing that went red.

Do not replace it with something that reads the manifest alone. The value is in
the comparison against runtime, and in the fact that the baseline is committed.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))
sys.path.insert(0, str(ROOT / "scripts"))

from app.services.lesson_code_normalization import normalize_manifest_code  # noqa: E402
from story_structure_qa_lib import PARSER_GAP_LESSONS, REPRESENTATIVE_LESSONS  # noqa: E402

QA_ROOT = ROOT / "backend/data/curriculum_qa"
MANIFEST_PATH = QA_ROOT / "keypoints_manifest.json"
SNAPSHOTS_DIR = QA_ROOT / "snapshots"

PROFILE_KEYS = ("mode", "layout", "fill_blank_count", "checkbox_count")

# Lessons whose 重點表 currently renders with nothing for the student to do.
#
# A ratchet, not a config: it may shrink, never grow. Rebuilding the manifest
# re-baselines every profile, which is also exactly how a regression of the
# 2026-08-17 kind would get laundered into the baseline and go green — so a
# lesson that renders `display_only` has to be named here, with its reason, to be
# allowed through. Fixing one means deleting its line; the gate fails on a stale
# entry too, so the list cannot quietly outlive the bug.
#
#   G4-L5 (L0016 《這是什麼「意思」？》) — a matching exercise: eight sentences,
#   each answered with a letter from an `option_bank` of eight glosses. The
#   bridge has no case for `layout: matrix` + `option_bank`, so the 配對 column
#   is served as plain text — the student is shown G, H, D, F, B, C, A, E, which
#   is the answer key, and has nothing to fill in. Content defect in the
#   converter, not in this gate.
DISPLAY_ONLY_LESSONS = frozenset({"G4-L5"})


def _profile_slice(profile: dict[str, Any] | None) -> dict[str, Any]:
    src = profile or {}
    return {k: src.get(k) for k in PROFILE_KEYS}


def live_profiles_by_code() -> dict[str, dict[str, Any]]:
    """{code: {lesson_uid, title, profile}} for every lesson serving a 重點表.

    Built through the same two functions as `GET /stories/{id}/structure`, in the
    same order, so a difference here is a difference a student would see.
    """
    from app.routes.stories import _format_yaml_structure_table, _sanitize_structure_for_client
    from app.services.lesson_loader import get_all_lessons

    out: dict[str, dict[str, Any]] = {}
    for lesson in get_all_lessons():
        code = normalize_manifest_code(lesson.get("grade_code") or lesson.get("lesson_code") or "")
        table = lesson.get("story_structure_table")
        if not code or not table:
            continue
        struct = _sanitize_structure_for_client(_format_yaml_structure_table(table))
        out[code] = {
            "lesson_uid": lesson.get("lesson_uid"),
            "title": lesson.get("title"),
            "profile": _profile_slice(struct.get("interaction_profile")),
        }
    return out


def verify_manifest_freshness(
    *,
    manifest_path: Path = MANIFEST_PATH,
    snapshots_dir: Path = SNAPSHOTS_DIR,
    live: dict[str, dict[str, Any]],
) -> list[str]:
    """Return human-readable errors; empty list means the manifest matches runtime."""
    errors: list[str] = []

    if not manifest_path.is_file():
        return [f"missing manifest: {manifest_path} — run scripts/build_keypoints_qa_manifest.py --all"]

    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    summary = manifest.get("summary") or {}

    if summary.get("fail", 0) > 0:
        errors.append(f"manifest summary.fail={summary.get('fail')} — rebuild with build_keypoints_qa_manifest.py --all")

    known_gap_count = summary.get("known_gap_count", 0)
    if known_gap_count > 0 and not PARSER_GAP_LESSONS:
        errors.append(
            f"manifest known_gap_count={known_gap_count} but PARSER_GAP_LESSONS is empty — stale manifest or false greens"
        )

    if manifest.get("smoke_only"):
        errors.append("manifest smoke_only=true — run build_keypoints_qa_manifest.py --all before merge")

    recorded_codes: set[str] = set()
    display_only: set[str] = set()

    for entry in manifest.get("lessons") or []:
        lesson_id = entry.get("lesson_id") or ""
        if not lesson_id:
            continue
        recorded_codes.add(lesson_id)

        if entry.get("known_data_gap") and lesson_id not in PARSER_GAP_LESSONS:
            errors.append(f"{lesson_id}: known_data_gap=true but not in PARSER_GAP_LESSONS")

        live_entry = live.get(lesson_id)
        if live_entry is None:
            # Replaces the old "docx_keypoints but no parsed YAML on disk" check,
            # which pointed at `_parsed_2026-05-01` and so could never fire again.
            # Same intent: a manifest row that resolves to nothing is a baseline
            # nobody is checking.
            errors.append(f"{lesson_id}: in manifest but no served lesson has that code")
            continue

        # Identity, not position. The first edition's manifest went stale
        # invisibly because the re-ink renumbered every code — `G4-L13` in the
        # manifest and `G4-L13` in the loader were two different lessons, and the
        # gate compared one against the other for five days without saying so.
        if entry.get("lesson_uid") and entry["lesson_uid"] != live_entry["lesson_uid"]:
            errors.append(
                f"{lesson_id}: manifest records {entry['lesson_uid']} but that code now "
                f"serves {live_entry['lesson_uid']} — rebuild, do not re-point"
            )
            continue

        recorded = _profile_slice(entry.get("layout"))
        live_profile = live_entry["profile"]
        if recorded != live_profile:
            errors.append(
                f"{lesson_id}: manifest.layout {recorded} != runtime interaction_profile {live_profile}"
            )
        if live_profile.get("mode") == "display_only":
            display_only.add(lesson_id)

        snap_path = snapshots_dir / lesson_id / "structure.json"
        if snap_path.is_file():
            snap = json.loads(snap_path.read_text(encoding="utf-8"))
            snap_prof = _profile_slice(snap.get("interaction_profile"))
            if snap_prof != live_profile:
                errors.append(
                    f"{lesson_id}: snapshot structure.json profile {snap_prof} != runtime {live_profile}"
                )

    for code in sorted(display_only - DISPLAY_ONLY_LESSONS):
        errors.append(
            f"{code}: renders display_only — the student is shown the answer key and has "
            "nothing to answer. Fix the lesson, or name it in DISPLAY_ONLY_LESSONS with the reason"
        )
    for code in sorted((DISPLAY_ONLY_LESSONS & recorded_codes) - display_only):
        errors.append(
            f"{code}: named in DISPLAY_ONLY_LESSONS but is interactive again — delete the entry "
            "so the ratchet tightens"
        )

    for rep in REPRESENTATIVE_LESSONS:
        parsed = rep["parsed_code"]
        entry = next((l for l in manifest.get("lessons") or [] if l.get("lesson_id") == parsed), None)
        if entry is None:
            errors.append(f"representative lesson {parsed} missing from manifest")
            continue
        # `is False` rather than falsy: a lesson new to this edition carries no
        # verdict at all, and the builder will not invent one (`summary.unreviewed`
        # counts them). Reading "nobody has reviewed it" as "it failed" would make
        # the only way to green a rebuild that fabricates passes.
        if entry.get("overall_pass") is False:
            errors.append(f"representative lesson {parsed} overall_pass=false in manifest")

    return errors


def default_verify() -> list[str]:
    return verify_manifest_freshness(live=live_profiles_by_code())


def main() -> int:
    errors = default_verify()
    if errors:
        print("KEYPOINTS MANIFEST GATE: FAIL", file=sys.stderr)
        for err in errors:
            print(f"  - {err}", file=sys.stderr)
        print(
            "\nFix: backend/.venv/bin/python scripts/build_keypoints_qa_manifest.py --all",
            file=sys.stderr,
        )
        print("Then: bash scripts/story_structure_ship_gate.sh", file=sys.stderr)
        return 1

    manifest = json.loads(MANIFEST_PATH.read_text(encoding="utf-8"))
    summary = manifest.get("summary") or {}
    print(
        f"KEYPOINTS MANIFEST GATE: OK "
        f"(lessons={summary.get('total')} pass={summary.get('pass')} "
        f"unreviewed={summary.get('unreviewed')} display_only={summary.get('display_only')})"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
