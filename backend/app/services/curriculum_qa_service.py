"""Load curriculum QA artifacts (keypoints manifest + previews)."""

from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Any

_QA_ROOT = Path(__file__).resolve().parent.parent.parent / "data" / "curriculum_qa"
_MANIFEST = _QA_ROOT / "keypoints_manifest.json"

# lesson_id shape across the manifest/previews/snapshots trees: a grade code
# (G4-G9, or a CJK category like 文/體) + "-L" + a lesson number, e.g.
# "G8-L11", "文-L9". Python's `\w` is Unicode-aware, so it matches those CJK
# characters too, while still rejecting "..", "/", and anything else that
# isn't a real lesson_id — this is the #3955 path-injection fix: `lesson_id`
# arrives unvalidated from the route and was used directly to build a
# filesystem path.
_LESSON_ID_RE = re.compile(r"^\w+-L\d+$")


def _safe_lesson_dir(root: Path, lesson_id: str) -> Path | None:
    """Resolve `root / lesson_id`, rejecting anything that doesn't match the
    known lesson_id shape, or that would resolve outside `root` (second,
    defense-in-depth layer in case a validated-looking value is still a
    symlink/escape)."""
    if not _LESSON_ID_RE.fullmatch(lesson_id):
        return None
    resolved_root = root.resolve()
    candidate = (root / lesson_id).resolve()
    if candidate != resolved_root and resolved_root not in candidate.parents:
        return None
    return candidate


def load_keypoints_manifest() -> dict[str, Any]:
    if not _MANIFEST.exists():
        return {
            "schema_version": 1,
            "lessons": [],
            "summary": {"total": 0, "pass": 0, "fail": 0},
            "error": "manifest not built — run scripts/build_keypoints_qa_manifest.py",
        }
    return json.loads(_MANIFEST.read_text(encoding="utf-8"))


def get_lesson_entry(lesson_id: str) -> dict[str, Any] | None:
    manifest = load_keypoints_manifest()
    for lesson in manifest.get("lessons") or []:
        if lesson.get("lesson_id") == lesson_id:
            return lesson
    return None


def read_preview_html(lesson_id: str) -> str | None:
    lesson_dir = _safe_lesson_dir(_QA_ROOT / "previews", lesson_id)
    if lesson_dir is None:
        return None
    path = lesson_dir / "original.html"
    if not path.is_file() or lesson_dir not in path.resolve().parents:
        return None
    return path.read_text(encoding="utf-8")


def read_snapshot_json(lesson_id: str, name: str) -> dict[str, Any] | None:
    lesson_dir = _safe_lesson_dir(_QA_ROOT / "snapshots", lesson_id)
    if lesson_dir is None:
        return None
    path = lesson_dir / name
    if not path.is_file() or lesson_dir not in path.resolve().parents:
        return None
    return json.loads(path.read_text(encoding="utf-8"))
