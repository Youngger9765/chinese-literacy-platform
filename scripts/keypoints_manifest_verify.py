"""Verify committed keypoints QA manifest/snapshots match live story-structure runtime.

CI-safe: does not need private/curriculum-source (uses loader + on-disk YAML only).
"""

from __future__ import annotations

import json
import sys
from pathlib import Path
from typing import Any, Callable

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))
sys.path.insert(0, str(ROOT / "scripts"))

from app.services.lesson_code_normalization import normalize_manifest_code  # noqa: E402
from story_structure_qa_lib import PARSER_GAP_LESSONS, REPRESENTATIVE_LESSONS  # noqa: E402

QA_ROOT = ROOT / "backend/data/curriculum_qa"
MANIFEST_PATH = QA_ROOT / "keypoints_manifest.json"
SNAPSHOTS_DIR = QA_ROOT / "snapshots"

PROFILE_KEYS = ("mode", "layout", "fill_blank_count", "checkbox_count")


def _profile_slice(profile: dict[str, Any] | None) -> dict[str, Any]:
    src = profile or {}
    return {k: src.get(k) for k in PROFILE_KEYS}


def verify_manifest_freshness(
    *,
    manifest_path: Path = MANIFEST_PATH,
    snapshots_dir: Path = SNAPSHOTS_DIR,
    build_structure: Callable[[dict], dict | None],
    loader_for_lesson: Callable[[str, dict[str, dict]], tuple[dict | None, str | None]],
    lessons_by_code: dict[str, dict],
) -> list[str]:
    """Return human-readable errors; empty list means manifest matches runtime."""
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

    for entry in manifest.get("lessons") or []:
        lesson_id = entry.get("lesson_id") or ""
        if not lesson_id:
            continue

        loader, _catalog = loader_for_lesson(lesson_id, lessons_by_code)
        recorded = _profile_slice(entry.get("layout"))

        if entry.get("known_data_gap") and lesson_id not in PARSER_GAP_LESSONS:
            errors.append(f"{lesson_id}: known_data_gap=true but not in PARSER_GAP_LESSONS")

        if not loader:
            if entry.get("tier") == "docx_keypoints":
                errors.append(f"{lesson_id}: docx_keypoints in manifest but loader missing")
            continue

        struct = build_structure(loader)
        if not struct:
            continue

        live = _profile_slice(struct.get("interaction_profile"))
        if recorded != live:
            errors.append(
                f"{lesson_id}: manifest.layout {recorded} != runtime interaction_profile {live}"
            )

        snap_path = snapshots_dir / lesson_id / "structure.json"
        if snap_path.is_file():
            snap = json.loads(snap_path.read_text(encoding="utf-8"))
            snap_prof = _profile_slice(snap.get("interaction_profile"))
            if snap_prof != live:
                errors.append(
                    f"{lesson_id}: snapshot structure.json profile {snap_prof} != runtime {live}"
                )

    for rep in REPRESENTATIVE_LESSONS:
        parsed = rep["parsed_code"]
        entry = next((l for l in manifest.get("lessons") or [] if l.get("lesson_id") == parsed), None)
        if entry is None:
            errors.append(f"representative lesson {parsed} missing from manifest")
            continue
        if not entry.get("overall_pass"):
            errors.append(f"representative lesson {parsed} overall_pass=false in manifest")

    g7 = next((l for l in manifest.get("lessons") or [] if l.get("lesson_id") == "G7-L6"), None)
    if g7:
        layout = g7.get("layout") or {}
        if layout.get("mode") != "fill_blank":
            errors.append(f"G7-L6: expected fill_blank, manifest has mode={layout.get('mode')!r}")
        if g7.get("known_data_gap"):
            errors.append("G7-L6: known_data_gap must be false after #2273")

    return errors


def load_lessons_by_code() -> dict[str, dict]:
    from app.services.lesson_loader import get_all_lessons

    lessons_by_code: dict[str, dict] = {}
    for lesson in get_all_lessons():
        code = normalize_manifest_code(lesson.get("grade_code") or lesson.get("lesson_code") or "")
        if code:
            lessons_by_code[code] = lesson
    return lessons_by_code


def default_verify() -> list[str]:
    from app.routes.stories import _format_yaml_structure_table, _sanitize_structure_for_client
    from story_structure_qa import build_structure_from_lesson, loader_for_parsed_lesson

    lessons_by_code = load_lessons_by_code()

    def _build(loader: dict) -> dict | None:
        return build_structure_from_lesson(
            loader, _format_yaml_structure_table, _sanitize_structure_for_client
        )

    return verify_manifest_freshness(
        build_structure=_build,
        loader_for_lesson=loader_for_parsed_lesson,
        lessons_by_code=lessons_by_code,
    )


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
        f"(lessons={summary.get('total')} pass={summary.get('pass')} known_gap={summary.get('known_gap_count')})"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
