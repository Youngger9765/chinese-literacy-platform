"""Slug normalization utilities for story identifiers.

Handles three legacy formats and normalizes to plain number strings:
- "6"           -> "6"   (current canonical format)
- "L06" / "l06" -> "6"   (old L-prefix format)
- "贏得喝采的輸家" -> "6" (earliest Chinese title format)
"""

from __future__ import annotations

import logging

logger = logging.getLogger(__name__)

# Lazy-loaded title-to-number map (populated on first call)
_title_map: dict[str, int] | None = None


def _get_title_map() -> dict[str, int]:
    """Build and cache a Chinese-title -> lesson_number map from YAML lessons."""
    global _title_map
    if _title_map is not None:
        return _title_map

    try:
        from ..services.lesson_loader import get_all_lessons

        _title_map = {
            lesson["title"]: lesson["lesson_number"]
            for lesson in get_all_lessons()
            if lesson.get("title") and lesson.get("lesson_number")
        }
    except Exception:
        logger.warning("Failed to load lesson title map; Chinese title slugs won't be normalized")
        _title_map = {}

    return _title_map


def normalize_story_slug(slug: str) -> str:
    """Normalize story slug to canonical format (plain number string, e.g. '6').

    Accepts multiple input formats:
    - "6"             -> "6"
    - "06"            -> "6"
    - "L6"            -> "6"
    - "L06"           -> "6"
    - "l06"           -> "6"
    - "贏得喝采的輸家"  -> "6"  (Chinese title lookup from YAML lessons)

    Falls back to the original slug when it cannot be resolved to a number.
    """
    if not slug:
        return slug

    # 1) Strip L/l prefix and try numeric parse
    stripped = slug.lstrip("Ll")
    try:
        return str(int(stripped))
    except ValueError:
        pass

    # 2) Chinese title -> lesson_number lookup
    title_map = _get_title_map()
    lesson_number = title_map.get(slug)
    if lesson_number is not None:
        return str(lesson_number)

    # 3) Fallback: return original slug unchanged
    return slug
