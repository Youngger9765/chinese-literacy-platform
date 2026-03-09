"""Dictionary API routes.

Provides endpoints to look up Chinese character definitions from the
MOE (Ministry of Education) dictionary with DB caching.
"""
import logging
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy.orm import Session

from ..database import get_db
from ..services.dictionary_service import lookup_character, lookup_characters_batch

logger = logging.getLogger(__name__)

router = APIRouter(tags=["dictionary"])


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
