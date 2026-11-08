"""Load curriculum QA artifacts (keypoints manifest + previews)."""

from __future__ import annotations

import json
import os
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


def _safe_join(base: Path, *parts: str) -> str | None:
    """Join `parts` under `base` and return the normalized path only if it's
    actually contained in `base` — otherwise None.

    CodeQL's `py/path-injection` sanitizer model specifically recognizes
    `os.path.normpath()` (moves the value to a "normalized" state) followed
    by `str.startswith(base)` (the recognized containment check) — plain
    `pathlib.Path.resolve()` + `in path.parents` is semantically equivalent
    but isn't in its recognized sanitizer list, so it keeps flagging the
    taint regardless of how many checks surround it. `os.sep` is appended
    to `base` to rule out a sibling-prefix collision (e.g. `/a/previews`
    wrongly "containing" `/a/previews-evil`).
    """
    base_str = os.path.normpath(str(base))
    candidate = os.path.normpath(os.path.join(base_str, *parts))
    if not candidate.startswith(base_str + os.sep):
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
    # #3955: validate BEFORE any path is built from `lesson_id` — a value
    # that doesn't match the known shape never touches the filesystem at all.
    if not _LESSON_ID_RE.fullmatch(lesson_id):
        return None
    path = _safe_join(_QA_ROOT / "previews", lesson_id, "original.html")
    if path is None or not os.path.isfile(path):
        return None
    with open(path, encoding="utf-8") as f:
        return f.read()


def read_snapshot_json(lesson_id: str, name: str) -> dict[str, Any] | None:
    if not _LESSON_ID_RE.fullmatch(lesson_id):
        return None
    path = _safe_join(_QA_ROOT / "snapshots", lesson_id, name)
    if path is None or not os.path.isfile(path):
        return None
    with open(path, encoding="utf-8") as f:
        return json.load(f)
