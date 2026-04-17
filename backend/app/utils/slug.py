"""Slug normalization utilities for story identifiers.

Issue #985: Normalize all slug variants to a plain numeric string so that
progress is never split across multiple session records for the same story.

Canonical format: plain number string, e.g. "1", "6", "42".

Supported input formats
-----------------------
Direct numeric / L-prefixed:
    "6"              -> "6"
    "06"             -> "6"
    "L6"             -> "6"
    "L06"            -> "6"
    "l06"            -> "6"

Publisher-style (e.g. sanmin/nani textbook codes):
    "sanmin-5a-L02"  -> "2"
    "nani-6b-L10"    -> "10"
    Any trailing "L<digits>" pattern -> extract the number after L

Story title (Chinese):
    "贏得喝采的輸家"  -> "1"   (looked up from YAML catalogue)
    Unknown title     -> returned as-is (safe fallback)
"""
from __future__ import annotations

import re


# ---------------------------------------------------------------------------
# Lazy-loaded title->number index (avoids circular import with lesson_loader)
# ---------------------------------------------------------------------------
_TITLE_TO_NUMBER: dict[str, str] | None = None


def _get_title_index() -> dict[str, str]:
    """Build {title: canonical_number_str} on first call, then cache."""
    global _TITLE_TO_NUMBER
    if _TITLE_TO_NUMBER is None:
        try:
            from app.services.lesson_loader import get_all_lessons  # type: ignore[import]
            _TITLE_TO_NUMBER = {
                lesson["title"]: str(lesson["lesson_number"])
                for lesson in get_all_lessons()
                if lesson.get("title") and lesson.get("lesson_number") is not None
            }
        except Exception:
            _TITLE_TO_NUMBER = {}
    return _TITLE_TO_NUMBER


# ---------------------------------------------------------------------------
# Regex: publisher slug with L-prefix number at the end, e.g. "sanmin-5a-L02"
# ---------------------------------------------------------------------------
_PUBLISHER_RE = re.compile(r"[Ll](\d+)\s*$")


def normalize_story_slug(slug: str) -> str:
    """Normalize *slug* to canonical plain-number string.

    Resolution order
    ----------------
    1. Strip whitespace.
    2. Strip leading "L"/"l" and try direct int parse (handles "L06" -> "6").
    3. Match publisher-style suffix "L<num>" (handles "sanmin-5a-L02" -> "2").
    4. Look up in the title catalogue (handles Chinese title slugs).
    5. Return original stripped value as safe fallback.
    """
    if not slug:
        return slug

    slug = slug.strip()

    # --- Step 1: direct L-prefix / plain numeric ---
    stripped = slug.lstrip("Ll")
    try:
        return str(int(stripped))
    except ValueError:
        pass

    # --- Step 2: publisher-style "sanmin-5a-L02" -> "2" ---
    m = _PUBLISHER_RE.search(slug)
    if m:
        try:
            return str(int(m.group(1)))
        except ValueError:
            pass

    # --- Step 3: Chinese title lookup ---
    title_index = _get_title_index()
    if slug in title_index:
        return title_index[slug]

    # --- Fallback: return as-is ---
    return slug
