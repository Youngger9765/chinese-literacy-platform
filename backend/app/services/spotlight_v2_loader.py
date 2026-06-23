"""
spotlight_v2_loader.py — load checked-in block-sequence spotlight schemas.

Priority: dev7 (curated) → test15 (curated) → catalog (bulk-promoted).
"""

import re

from app.services.content_mapping_registry import get_spotlight_source_code
from app.services.lesson_code_normalization import (
    MULTI_LESSON_MAP,
    normalize_manifest_code,
)
from app.services.spotlight_contract import (
    CATALOG_LESSONS,
    DEV7_LESSONS,
    TEST15_CATALOG_CODES,
    load_catalog_spotlight,
    load_dev7_spotlight,
    load_test15_spotlight,
    test15_fixture_for_catalog,
)


_ZERO_PADDED_GRADE_CODE_RE = re.compile(r"^G\d+-L0\d+[ab]?$")

# Padded aliases confirmed to cross-bind to a neighboring catalog spotlight.
_PADDED_ALIAS_DENYLIST = frozenset({
    "G4-L02",
    "G4-L03",
})

# Secondary slot backed by a shared multi-text source docx.
# Fail-closed: do not route to a blended spotlight file for this slot.
_SECONDARY_MULTI_TEXT_SPOTLIGHT_DENYLIST = frozenset({
})

# Temporarily fail-closed for slots with unresolved source identity drift.
# Do not bind to a spotlight file unless a verified per-lesson source exists.
_UNVERIFIED_SPOTLIGHT_SLOT_DENYLIST = frozenset({
    "G4-L17",
    "G4-L20",
})


def _is_zero_padded_grade_code(code: str) -> bool:
    return bool(_ZERO_PADDED_GRADE_CODE_RE.match(code or ""))


def is_spotlight_v2_lesson(lesson_code: str) -> bool:
    raw = (lesson_code or "").strip()
    norm = normalize_manifest_code(raw)
    if raw in _PADDED_ALIAS_DENYLIST:
        return False
    if norm in _SECONDARY_MULTI_TEXT_SPOTLIGHT_DENYLIST:
        return False
    if norm in _UNVERIFIED_SPOTLIGHT_SLOT_DENYLIST:
        return False
    if norm in MULTI_LESSON_MAP:
        return False
    if raw in DEV7_LESSONS or raw in TEST15_CATALOG_CODES or raw in CATALOG_LESSONS:
        return True
    return (
        norm in DEV7_LESSONS
        or norm in TEST15_CATALOG_CODES
        or norm in CATALOG_LESSONS
    )


def load_spotlight_v2(lesson_code: str, lesson_title: str | None = None) -> dict | None:
    raw = (lesson_code or "").strip()
    norm = normalize_manifest_code(raw)
    rebound = get_spotlight_source_code(norm, lesson_title)
    source_raw = rebound or raw
    source_norm = normalize_manifest_code(source_raw)

    if raw in _PADDED_ALIAS_DENYLIST:
        return None
    if norm in _SECONDARY_MULTI_TEXT_SPOTLIGHT_DENYLIST:
        return None
    if norm in _UNVERIFIED_SPOTLIGHT_SLOT_DENYLIST:
        return None
    if norm in MULTI_LESSON_MAP:
        return None

    # First, try exact-code lookup to avoid accidental cross-binding.
    if source_raw in DEV7_LESSONS:
        return load_dev7_spotlight(source_raw)
    fixture_id = test15_fixture_for_catalog(source_raw)
    if fixture_id:
        return load_test15_spotlight(fixture_id)
    if source_raw in CATALOG_LESSONS:
        return load_catalog_spotlight(source_raw)

    # Only then allow normalized fallback.
    if source_norm in DEV7_LESSONS:
        return load_dev7_spotlight(source_norm)
    fixture_id = test15_fixture_for_catalog(source_norm)
    if fixture_id:
        return load_test15_spotlight(fixture_id)
    if source_norm in CATALOG_LESSONS:
        return load_catalog_spotlight(source_norm)
    return None
