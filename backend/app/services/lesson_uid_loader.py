"""lesson_uid_loader.py — Phase 3 of the second-edition re-ink (#2692).

Reads the uid tree written by `scripts/build_lesson_uid_tree.py`:

    backend/data/lessons/<lesson_uid>/<version_id>/
        lesson.yml   spotlight.yml   keypoints.yml   assets/

WHY IDENTITY IS THE DIRECTORY NAME
----------------------------------
The loader this replaced merged two historical layers (`L*.yml` hand-built 2026-02,
`_parsed_2026-05-01/` batch-parsed 2026-05) on the lesson TITLE. That join is the
root defect the second-edition re-ink existed to remove: a title differing by one
punctuation mark left the row an empty shell, silently, and 26 lessons were
duplicated across the two layers. Both layers are now deleted.

Identity is the directory name and nothing else. It is never derived from a title
or a lesson code — those are properties, and both change between editions.
"""

from __future__ import annotations

import functools
from pathlib import Path
from typing import Any, Optional

import yaml

# backend/app/services/ → backend/
_BACKEND_ROOT = Path(__file__).resolve().parent.parent.parent
LESSONS_ROOT = _BACKEND_ROOT / "data" / "lessons"

MODULES = ("spotlight", "keypoints", "body", "sections", "metadata")


def _is_uid_dir(p: Path) -> bool:
    """A uid dir is `L####` holding at least one `v*` version dir."""
    return (
        p.is_dir()
        and len(p.name) == 5
        and p.name[0] == "L"
        and p.name[1:].isdigit()
        and any(c.is_dir() and c.name.startswith("v") for c in p.iterdir())
    )


def _latest_version(uid_dir: Path) -> Optional[Path]:
    versions = sorted(
        (c for c in uid_dir.iterdir() if c.is_dir() and c.name.startswith("v")),
        key=lambda c: c.name,
    )
    return versions[-1] if versions else None


def _read_yaml(p: Path) -> Any:
    try:
        return yaml.safe_load(p.read_text(encoding="utf-8"))
    except Exception:
        return None


def _drop_assetless_table_figures(spotlight_doc: Any) -> None:
    """Remove figure blocks that point at a table and carry no image (#2455/#2463).

    `{"type": "figure", "referent": "table", "asset": null}` has nothing to render:
    the referent names a table's JSON, which is not an image. The frontend already
    skips them, so today they are invisible rather than broken — but they were only
    ever an extractor artefact, and `inject_per_practice_figures` puts them back
    every time the corpus is rebuilt. 89 of 143 lessons carry them after the
    second-edition rebuild.

    Dropping them here rather than leaning on the frontend guard means anything else
    that reads a spotlight — the eval gates, a future renderer, an export — sees the
    same block list the student does, instead of each consumer needing to know about
    a block type that renders to nothing. Only the assetless ones go: a figure with a
    real asset is a real figure whatever its referent says.
    """
    if not isinstance(spotlight_doc, dict):
        return
    inner = spotlight_doc.get("spotlight")
    target = inner if isinstance(inner, dict) else spotlight_doc
    blocks = target.get("blocks")
    if not isinstance(blocks, list):
        return
    target["blocks"] = [
        b for b in blocks
        if not (
            isinstance(b, dict)
            and b.get("type") == "figure"
            and b.get("referent") == "table"
            and not b.get("asset")
        )
    ]


@functools.lru_cache(maxsize=1)
def available_uids() -> tuple[str, ...]:
    """Every lesson_uid that has at least one version on disk."""
    if not LESSONS_ROOT.exists():
        return ()
    return tuple(sorted(p.name for p in LESSONS_ROOT.iterdir() if _is_uid_dir(p)))


@functools.lru_cache(maxsize=None)
def load_lesson(uid: str, version: Optional[str] = None) -> Optional[dict]:
    """Return the merged lesson dict for a uid, or None.

    `version=None` takes the highest version directory. Fail-closed: a missing
    `lesson.yml` means the directory is half-written and is treated as absent
    rather than served empty.
    """
    uid_dir = LESSONS_ROOT / uid
    if not uid_dir.is_dir():
        return None
    vdir = (uid_dir / version) if version else _latest_version(uid_dir)
    if not vdir or not vdir.is_dir():
        return None

    meta = _read_yaml(vdir / "lesson.yml")
    if not isinstance(meta, dict) or not meta.get("lesson_uid"):
        return None

    lesson: dict[str, Any] = dict(meta)
    lesson["version_id"] = vdir.name
    for mod in MODULES:
        data = _read_yaml(vdir / f"{mod}.yml")
        if data:
            if mod == "spotlight":
                _drop_assetless_table_figures(data)
            lesson[mod] = data
    assets = vdir / "assets"
    lesson["assets"] = (
        sorted(p.name for p in assets.iterdir() if p.is_file()) if assets.is_dir() else []
    )
    return lesson


def load_all() -> list[dict]:
    """Every lesson in the tree, latest version each. Skips half-written dirs."""
    out = []
    for uid in available_uids():
        lesson = load_lesson(uid)
        if lesson:
            out.append(lesson)
    return out


def reset_cache() -> None:
    """Test-only: the caches are import-time singletons in production."""
    available_uids.cache_clear()
    load_lesson.cache_clear()
