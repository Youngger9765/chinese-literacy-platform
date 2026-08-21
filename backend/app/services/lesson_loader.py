"""
Platform lesson loader — reads YAML files at import time into memory.

Two data layers (as of 2026-05-01):
  Layer 1 (production): backend/data/lessons/L*.yml  — 57 lessons, integer lesson_number
  Layer 2 (new):        backend/data/lessons/_parsed_2026-05-01/*.yml — 151 lessons, lesson_code only
  Metadata overlay:     backend/data/curriculum/manifest.yml — 158 lessons, display_order + strategy

Layer-2 lessons get synthetic integer IDs: curriculum display_order + 1000
  (e.g. display_order=1 → id=1001)

Layer-1 lessons with an existing L*.yml are loaded as-is and take precedence
over Layer-2 when both cover the same curriculum slot.

Multi-lesson YAML edge cases (one YAML covers multiple curriculum slots):
  G4-L20-22.yml → covers G4-L20, G4-L21, G4-L22 (expose as G4-L20 only)
  G5-L24-25.yml → covers G5-L24, G5-L25 (expose as G5-L24 only)
  G9-L15-16.yml → covers G9-L15, G9-L16 (expose as G9-L15 only)
  G9-L17-19.yml → covers G9-L17, G9-L18, G9-L19 (expose as G9-L17 only)

a/b suffix YAML edge cases (one YAML covers two curriculum a/b slots):
  G8-L3.yml → covers G8-L3a + G8-L3b (expose as G8-L3a only)
  G8-L6.yml → covers G8-L6a + G8-L6b (expose as G8-L6a only)
  G8-L9.yml → covers G8-L9a + G8-L9b (expose as G8-L9a only)
  G8-L12.yml → covers G8-L12a + G8-L12b (expose as G8-L12a only)

Usage:
    from app.services.lesson_loader import get_all_lessons, get_lessons_by_grade, get_lesson_by_id

Internal structure (Issue #1889 — split into focused modules):
  lesson_code_normalization.py  — static override maps + manifest code normalization
  lesson_layer_loaders.py       — I/O for Layer-1 and Layer-2 YAML files
  lesson_indexes.py             — build + expose singleton lesson collections
"""

import re
from pathlib import Path

# ---------------------------------------------------------------------------
# Backward-compatible re-exports from sub-modules
# (all names that callers currently import directly from lesson_loader)
# ---------------------------------------------------------------------------

from app.services.lesson_code_normalization import (
    halfwidth as _halfwidth,
    normalize_manifest_code as _normalize_manifest_code,
    MULTI_LESSON_PRIMARY as _MULTI_LESSON_PRIMARY,
    MULTI_LESSON_MAP as _MULTI_LESSON_MAP,
    CATALOG_TO_PARSED_OVERRIDE as _CATALOG_TO_PARSED_OVERRIDE,
    AB_SECONDARY_MAP as _AB_SECONDARY_MAP,
)

from app.services.lesson_layer_loaders import (
    normalize_fill_in_blank_item as _normalize_fill_in_blank_item,
    build_intro as _build_intro,
    GENRE_TO_CATEGORY as _GENRE_TO_CATEGORY,
    LAYER2_ID_OFFSET as _LAYER2_ID_OFFSET,
    load_curriculum_manifest as _load_curriculum_manifest,
    load_layer1_lessons as _load_layer1_lessons,
    load_layer2_lessons as _load_layer2_lessons,
)

from app.services.lesson_indexes import (
    build_all_lessons as _build_all_lessons,
    build_indexes as _build_indexes,
)


# ---------------------------------------------------------------------------
# Private alias kept for tests that call _load_lessons() from lesson_loader
# ---------------------------------------------------------------------------

def _load_lessons() -> list[dict]:
    """Load all lessons from both layers and return sorted. Delegates to lesson_indexes."""
    return _build_all_lessons()


# ---------------------------------------------------------------------------
# Singleton indexes — loaded once at import time
# ---------------------------------------------------------------------------

_ALL_LESSONS: list[dict] = _build_all_lessons()
_LESSONS_BY_ID, _LESSONS_BY_CODE, _LESSONS_BY_TITLE, _AVAILABLE_GRADES = _build_indexes(_ALL_LESSONS)


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

def get_all_lessons() -> list[dict]:
    return _ALL_LESSONS


def get_lessons_by_grade(grade: int) -> list[dict]:
    return [l for l in _ALL_LESSONS if l["grade"] == grade]


# Root of the lesson tree: backend/data/lessons/<lesson_uid>/<version_id>/.
# Kept as a module-level constant because admin CRUD and several test fixtures
# swap it out to work against a temp dir instead of the real data.
_LESSONS_DIR = Path(__file__).resolve().parent.parent.parent / "data" / "lessons"


def get_lesson_by_id(lesson_id: int) -> dict | None:
    return _LESSONS_BY_ID.get(lesson_id)


def get_lesson_by_title(title: str) -> dict | None:
    """Exact match lookup by lesson title. O(1) from pre-built index."""
    return _LESSONS_BY_TITLE.get(title)


def get_lesson_by_code(lesson_code: str) -> dict | None:
    """Lookup by lesson_code (e.g. 'G4-L1', 'G4-L01', '文-L3').

    Accepts both zero-padded (G4-L01) and non-zero-padded (G4-L1) forms.

    For multi-text secondary slots (G4-L21/L22, G5-L25, G9-L16/L18/L19),
    which are skipped at catalogue load time but appear in the curriculum
    manifest, fall back to the primary slot's lesson dict (#1669). This
    keeps `normalize_story_slug('G4-L21')` from cascading into the
    `_PUBLISHER_RE` fallback and matching Layer-1 #21 (forest guard).
    """
    lesson = _LESSONS_BY_CODE.get(lesson_code)
    if lesson:
        return lesson
    # Normalize zero-padded variant: G4-L01 → G4-L1
    normalized = _normalize_manifest_code(lesson_code)
    lesson = _LESSONS_BY_CODE.get(normalized)
    if lesson:
        return lesson
    # Legacy zero-padded aliases in Layer-1 (e.g. G4-L03).
    match = re.match(r"^([A-Za-z0-9一-鿿]+-L)(\d+)([A-Za-z]?)$", normalized)
    if match:
        prefix, num, suffix = match.groups()
        padded = f"{prefix}{num.zfill(2)}{suffix}"
        lesson = _LESSONS_BY_CODE.get(padded)
        if lesson:
            return lesson
    # Multi-text secondary slot fallback: look up the primary slot (#1669).
    # G4-L21 → G4-L20-22 → primary code G4-L20
    primary_compound = _MULTI_LESSON_MAP.get(normalized)
    if primary_compound:
        for primary_code, compound in _MULTI_LESSON_PRIMARY.items():
            if compound == primary_compound:
                return _LESSONS_BY_CODE.get(primary_code)
    return None


def get_available_grades() -> list[int]:
    return _AVAILABLE_GRADES


def search_lessons(
    grade: str | None = None,
    genre: str | None = None,
    category: str | None = None,
    search: str | None = None,
) -> list[dict]:
    """Filter lessons by criteria. All in-memory, no DB."""
    results = _ALL_LESSONS

    if grade:
        results = [l for l in results if str(l.get("grade")) == str(grade)]
    if genre:
        results = [l for l in results if l["genre"] == genre]
    if category:
        results = [l for l in results if l["category"] == category]
    if search:
        q = search.lower()
        results = [l for l in results if q in l["title"].lower()]

    return results
