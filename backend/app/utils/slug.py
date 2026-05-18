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

Grade-code (Layer-2 lesson_code, #1654):
    "G7-L30"         -> "1110"  (Layer-2 八哥, looked up via get_lesson_by_code)
    "G4-L1"          -> "<lesson_id>"
    Must be tried BEFORE _PUBLISHER_RE — otherwise the trailing "L30" of
    "G7-L30" matches and yields "30", colliding with Layer-1 lesson_number=30.

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

# ---------------------------------------------------------------------------
# Regex: Layer-2 grade_code, e.g. "G7-L30" / "G4-L01" / "G8-L03a" (#1654, #1669)
# Optional trailing a/b suffix handles curriculum sub-letter codes
# (G8-L03a/G8-L03b for stories that share a docx but have own learning paths).
# Must be tried before _PUBLISHER_RE to avoid mis-matching the trailing L\d+.
# ---------------------------------------------------------------------------
_GRADE_CODE_RE = re.compile(r"^G\d+-L\d+[ab]?$")


def normalize_story_slug(slug: str) -> str:
    """Normalize *slug* to canonical plain-number string.

    Resolution order
    ----------------
    1. Strip whitespace.
    2. Match Layer-2 grade_code (``^G\\d+-L\\d+$``) and resolve via
       ``get_lesson_by_code()`` — returns the integer lesson_id as string
       (#1654). Must run before step 4, otherwise the trailing ``L30`` of
       ``G7-L30`` is mis-extracted as ``"30"``.
    3. Strip leading "L"/"l" and try direct int parse (handles "L06" -> "6").
    4. Match publisher-style suffix "L<num>" (handles "sanmin-5a-L02" -> "2").
    5. Look up in the title catalogue (handles Chinese title slugs).
    6. Return original stripped value as safe fallback.
    """
    if not slug:
        return slug

    slug = slug.strip()

    # --- Step 1: Layer-2 grade_code lookup (#1654) ---
    # Run BEFORE _PUBLISHER_RE: "G7-L30" must resolve to lesson_id=1110
    # (八哥, Layer-2), not "30" (女性太空人登月, Layer-1).
    if _GRADE_CODE_RE.match(slug):
        try:
            # Local import avoids circular dependency with lesson_loader.
            from app.services.lesson_loader import get_lesson_by_code  # type: ignore[import]
            lesson = get_lesson_by_code(slug)
            if lesson and lesson.get("id") is not None:
                return str(lesson["id"])
        except Exception:
            # Catalogue unavailable (e.g. partial test env) — fall through
            # to legacy regex behaviour rather than 500.
            pass

    # --- Step 2: direct L-prefix / plain numeric ---
    stripped = slug.lstrip("Ll")
    try:
        return str(int(stripped))
    except ValueError:
        pass

    # --- Step 3: publisher-style "sanmin-5a-L02" -> "2" ---
    m = _PUBLISHER_RE.search(slug)
    if m:
        try:
            return str(int(m.group(1)))
        except ValueError:
            pass

    # --- Step 4: Chinese title lookup ---
    title_index = _get_title_index()
    if slug in title_index:
        return title_index[slug]

    # --- Fallback: return as-is ---
    return slug
