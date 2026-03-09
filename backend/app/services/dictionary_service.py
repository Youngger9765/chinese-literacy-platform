"""MOE Dictionary Service

Queries the Ministry of Education (MOE) public dictionary API at
https://www.moedict.tw/ and caches results in the database.

API format (moedict):
  GET /a/{character}.json
  Response includes heteronyms (讀音), each with definitions containing:
    - "b" field: zhuyin (注音)
    - "d" array: definition entries with "f" (definition text), "type" (part of speech)
    - "e" array: example sentences

  Text uses backtick (~) markup to indicate ruby annotations (zhuyin).
  We strip these markers for plain-text display.
"""

import logging
import re
import httpx
from datetime import datetime, timezone
from sqlalchemy.orm import Session

from ..models.dictionary import DictionaryCache

logger = logging.getLogger(__name__)

MOE_API_BASE = "https://www.moedict.tw"
REQUEST_TIMEOUT = 8.0  # seconds


def _strip_markup(text: str) -> str:
    """Remove moedict backtick (~) ruby markup from text.

    Moedict uses `` ` `` to open a ruby annotation and ``~`` to close it.
    Example: "`陸地~`上~`高~`起~`的~`部分~" → "陸地上高起的部分"
    """
    # Remove backtick-marker pairs: `word~ → word
    cleaned = re.sub(r'`([^`~]*?)~', r'\1', text)
    # Remove any remaining stray backticks or tildes
    cleaned = cleaned.replace('`', '').replace('~', '')
    return cleaned.strip()


def _parse_moe_response(raw: dict) -> dict:
    """Parse the raw moedict API response into a structured dict.

    Returns:
        {
            "zhuyin": "ㄕㄢ",
            "stroke_count": 3,
            "definitions": [
                {"type": "名", "definition": "陸地上高起的部分。", "example": "..."},
                ...
            ]
        }
    """
    heteronyms = raw.get("h", [])
    if not heteronyms:
        return {"zhuyin": None, "stroke_count": None, "definitions": []}

    # Use the first heteronym (most common reading)
    first = heteronyms[0]
    zhuyin = first.get("b", None)

    # Stroke count is stored under "c" at the top level
    stroke_count = raw.get("c", None)
    if stroke_count is not None:
        try:
            stroke_count = int(stroke_count)
        except (ValueError, TypeError):
            stroke_count = None

    definitions = []
    for entry in first.get("d", []):
        definition_text = _strip_markup(entry.get("f", ""))
        part_of_speech = _strip_markup(entry.get("type", ""))

        # Collect example sentences
        examples = [_strip_markup(ex) for ex in entry.get("q", [])]
        # Also include inline examples from "e" field
        inline_examples = [_strip_markup(ex) for ex in entry.get("e", [])]
        all_examples = examples + inline_examples

        if definition_text:
            definitions.append({
                "type": part_of_speech,
                "definition": definition_text,
                "examples": all_examples,
            })

    return {
        "zhuyin": zhuyin,
        "stroke_count": stroke_count,
        "definitions": definitions,
    }


def _fetch_from_api(character: str) -> dict | None:
    """Fetch character data from MOE dictionary API.

    Returns parsed data dict or None if the character was not found.
    Raises httpx.HTTPError on network/server errors.
    """
    url = f"{MOE_API_BASE}/a/{character}.json"
    try:
        response = httpx.get(url, timeout=REQUEST_TIMEOUT, follow_redirects=True)
    except httpx.TimeoutException:
        logger.warning("MOE API timeout for character: %s", character)
        raise
    except httpx.RequestError as exc:
        logger.warning("MOE API request error for %s: %s", character, exc)
        raise

    if response.status_code == 404:
        logger.info("MOE API: character not found: %s", character)
        return None

    response.raise_for_status()

    try:
        raw = response.json()
    except Exception:
        logger.warning("MOE API returned invalid JSON for: %s", character)
        return None

    return raw


def lookup_character(character: str, db: Session) -> dict:
    """Look up a Chinese character, using DB cache when available.

    Args:
        character: Single Chinese character to look up.
        db: SQLAlchemy database session.

    Returns:
        Dict with keys: character, zhuyin, stroke_count, definitions, cached, not_found.

    Raises:
        ValueError: If character is empty or not a single CJK character.
    """
    if not character or len(character) != 1:
        raise ValueError("character must be a single Chinese character")

    # 1. Check cache
    cached = (
        db.query(DictionaryCache)
        .filter(
            DictionaryCache.character == character,
            DictionaryCache.source == "moedict",
        )
        .first()
    )

    if cached is not None:
        logger.debug("Dictionary cache hit for: %s", character)
        return {
            "character": character,
            "zhuyin": cached.zhuyin,
            "stroke_count": cached.stroke_count,
            "definitions": cached.definitions or [],
            "cached": True,
            "not_found": bool(cached.not_found),
        }

    # 2. Fetch from API
    logger.info("Dictionary cache miss, fetching from MOE API: %s", character)
    raw = None
    parsed = None
    not_found = False
    import json as json_mod

    try:
        raw = _fetch_from_api(character)
        if raw is None:
            not_found = True
            parsed = {"zhuyin": None, "stroke_count": None, "definitions": []}
        else:
            parsed = _parse_moe_response(raw)
    except Exception as exc:
        # API unavailable — return empty result without caching
        logger.error("MOE API error for %s, returning empty fallback: %s", character, exc)
        return {
            "character": character,
            "zhuyin": None,
            "stroke_count": None,
            "definitions": [],
            "cached": False,
            "not_found": False,
            "error": "dictionary_unavailable",
        }

    # 3. Store in cache
    try:
        entry = DictionaryCache(
            character=character,
            source="moedict",
            zhuyin=parsed["zhuyin"],
            stroke_count=parsed["stroke_count"],
            definitions=parsed["definitions"],
            raw_response=json_mod.dumps(raw, ensure_ascii=False) if raw else None,
            not_found=not_found,
            fetched_at=datetime.now(timezone.utc),
        )
        db.add(entry)
        db.commit()
        db.refresh(entry)
        logger.info("Cached dictionary entry for: %s (not_found=%s)", character, not_found)
    except Exception as exc:
        logger.warning("Failed to cache dictionary entry for %s: %s", character, exc)
        db.rollback()

    return {
        "character": character,
        "zhuyin": parsed["zhuyin"],
        "stroke_count": parsed["stroke_count"],
        "definitions": parsed["definitions"],
        "cached": False,
        "not_found": not_found,
    }


def lookup_characters_batch(characters: list[str], db: Session) -> list[dict]:
    """Look up multiple characters, using cache for each.

    Args:
        characters: List of single Chinese characters.
        db: SQLAlchemy database session.

    Returns:
        List of lookup results in the same order as input.
    """
    results = []
    for ch in characters:
        try:
            result = lookup_character(ch, db)
        except ValueError as exc:
            logger.warning("Invalid character in batch lookup: %r — %s", ch, exc)
            result = {
                "character": ch,
                "zhuyin": None,
                "stroke_count": None,
                "definitions": [],
                "cached": False,
                "not_found": True,
                "error": str(exc),
            }
        results.append(result)
    return results
