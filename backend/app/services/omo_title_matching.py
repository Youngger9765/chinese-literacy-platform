"""OMO title normalisation and fuzzy-match fallback.

Extracted from omo_identifier.py (#1886) — pure stdlib (difflib) title matching.
No Vertex AI dependency; safe to import in tests without GCP credentials.
"""

import difflib
import logging

from .omo_lesson_catalog import LessonCandidate, _load_curriculum_titles, _resolve_story_id

logger = logging.getLogger(__name__)

# Keep private cache alias so monkeypatching in tests targeting _CURRICULUM_TITLE_CACHE
# on this module also works.
_CURRICULUM_TITLE_CACHE: dict = {}  # local alias; actual cache lives in omo_lesson_catalog


def normalize_title(s: str) -> str:
    """Normalize punctuation for fuzzy matching.

    Covers two known mismatch classes:
    1. Half-width ASCII vs full-width CJK (e.g. '?' vs '？')
    2. Dash variants: YAML uses '──' (BOX DRAWINGS LIGHT HORIZONTAL U+2500×2)
       while Gemini OCR returns '——' (EM DASH U+2014×2). Collapse both to '—'.
    """
    return (
        s.replace("?", "？")
         .replace("!", "！")
         .replace(",", "，")
         .replace("──", "—")   # BOX DRAWINGS ×2 → em-dash
         .replace("——", "—")   # EM DASH ×2 → em-dash
         .replace("─", "—")    # single BOX DRAWINGS → em-dash
         .strip()
    )


# Private alias for backward-compat with existing call-sites in omo_identifier.py
_normalize_title = normalize_title


def fuzzy_match_title(extracted_title: str) -> list[LessonCandidate]:
    """Match extracted_title against all known curriculum titles using difflib.

    Args:
        extracted_title: Title string extracted by Gemini OCR.

    Returns:
        Up to 1 LessonCandidate:
        - ratio >= 0.85 → confidence 0.95
        - ratio 0.70-0.84 → confidence 0.70
        - ratio < 0.70 → empty list
    """
    if not extracted_title:
        return []

    # Honour monkeypatch on this module's _CURRICULUM_TITLE_CACHE if set in tests,
    # otherwise fall through to the canonical loader.
    curriculum = _CURRICULUM_TITLE_CACHE if _CURRICULUM_TITLE_CACHE else _load_curriculum_titles()
    if not curriculum:
        return []

    best_code = ""
    best_ratio = 0.0
    normalized_extracted = normalize_title(extracted_title)

    for code, info in curriculum.items():
        ratio = difflib.SequenceMatcher(
            None, normalized_extracted, normalize_title(info["title"])
        ).ratio()
        if ratio > best_ratio:
            best_ratio = ratio
            best_code = code

    if best_ratio < 0.70:
        logger.info(
            "Fuzzy match: extracted_title=%r best_ratio=%.3f < 0.70 — no match",
            extracted_title,
            best_ratio,
        )
        return []

    info = curriculum[best_code]
    confidence = 0.95 if best_ratio >= 0.85 else 0.70

    # lesson_id is the numeric part of the code (e.g. G5-L25 → 25)
    try:
        lesson_id = int(best_code.split("-L")[1])
    except (IndexError, ValueError):
        lesson_id = 0

    logger.info(
        "Fuzzy match: extracted_title=%r → %s %r ratio=%.3f conf=%.2f",
        extracted_title,
        best_code,
        info["title"],
        best_ratio,
        confidence,
    )
    resolved_grade_code = info["grade_code"]
    return [
        LessonCandidate(
            lesson_id=lesson_id,
            grade_code=resolved_grade_code,
            title=info["title"],
            confidence=confidence,
            reasoning=f"標題模糊匹配 ratio={best_ratio:.2f}",
            story_id=_resolve_story_id(resolved_grade_code),
        )
    ]


# Private alias for backward-compat
_fuzzy_match_title = fuzzy_match_title
