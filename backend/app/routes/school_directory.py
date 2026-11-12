"""MOE school directory search (#3804 §4.2).

GET /api/schools/directory/search?county=&q=

Deliberately a separate route file from schools.py: this endpoint opens the
full MOE-sourced directory to ANY authenticated caller (not just members of
a given school), which is why it returns a narrower field set
(SchoolDirectoryItem — no join_code, no organization_id) than the
membership-scoped schools.py endpoints. Keeping it in its own file also
keeps this PR's diff off schools.py, which another in-flight branch
(feat/issue-3804-self-serve-teacher) is also touching.

Auth: any authenticated user (Depends(get_current_user)) — this is a public
reference directory, not school-scoped data.
Rate limit: 30 req/min per user (DB query only, no AI call on the hot path;
same ceiling as dictionary.py's similarly cheap, cached lookup).
"""
import logging

from fastapi import APIRouter, Depends, Query, Request
from sqlalchemy.orm import Session

from ..auth.dependencies import get_current_user
from ..auth.rate_limiter import ai_rate_limiter, get_client_key, make_general_rate_limit_dependency
from ..database import get_db
from ..models.school import School
from ..models.user import User
from ..schemas.school import SchoolDirectoryItem, SchoolDirectorySearchResponse, SchoolNameSuggestion
from ..services.moe_school_suggest import suggest_school_names
from ..services.school_directory_search import normalize_school_name, search_school_directory

logger = logging.getLogger(__name__)

router = APIRouter(tags=["school-directory"])

# Rate limit: 30 req/min per authenticated user (plain DB query, no AI on
# the hot path — only the rare 0-match fallback below calls an LLM, and
# that has its own, tighter, separate budget).
_search_rl = make_general_rate_limit_dependency(max_requests=30, window_seconds=60, name="school-directory-search")

# Separate, tighter budget for the LLM suggestion fallback specifically
# (llm-endpoint-hardening Rule 1: rate-limit is the last check before the
# expensive call — this only runs when fuzzy matching already found 0
# results, so it never competes with the cheap path above for budget).
_SUGGEST_MAX_PER_MINUTE = 5


def _filter_suggestions_to_county(
    db: Session, county: str, suggestions: list[SchoolNameSuggestion]
) -> list[SchoolNameSuggestion]:
    """#3817 — the LLM "did you mean" fallback has no idea a county was
    even selected (it only ever sees the raw query string), so it can
    suggest a real school from a completely different county (the reported
    bug: a 台北市-scoped search suggested a 臺中市 school).

    This is a deterministic, DB-backed filter applied AFTER the LLM call —
    it holds even if the LLM ignores a county hint in its prompt, which a
    prompt-only fix cannot guarantee (EDD: LLM output is not reliable
    enough on its own to be the lock; a prompt-wording fix would still
    deserve to exist for quality, but correctness must come from here).
    """
    if not suggestions:
        return suggestions
    norm_county = normalize_school_name(county)
    valid_names = {
        normalize_school_name(name)
        for (name,) in db.query(School.name)
        .filter(School.moe_school_code.isnot(None), School.county_name == norm_county)
        .all()
    }
    return [s for s in suggestions if normalize_school_name(s.school_name) in valid_names]


@router.get("/schools/directory/search", response_model=SchoolDirectorySearchResponse)
async def search_school_directory_route(
    request: Request,
    county: str | None = Query(None, max_length=50),
    q: str | None = Query(None, max_length=100),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
    _rl: None = Depends(_search_rl),
):
    """Search the MOE school directory. Fuzzy-matches `q` against normalized
    school names (typos and common abbreviations both work — see
    app/services/school_directory_search.py). When `q` is given and fuzzy
    matching finds nothing, falls back to an LLM "did you mean" suggestion
    (fails silently — a suggestion failure never turns a successful,
    zero-result search into an error response).
    """
    results = search_school_directory(db, county=county, q=q)
    items = [SchoolDirectoryItem.model_validate(school) for school, _score in results]

    suggestions: list[SchoolNameSuggestion] | None = None
    if q and q.strip() and not items:
        rl_key = f"ai:{get_client_key(request)}"
        if ai_rate_limiter.check(rl_key, max_requests=_SUGGEST_MAX_PER_MINUTE, window_seconds=60):
            raw_suggestions = await suggest_school_names(q, county=county)
            suggestions = [SchoolNameSuggestion(**s) for s in raw_suggestions]
            if county:
                suggestions = _filter_suggestions_to_county(db, county, suggestions)
        else:
            logger.info("school_name_suggest rate-limited for key=%s", rl_key)
            suggestions = []

    return SchoolDirectorySearchResponse(
        items=items,
        total=len(items),
        suggestions=suggestions,
    )
