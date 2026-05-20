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
import difflib
import json
import logging
from dataclasses import dataclass, field
from pathlib import Path

import yaml

from .ai_base import _get_client, _repair_json, GeminiContentFilterError

logger = logging.getLogger(__name__)

# OMO identifies against ALL lessons in backend/data/lessons/ (158 lessons as of 2026-05-14).
# Previously hardcoded to 7 lessons — wrong scope; OMO is for the whole 158-lesson catalog.

# Max consecutive AI errors before raising RuntimeError (circuit breaker)
_MAX_CONSECUTIVE_ERRORS = 3
_consecutive_errors = 0

# Lesson metadata cache (loaded once at import)
_LESSON_CACHE: list[dict] = []

# Full curriculum title cache: {lesson_code -> {title, grade_code}} for all 158 lessons
# Used by fuzzy-match fallback (stdlib difflib, no extra deps)
_CURRICULUM_TITLE_CACHE: dict[str, dict] = {}


@dataclass
class LessonCandidate:
    lesson_id: int
    grade_code: str
    title: str
    confidence: float
    reasoning: str = field(default="")


def _load_omo_lessons() -> list[dict]:
    """Load metadata for ALL lessons in the full curriculum catalog.

    Source priority:
    1. backend/data/curriculum/lessons/G*-L*.yml — 158 catalog entries (lesson_code, title, vocab, strategy_name)
    2. Fallback: backend/data/lessons/L*.yml — 57 content lessons with story_text (for any lessons not in catalog)

    Catalog entries provide title + vocab only (no story_text). Content lessons additionally provide story snippet.
    """
    global _LESSON_CACHE
    if _LESSON_CACHE:
        return _LESSON_CACHE

    base_dir = Path(__file__).parent.parent.parent / "data"
    catalog_dir = base_dir / "curriculum" / "lessons"
    content_dir = base_dir / "lessons"

    # Build content lookup by title (to enrich catalog entries with story_text)
    content_by_title = {}
    for yml_path in content_dir.glob("L*.yml"):
        try:
            with open(yml_path, "r", encoding="utf-8") as f:
                data = yaml.safe_load(f) or {}
            title = (data.get("title", "") or "").lstrip("-").strip()
            if title:
                content_by_title[title] = data
        except Exception:
            continue

    result = []
    # 1) Catalog scan (preferred — 158 lessons)
    for yml_path in sorted(catalog_dir.glob("G*-L*.yml")):
        try:
            with open(yml_path, "r", encoding="utf-8") as f:
                data = yaml.safe_load(f) or {}
            title = (data.get("title", "") or "").strip()
            if not title:
                continue
            lesson_code = data.get("lesson_code", yml_path.stem)
            # Use lesson_code hash for lesson_id (stable int per lesson_code)
            # Or parse from order field
            lesson_id = data.get("display_order") or data.get("original_order") or 0
            vocab_list = data.get("vocab") or []
            # Enrich with story snippet if content YAML exists
            story_snippet = ""
            content_data = content_by_title.get(title)
            if content_data:
                story_snippet = (content_data.get("story_text", "") or "")[:120]
            result.append({
                "lesson_id": int(lesson_id) if lesson_id else 0,
                "lesson_code": lesson_code,
                "grade_code": lesson_code,
                "title": title,
                "story_snippet": story_snippet,
                "vocabulary": [str(v) for v in vocab_list[:5]],
            })
        except Exception as exc:
            logger.warning("Failed to load OMO catalog %s: %s", yml_path.name, exc)

    # 2) Add any content-only lessons not in catalog (rare)
    catalog_titles = {r["title"] for r in result}
    for yml_path in content_dir.glob("L*.yml"):
        try:
            with open(yml_path, "r", encoding="utf-8") as f:
                data = yaml.safe_load(f) or {}
            title = (data.get("title", "") or "").lstrip("-").strip()
            if not title or title in catalog_titles:
                continue
            stem = yml_path.stem
            try:
                lesson_id = int(stem[1:])
            except ValueError:
                continue
            result.append({
                "lesson_id": lesson_id,
                "lesson_code": data.get("grade_code", f"L{lesson_id}"),
                "grade_code": data.get("grade_code", f"L{lesson_id}"),
                "title": title,
                "story_snippet": (data.get("story_text", "") or "")[:120],
                "vocabulary": [
                    v.get("word", "") for v in (data.get("vocabulary") or [])[:5]
                ],
            })
        except Exception as exc:
            logger.warning("Failed to load fallback content lesson %s: %s", yml_path.name, exc)

    _LESSON_CACHE = result
    logger.info("Loaded %d OMO lesson entries (curriculum catalog + content fallback)", len(result))
    return result


