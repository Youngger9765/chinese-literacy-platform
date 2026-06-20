"""
spotlight_v2_loader.py — load checked-in block-sequence spotlight schemas.

Priority: dev7 (curated) → test15 (curated) → catalog (bulk-promoted).
"""

from app.services.lesson_code_normalization import normalize_manifest_code
from app.services.spotlight_contract import (
    CATALOG_LESSONS,
    DEV7_LESSONS,
    TEST15_CATALOG_CODES,
    load_catalog_spotlight,
    load_dev7_spotlight,
    load_test15_spotlight,
    test15_fixture_for_catalog,
)


def is_spotlight_v2_lesson(lesson_code: str) -> bool:
    norm = normalize_manifest_code(lesson_code)
    return (
        norm in DEV7_LESSONS
        or norm in TEST15_CATALOG_CODES
        or norm in CATALOG_LESSONS
    )


def load_spotlight_v2(lesson_code: str) -> dict | None:
    norm = normalize_manifest_code(lesson_code)
    if norm in DEV7_LESSONS:
        return load_dev7_spotlight(norm)
    fixture_id = test15_fixture_for_catalog(norm)
    if fixture_id:
        return load_test15_spotlight(fixture_id)
    if norm in CATALOG_LESSONS:
        return load_catalog_spotlight(norm)
    return None
