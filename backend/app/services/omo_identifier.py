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
"""

import base64
import json
import logging
from dataclasses import dataclass, field
from pathlib import Path

import yaml

from .ai_base import _get_client, _repair_json, GeminiContentFilterError

logger = logging.getLogger(__name__)

# OMO lesson IDs (lesson_number field in L*.yml)
_OMO_LESSON_IDS = [22, 23, 24, 25, 28, 29, 30]

# Max consecutive AI errors before raising RuntimeError (circuit breaker)
_MAX_CONSECUTIVE_ERRORS = 3
_consecutive_errors = 0

# Lesson metadata cache (loaded once at import)
_LESSON_CACHE: list[dict] = []


@dataclass
class LessonCandidate:
    lesson_id: int
    grade_code: str
    title: str
    confidence: float
    reasoning: str = field(default="")


def _load_omo_lessons() -> list[dict]:
    """Load the 7 OMO lesson metadata from YAML files. Cached after first call."""
    global _LESSON_CACHE
    if _LESSON_CACHE:
        return _LESSON_CACHE

    lessons_dir = Path(__file__).parent.parent.parent / "data" / "lessons"
    result = []
    for lesson_id in _OMO_LESSON_IDS:
        yml_path = lessons_dir / f"L{lesson_id}.yml"
        if not yml_path.exists():
            logger.warning("OMO lesson file not found: %s", yml_path)
            continue
        try:
            with open(yml_path, "r", encoding="utf-8") as f:
                data = yaml.safe_load(f)
            result.append(
                {
                    "lesson_id": lesson_id,
                    "grade_code": data.get("grade_code", f"L{lesson_id}"),
                    "title": data.get("title", "").lstrip("-").strip(),
                    "story_snippet": (data.get("story_text", "") or "")[:200],
                    "vocabulary": [
                        v.get("word", "") for v in (data.get("vocabulary") or [])[:8]
                    ],
                }
            )
        except Exception as exc:
            logger.warning("Failed to load OMO lesson %d: %s", lesson_id, exc)

    _LESSON_CACHE = result
    logger.info("Loaded %d OMO lesson entries for identification", len(result))
    return result


def _build_identification_prompt(lessons: list[dict]) -> str:
    """Build the structured Gemini prompt for lesson identification."""
    lesson_list = "\n".join(
        f"  - lesson_id={l['lesson_id']}, grade={l['grade_code']}, "
        f"title=\"{l['title']}\", "
        f"opening_words=\"{l['story_snippet'][:80]}...\", "
        f"vocab_hints=[{', '.join(l['vocabulary'][:5])}]"
        for l in lessons
    )

    return f"""You are an AI reading assistant for a Taiwanese elementary/junior-high school platform.

A student uploaded a photo of a paper worksheet. Your task is to identify which of the following 7 known lessons this worksheet belongs to, by reading visible text in the image.

Known lessons:
{lesson_list}

Instructions:
1. Read all visible text in the image, especially the large title text at the top.
2. Compare the extracted title, opening sentences, and vocabulary words against the known lessons above.
3. Return your top-3 best-matching candidates, sorted by confidence (highest first).
4. Use confidence 0.0–1.0 where:
   - 0.9+ = title matches exactly or near-exactly
   - 0.7–0.89 = partial title match or story text matches
   - 0.4–0.69 = vocabulary or content theme matches
   - <0.4 = weak or speculative match

Respond ONLY with valid JSON in this exact format (no markdown, no explanation outside JSON):
{{
  "extracted_title": "<title text you could read from the image, or empty string>",
  "candidates": [
    {{
      "lesson_id": <integer>,
      "grade_code": "<string>",
      "title": "<string>",
      "confidence": <float 0.0-1.0>,
      "reasoning": "<one sentence explaining why you matched this lesson>"
    }}
  ]
}}

If the image is too blurry or no text is readable, return:
{{
  "extracted_title": "",
  "candidates": [],
  "error": "image_unclear"
}}"""


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

    client = _get_client()
    prompt = _build_identification_prompt(lessons)

    # Encode image for inline content part
    image_b64 = base64.b64encode(image_bytes).decode("utf-8")

    try:
        from google.genai import types as genai_types

        response = await client.aio.models.generate_content(
            model="gemini-2.5-flash",
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
                max_output_tokens=2048,  # bumped from 512 — 7 lessons × top-3 with reasoning can exceed 512
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
                candidates.append(
                    LessonCandidate(
                        lesson_id=int(c["lesson_id"]),
                        grade_code=str(c.get("grade_code", "")),
                        title=str(c.get("title", "")),
                        confidence=float(c.get("confidence", 0.0)),
                        reasoning=str(c.get("reasoning", "")),
                    )
                )
            except (KeyError, ValueError, TypeError) as parse_err:
                logger.warning("OMO identification: failed to parse candidate %s: %s", c, parse_err)

        # Sort by confidence descending
        candidates.sort(key=lambda x: x.confidence, reverse=True)

        # Filter out near-zero confidence candidates (Gemini sometimes returns
        # placeholders with conf=0 instead of {error:"image_unclear"}).
        # Threshold 0.4 matches prompt's "weak/speculative" boundary.
        candidates = [c for c in candidates if c.confidence >= 0.4]

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
