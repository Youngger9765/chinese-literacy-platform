"""MOE school directory search — normalize + fuzzy match (#3804 §4.2).

Only searches schools imported from the official MOE directory
(moe_school_code IS NOT NULL) — domain-auto-created / manually-created
schools never appear here (PRD #3804 §4.2 "Young 的問題 2 答覆").

Two layers:
  normalize_school_name() — collapse ownership prefixes / 國民X學 long form /
    traditional-simplified variant / full-width-half-width & whitespace so a
    user's raw text compares fairly against the source's official form.
  similarity_score()      — character-level fuzzy match (difflib), boosted
    for substring containment (handles abbreviations like querying "大安"
    for "大安國小").

search_school_directory() is the one thing the route calls.
"""
from __future__ import annotations

import difflib
import re
import unicodedata

from sqlalchemy.orm import Session

from ..models.school import School

FUZZY_MATCH_THRESHOLD = 0.6
MAX_RESULTS = 20

_TRAD_TO_SIMP_VARIANT = {"臺": "台"}

# Order matters: expand the long official form to the short one BEFORE
# stripping ownership prefixes, so "市立大安國民小學" -> "市立大安國小" ->
# "大安國小" in that order (stripping first would still work here, but
# expanding first keeps the two transformations independent and testable).
_LEVEL_EXPAND = [
    ("國民小學", "國小"),
    ("國民中學", "國中"),
]

_OWNERSHIP_PREFIXES = ["市立", "縣立", "私立", "國立", "公立"]


def normalize_school_name(raw: str | None) -> str:
    """Collapse a school name (or a user's typed query) to a comparable form.

    - NFKC: full-width -> half-width characters, compatibility forms
    - 臺 -> 台 (two canonically distinct Han characters, NOT a width
      variant, so NFKC does not touch this — must be done explicitly)
    - 國民小學 -> 國小, 國民中學 -> 國中
    - strip 市立/縣立/私立/國立/公立 ownership prefixes
    - strip all whitespace (half-width and full-width U+3000)
    """
    if not raw:
        return ""

    s = unicodedata.normalize("NFKC", raw)
    for trad, simp in _TRAD_TO_SIMP_VARIANT.items():
        s = s.replace(trad, simp)
    for long_form, short_form in _LEVEL_EXPAND:
        s = s.replace(long_form, short_form)
    for prefix in _OWNERSHIP_PREFIXES:
        s = s.replace(prefix, "")
    s = re.sub(r"\s+", "", s)
    return s


def similarity_score(norm_query: str, norm_name: str) -> float:
    """Character-level fuzzy match score in [0, 1].

    Plain difflib ratio handles typos (one substituted character in a
    4-character name scores ~0.75, comfortably above
    FUZZY_MATCH_THRESHOLD=0.6, while two unrelated names that merely share
    a common suffix like "國小" score ~0.5, below it).

    Containment is boosted separately because an abbreviation (querying
    "大安" for "大安國小") has a legitimately low raw ratio (0.67) that we
    still want to treat as a strong match — it's not noise, it's a
    strict substring relationship.
    """
    if not norm_query or not norm_name:
        return 0.0

    ratio = difflib.SequenceMatcher(None, norm_query, norm_name).ratio()
    if norm_query in norm_name or norm_name in norm_query:
        ratio = max(ratio, 0.85)
    return ratio


def search_school_directory(
    db: Session,
    county: str | None,
    q: str | None,
    limit: int = MAX_RESULTS,
) -> list[tuple[School, float]]:
    """Search the MOE directory. Returns (School, score) tuples sorted by
    score descending. Only rows with moe_school_code set are candidates.

    county filters on the normalized county_name (handles 臺/台 variant on
    the caller's input too) — NOT on county_code, which is not a stable
    county key (see backend/data/moe_schools/README.md).
    """
    query = db.query(School).filter(School.moe_school_code.isnot(None))

    if county:
        norm_county = normalize_school_name(county)
        query = query.filter(School.county_name == norm_county)

    candidates = query.all()

    if not q or not q.strip():
        return [(c, 1.0) for c in candidates[:limit]]

    norm_q = normalize_school_name(q)
    scored = []
    for candidate in candidates:
        norm_name = normalize_school_name(candidate.name)
        score = similarity_score(norm_q, norm_name)
        if score >= FUZZY_MATCH_THRESHOLD:
            scored.append((candidate, score))

    scored.sort(key=lambda pair: pair[1], reverse=True)
    return scored[:limit]
