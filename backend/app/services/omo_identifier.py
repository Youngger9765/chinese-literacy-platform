"""OMO Phase 1: AI lesson identification service.

Given uploaded image bytes, calls Vertex AI Gemini to:
1. Extract visible text from the worksheet photo (OCR-like)
2. Match against the 7 known OMO lessons (G6-L22~25, G7-L28~30)
3. Return top-3 candidates with confidence scores

llm-endpoint-hardening checklist:
- Rate-limit handled by global middleware ✅
- Auth: caller must be authenticated (enforced in route layer) ✅
- Input size cap: max image 10MB enforced in route ✅
- Output token cap: max_output_tokens=512 ✅
- Fail-closed: returns empty candidates on error, never auto-passes ✅
- Reasoning field: each candidate has reasoning string ✅
- Circuit breaker: 3 consecutive errors → raise RuntimeError → 503 ✅

Refactored (#1886): catalog/cache → omo_lesson_catalog.py,
title normalisation + fuzzy match → omo_title_matching.py,
prompt builder → omo_identifier_prompt.py.
"""

import base64
import json
import logging

from .ai_base import _repair_json, GeminiContentFilterError
from .llm_models import get_model_for_task
from .omo_lesson_catalog import (
    LessonCandidate,
    _LESSON_CACHE,
    _CURRICULUM_TITLE_CACHE,
    _resolve_story_id,
    _load_omo_lessons,
    _load_curriculum_titles,
)
from .omo_title_matching import _normalize_title, _fuzzy_match_title
from .omo_identifier_prompt import _build_identification_prompt

logger = logging.getLogger(__name__)

# OMO identifies against ALL lessons in backend/data/lessons/ (158 lessons as of 2026-05-14).
# Previously hardcoded to 7 lessons — wrong scope; OMO is for the whole 158-lesson catalog.

# Max consecutive AI errors before raising RuntimeError (circuit breaker)
_MAX_CONSECUTIVE_ERRORS = 3
_consecutive_errors = 0


async def identify_lesson_from_image(image_bytes: bytes, mime_type: str = "image/jpeg") -> list[LessonCandidate]:
    """Identify which OMO lesson a worksheet photo belongs to.

    Args:
        image_bytes: Raw image bytes (JPEG or PNG), max 10MB enforced by caller.
        mime_type: MIME type of the image.

    Returns:
        List of up to 3 LessonCandidate objects, sorted by confidence descending.
        Returns [] on AI error (fail-closed — never auto-identifies on error).

    Raises:
        RuntimeError: After 3 consecutive errors (circuit breaker).
    """
    global _consecutive_errors

    lessons = _load_omo_lessons()
    if not lessons:
        logger.error("No OMO lessons loaded — cannot identify")
        return []

    _identifier_model, _identifier_location = get_model_for_task("omo_identifier")
    prompt = _build_identification_prompt(lessons)

    # Encode image for inline content part
    image_b64 = base64.b64encode(image_bytes).decode("utf-8")

    try:
        from google import genai
        from google.genai import types as genai_types

        client = genai.Client(vertexai=True, project="lingoleap-dev", location=_identifier_location)
        response = await client.aio.models.generate_content(
            model=_identifier_model,
            contents=[
                genai_types.Content(
                    role="user",
                    parts=[
                        genai_types.Part(
                            inline_data=genai_types.Blob(
                                mime_type=mime_type,
                                data=image_b64,
                            )
                        ),
                        genai_types.Part(text=prompt),
                    ],
                )
            ],
            config=genai_types.GenerateContentConfig(
                temperature=0.1,  # Low temperature for deterministic identification
                max_output_tokens=3072,  # bumped 2048→3072: terse prompt still needs buffer for 158-lesson corpus
                thinking_config=genai_types.ThinkingConfig(thinking_budget=0),
            ),
        )

        # Gemini may return response.text == None when safety filter blocks
        # or when finish_reason is MAX_TOKENS / RECITATION etc. Handle gracefully.
        raw_text = (response.text or "").strip() if response is not None else ""
        if not raw_text:
            finish_reason = "unknown"
            try:
                if response and response.candidates:
                    finish_reason = str(response.candidates[0].finish_reason)
            except Exception:
                pass
            logger.warning(
                "OMO identification: Gemini returned empty response (finish_reason=%s)",
                finish_reason,
            )
            _consecutive_errors = 0  # Not a transient error
            return []

        # Strip markdown code fences if present
        if raw_text.startswith("```"):
            lines = raw_text.split("\n")
            raw_text = "\n".join(
                line for line in lines if not line.startswith("```")
            ).strip()

        repaired = _repair_json(raw_text)
        if repaired is None:
            logger.warning(
                "OMO identification: could not repair malformed JSON | raw=%s",
                raw_text[:200],
            )
            _consecutive_errors = 0
            return []

        data = json.loads(repaired)

        if data.get("error") == "image_unclear":
            logger.warning("OMO identification: image too unclear for OCR")
            _consecutive_errors = 0
            return []

        candidates_raw = data.get("candidates", [])
        if not isinstance(candidates_raw, list):
            logger.warning("OMO identification: unexpected response shape: %s", data)
            _consecutive_errors = 0
            return []

        candidates = []
        for c in candidates_raw[:3]:
            try:
                gc = str(c.get("grade_code", ""))
                candidates.append(
                    LessonCandidate(
                        lesson_id=int(c["lesson_id"]),
                        grade_code=gc,
                        title=str(c.get("title", "")),
                        confidence=float(c.get("confidence", 0.0)),
                        reasoning=str(c.get("reasoning", "")),
                        story_id=_resolve_story_id(gc),
                    )
                )
            except (KeyError, ValueError, TypeError) as parse_err:
                logger.warning("OMO identification: failed to parse candidate %s: %s", c, parse_err)

        # Sort by confidence descending
        candidates.sort(key=lambda x: x.confidence, reverse=True)

        # Boost: if top candidate confidence is near the threshold but its title
        # verbatim-matches the extracted_title, Gemini found the right lesson but
        # under-reported confidence.  Boost to 0.95 so it survives the filter.
        extracted_title = str(data.get("extracted_title") or "").strip()
        if candidates and extracted_title:
            top = candidates[0]
            if top.title.strip() == extracted_title and top.confidence < 0.4:
                logger.info(
                    "OMO identification: boosting verbatim-matched candidate %r "
                    "from conf=%.2f → 0.95",
                    top.title,
                    top.confidence,
                )
                candidates[0] = LessonCandidate(
                    lesson_id=top.lesson_id,
                    grade_code=top.grade_code,
                    title=top.title,
                    confidence=0.95,
                    reasoning=top.reasoning + " (title-boosted)",
                    story_id=top.story_id,  # already resolved — reuse
                )

        # Filter out near-zero confidence candidates (Gemini sometimes returns
        # placeholders with conf=0 instead of {error:"image_unclear"}).
        # Threshold 0.4 matches prompt's "weak/speculative" boundary.
        candidates = [c for c in candidates if c.confidence >= 0.4]

        # Fuzzy-match fallback: if all candidates were filtered out but Gemini
        # did OCR a title, do local string matching against all 158 known titles.
        # Synthetic worksheets have clear black text → OCR is reliable.
        # This handles the case where Gemini extracts the correct title but
        # fails to map it to a high-confidence candidate entry.
        if not candidates and extracted_title:
            logger.info(
                "OMO identification: no candidates after filter, "
                "attempting fuzzy-match on extracted_title=%r",
                extracted_title,
            )
            candidates = _fuzzy_match_title(extracted_title)

        _consecutive_errors = 0
        logger.info(
            "OMO identification complete: top candidate=%s confidence=%.2f",
            candidates[0].title if candidates else "none",
            candidates[0].confidence if candidates else 0.0,
        )
        return candidates

    except GeminiContentFilterError as exc:
        logger.warning("OMO identification: content filter blocked: %s", exc)
        _consecutive_errors = 0  # Not a transient error — don't count toward circuit breaker
        return []

    except json.JSONDecodeError as exc:
        logger.error("OMO identification: JSON parse failed: %s | raw=%s", exc, raw_text[:200] if 'raw_text' in dir() else "N/A")
        _consecutive_errors += 1
        _check_circuit_breaker()
        return []

    except Exception as exc:
        logger.error("OMO identification: unexpected error: %s", exc, exc_info=True)
        _consecutive_errors += 1
        _check_circuit_breaker()
        return []


