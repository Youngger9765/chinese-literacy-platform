"""Dictionary API routes.

Provides endpoints to look up Chinese character definitions from the
MOE (Ministry of Education) dictionary with DB caching.

Auth: all endpoints require a valid JWT (get_current_user).
Rate limit: 60 req/min per user (DB-backed cache, not AI, so generous ceiling).
"""
import logging
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy.orm import Session

from ..database import get_db
from ..auth.dependencies import get_current_user
from ..auth.rate_limiter import make_general_rate_limit_dependency
from ..models.user import User
from ..services.dictionary_service import lookup_character, lookup_characters_batch

logger = logging.getLogger(__name__)

router = APIRouter(tags=["dictionary"])

# Rate limit: 60 req/min per authenticated user (generous; results are cached in DB)
_dict_rl = make_general_rate_limit_dependency(max_requests=60, window_seconds=60)


class DefinitionEntry(BaseModel):
    type: str
    definition: str
    examples: list[str]


class CharacterLookupResponse(BaseModel):
    character: str
    zhuyin: str | None
    stroke_count: int | None
    definitions: list[DefinitionEntry]
    cached: bool
    not_found: bool
    error: str | None = None


class BatchLookupRequest(BaseModel):
    characters: list[str]


class BatchLookupResponse(BaseModel):
    results: list[CharacterLookupResponse]


@router.get(
    "/dictionary/character/{character}",
    response_model=CharacterLookupResponse,
    summary="Look up a Chinese character",
    description=(
        "Returns zhuyin, stroke count, and definitions for a single Chinese character. "
        "Results are cached in the database after the first lookup."
    ),
)
def get_character(
    character: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    _rl: None = Depends(_dict_rl),
):
    """Look up a single Chinese character from MOE dictionary (cached)."""
    if len(character) != 1:
        raise HTTPException(
            status_code=422,
            detail="character path parameter must be exactly one character",
        )

    try:
        result = lookup_character(character, db)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc))
    except Exception:
        logger.exception("Unexpected error looking up character: %s", character)
        raise HTTPException(status_code=503, detail="Dictionary service temporarily unavailable")

    return CharacterLookupResponse(**result)


@router.get(
    "/dictionary/lookup",
    response_model=BatchLookupResponse,
    summary="Look up one or more Chinese characters via query string",
    description=(
        "Convenience GET endpoint for the dictionary page. "
        "Pass `chars=攻擊` to look up each character in the string (batch). "
        "Max 20 characters per request. Each character uses DB cache when available."
    ),
)
def lookup_chars(
    chars: str = Query(..., description="One or more Chinese characters, e.g. '攻擊'"),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    _rl: None = Depends(_dict_rl),
):
    """GET /dictionary/lookup?chars=XY — splits the string and batch-looks up each character."""
    char_list = [c for c in chars if c.strip()]
    if not char_list:
        raise HTTPException(status_code=422, detail="chars query parameter must not be empty")
    if len(char_list) > 20:
        raise HTTPException(status_code=422, detail="at most 20 characters per lookup request")

    # Deduplicate while preserving order
    seen: set[str] = set()
    unique_chars: list[str] = []
    for ch in char_list:
        if ch not in seen:
            seen.add(ch)
            unique_chars.append(ch)

    results = lookup_characters_batch(unique_chars, db)
    return BatchLookupResponse(
        results=[CharacterLookupResponse(**r) for r in results]
    )


@router.post(
    "/dictionary/batch",
    response_model=BatchLookupResponse,
    summary="Look up multiple Chinese characters",
    description=(
        "Batch lookup for up to 20 Chinese characters at once. "
        "Each character uses the cache when available."
    ),
)
def batch_lookup(
    payload: BatchLookupRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    _rl: None = Depends(_dict_rl),
):
    """Batch look up multiple Chinese characters (max 20)."""
    if not payload.characters:
        raise HTTPException(status_code=422, detail="characters list must not be empty")
    if len(payload.characters) > 20:
        raise HTTPException(status_code=422, detail="at most 20 characters per batch request")

    # Deduplicate while preserving order
    seen: set[str] = set()
    unique_chars: list[str] = []
    for ch in payload.characters:
        if ch not in seen:
            seen.add(ch)
            unique_chars.append(ch)

    results = lookup_characters_batch(unique_chars, db)
    return BatchLookupResponse(
        results=[CharacterLookupResponse(**r) for r in results]
    )
