"""Registry for the per-lesson student/teacher worksheet docx (#3276).

Backed by the checked-in ``backend/data/worksheets/gcs_mapping.json`` — see
``backend/data/worksheets/GCS_MAPPING.md`` for what that file is and how it was
built (Google Drive inventory, sha256 provenance).

⚠️ "Present in the mapping" is NOT the same as "downloadable". The mapping
records every lesson we found in Drive, but the docx bodies themselves live in
a private GCS bucket and get uploaded separately (see
``scripts/upload_worksheet_docx.py``). Only entries with ``gcs_uploaded: true``
are treated as available here — this is the same lesson #2845 already learned
the hard way for the single-version worksheet: a button that's wired but whose
file 404s is worse than no button (see
``backend/tests/test_worksheet_url_is_not_silently_dead_2845.py``). Until the
upload actually runs, this registry reports nothing as available, and the
frontend/route show/serve nothing — that's correct, not a bug.
"""
from __future__ import annotations

import json
from functools import lru_cache
from pathlib import Path
from typing import Literal

Version = Literal["student", "teacher"]

_MAPPING_PATH = Path(__file__).resolve().parent.parent.parent / "data" / "worksheets" / "gcs_mapping.json"


@lru_cache(maxsize=1)
def _load_mapping() -> dict:
    if not _MAPPING_PATH.is_file():
        return {"lessons": {}}
    with open(_MAPPING_PATH, "r", encoding="utf-8") as f:
        return json.load(f)


def _clear_cache_for_tests() -> None:
    """Test-only escape hatch — monkeypatch ``_MAPPING_PATH`` then call this."""
    _load_mapping.cache_clear()


def _entry_for(lesson_uid: str, version: Version) -> dict | None:
    lessons = _load_mapping().get("lessons") or {}
    entry = lessons.get(lesson_uid)
    if not entry:
        return None
    rec = entry.get(version)
    if not rec or not rec.get("gcs_uploaded"):
        return None
    return rec


def get_worksheet_availability(lesson_uid: str | None) -> dict[str, bool]:
    """Return {"student": bool, "teacher": bool} — both False for unknown/None uid."""
    if not lesson_uid:
        return {"student": False, "teacher": False}
    return {
        "student": _entry_for(lesson_uid, "student") is not None,
        "teacher": _entry_for(lesson_uid, "teacher") is not None,
    }


def get_worksheet_gcs_path(lesson_uid: str, version: Version) -> str | None:
    """Return the GCS object path for an uploaded worksheet, or None if not
    available (unknown lesson, unknown version, or not yet uploaded)."""
    rec = _entry_for(lesson_uid, version)
    return rec["gcs_path"] if rec else None