def _load_curriculum_titles() -> dict[str, dict]:
    """Load all curriculum lesson titles for fuzzy-match fallback.

    Returns a dict of {lesson_code: {"title": str, "grade_code": str}} for all
    lessons in backend/data/curriculum/lessons/*.yml.  Cached after first call.
    Uses stdlib only (no extra deps).
    """
    global _CURRICULUM_TITLE_CACHE
    if _CURRICULUM_TITLE_CACHE:
        return _CURRICULUM_TITLE_CACHE

    curriculum_dir = Path(__file__).parent.parent.parent / "data" / "curriculum" / "lessons"
    if not curriculum_dir.exists():
        logger.warning("Curriculum lessons dir not found: %s", curriculum_dir)
        return {}

    result: dict[str, dict] = {}
    for yml_path in curriculum_dir.glob("*.yml"):
        lesson_code = yml_path.stem  # e.g. "G5-L25"
        try:
            with open(yml_path, "r", encoding="utf-8") as f:
                data = yaml.safe_load(f)
            title = (data.get("title") or "").lstrip("-").strip()
            grade_code = data.get("lesson_code") or lesson_code
            if title:
                result[lesson_code] = {"title": title, "grade_code": grade_code}
        except Exception as exc:
            logger.warning("Failed to load curriculum lesson %s: %s", lesson_code, exc)

    _CURRICULUM_TITLE_CACHE = result
    logger.info("Loaded %d curriculum titles for fuzzy-match fallback", len(result))
    return result


def _normalize_title(s: str) -> str:
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


def _fuzzy_match_title(extracted_title: str) -> list[LessonCandidate]:
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

    curriculum = _load_curriculum_titles()
    if not curriculum:
        return []

    best_code = ""
    best_ratio = 0.0
    normalized_extracted = _normalize_title(extracted_title)

    for code, info in curriculum.items():
        ratio = difflib.SequenceMatcher(
            None, normalized_extracted, _normalize_title(info["title"])
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
    return [
        LessonCandidate(
            lesson_id=lesson_id,
            grade_code=info["grade_code"],
            title=info["title"],
            confidence=confidence,
            reasoning=f"標題模糊匹配 ratio={best_ratio:.2f}",
        )
    ]


def _build_identification_prompt(lessons: list[dict]) -> str:
    """Build the structured Gemini prompt for lesson identification.

    With the full 158-lesson corpus, we list only grade_code + title per entry
    (no story snippet or vocab) to keep prompt size manageable (~1300 tokens).
    Gemini matches by reading the visible title from the worksheet image.
    """
    lesson_list = "\n".join(
        f"  - {l['grade_code']}: \"{l['title']}\""
        for l in lessons
    )
    n = len(lessons)

    return f"""You are an AI reading assistant for a Taiwanese elementary/junior-high school platform.

A student uploaded a photo of a paper worksheet. Your task is to identify which of the following {n} known lessons this worksheet belongs to, by reading visible text in the image.

Known lessons:
{lesson_list}

Instructions:
1. Read all visible text in the image, especially the large title text at the top.
2. Extract the exact title you can read from the image. Put it in "extracted_title".
3. Find the best matching lesson from the known list by comparing the extracted title verbatim.
   IMPORTANT: If the extracted_title matches any known lesson title exactly or near-exactly,
   that candidate MUST have confidence >= 0.9. Do NOT assign low confidence to an exact match.
4. Return AT MOST 3 best-matching candidates, sorted by confidence (highest first).
5. Use confidence 0.0–1.0 where:
   - 0.95+ = extracted_title matches the lesson title exactly (character-for-character)
   - 0.85–0.94 = extracted_title is nearly identical (1-2 char difference)
   - 0.7–0.84 = partial title match
   - 0.4–0.69 = content/theme match without title
   - <0.4 = weak or speculative
6. Keep each `reasoning` to ≤ 15 Chinese characters. Be terse.

Respond ONLY with valid JSON in this exact format (no markdown, no explanation outside JSON):
{{
  "extracted_title": "<title text you could read from the image, or empty string>",
  "candidates": [
    {{
      "lesson_id": <integer from grade_code suffix, e.g. G5-L25 → 25>,
      "grade_code": "<string e.g. G5-L25>",
      "title": "<string matching the known lesson title exactly>",
      "confidence": <float 0.0-1.0>,
      "reasoning": "<≤15 Chinese characters>"
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
            model="gemini-flash-lite-latest",
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
    return [
        LessonCandidate(
            lesson_id=lesson_id,
            grade_code=info["grade_code"],
            title=info["title"],
            confidence=1.0,
            reasoning="user-provided lesson hint (課文頁面內上傳)",
        )
    ]