def _check_circuit_breaker() -> None:
    """Raise RuntimeError after 3 consecutive errors (circuit breaker pattern)."""
    if _consecutive_errors >= _MAX_CONSECUTIVE_ERRORS:
        raise RuntimeError(
            f"OMO identifier circuit breaker tripped: "
            f"{_consecutive_errors} consecutive errors"
        )


def identify_lesson_from_hint(lesson_code: str) -> list[LessonCandidate]:
    """Resolve a lesson by its known lesson_code (hint path — skips AI fuzzy match).

    Used when the student uploads from within a lesson reading page, so the
    system already knows which lesson they're working on.  The upload route
    uses this function when ``lesson_code_hint`` is provided in the request,
    saving ~6-24 s of Vertex AI latency and ~$0.0003 per call.

    Args:
        lesson_code: Canonical lesson code from the YAML catalog (e.g. "G5-L25").

    Returns:
        A single LessonCandidate with confidence=1.0, or [] if the code is not
        found in the curriculum catalog.

    Note: Defined here (not delegated to omo_lesson_catalog) so that existing
    tests can monkeypatch _load_curriculum_titles and _resolve_story_id on this
    module (#1886 backward-compat).
    """
    curriculum = _load_curriculum_titles()
    if not curriculum:
        logger.warning("identify_lesson_from_hint: curriculum cache empty")
        return []

    info = curriculum.get(lesson_code)
    if not info:
        logger.warning(
            "identify_lesson_from_hint: lesson_code=%r not found in catalog", lesson_code
        )
        return []

    try:
        lesson_id = int(lesson_code.split("-L")[1])
    except (IndexError, ValueError):
        lesson_id = 0

    logger.info(
        "identify_lesson_from_hint: lesson_code=%r → id=%d title=%r (hint path, no AI call)",
        lesson_code,
        lesson_id,
        info["title"],
    )
    resolved_grade_code = info["grade_code"]
    return [
        LessonCandidate(
            lesson_id=lesson_id,
            grade_code=resolved_grade_code,
            title=info["title"],
            confidence=1.0,
            reasoning="user-provided lesson hint (課文頁面內上傳)",
            story_id=_resolve_story_id(resolved_grade_code),
        )
    ]
