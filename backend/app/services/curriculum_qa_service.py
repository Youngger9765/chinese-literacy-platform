"""Load curriculum QA artifacts (keypoints manifest + previews)."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

_QA_ROOT = Path(__file__).resolve().parent.parent.parent / "data" / "curriculum_qa"
_MANIFEST = _QA_ROOT / "keypoints_manifest.json"


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
    path = _QA_ROOT / "previews" / lesson_id / "original.html"
    if not path.exists():
        return None
    return path.read_text(encoding="utf-8")


def read_snapshot_json(lesson_id: str, name: str) -> dict[str, Any] | None:
    path = _QA_ROOT / "snapshots" / lesson_id / name
    if not path.exists():
        return None
    return json.loads(path.read_text(encoding="utf-8"))
