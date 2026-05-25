"""OMO grading service — orchestration facade for worksheet image grading.

Uses Vertex AI Gemini (gemini-2.5-flash) with structured output to:
  1. Analyse worksheet image(s) against the lesson YAML schema
  2. Extract fill_in_blank / MCQ / self_check answers
  3. Compare against correct answers from lesson YAML
  4. Return per-question scores with ai_confidence + reasoning

llm-endpoint-hardening checklist (applied in calling route, not here):
- Rate-limit: enforced at route level ✅
- Auth: enforced at route level ✅
- Input size cap: 10MB per image checked before calling this ✅
- Output token cap: max_output_tokens=2048 ✅
- Fail-closed: returns status=error on failure, never auto-passes ✅
- Reasoning field: every answer item has a reasoning string ✅

Circuit breaker: 3 consecutive errors → RuntimeError (same pattern as omo_identifier)

Extracted helpers (issue #1879):
  omo_question_schema  — schema extraction + OCR prompt building
  omo_scoring          — pure-Python answer scoring + anti-fabrication
  omo_image_preprocess — landscape spread splitting
  omo_crop_upload      — GCS crop upload
"""

import asyncio
import logging
from dataclasses import dataclass
from typing import Optional

from .llm_models import get_model_for_task
from .omo_question_schema import _build_question_schema, _build_grading_prompt
from .omo_scoring import _score_answer, _validate_student_answer, _LOW_CONFIDENCE_THRESHOLD
from .omo_image_preprocess import _split_spread
from .omo_crop_upload import _crop_and_upload, _crop_and_upload_answer_image  # noqa: F401

logger = logging.getLogger(__name__)

# Circuit breaker state (module-level singleton, per-process)
_consecutive_errors = 0
_CIRCUIT_BREAKER_THRESHOLD = 3


@dataclass
class GradedAnswer:
    """Result for one question extracted from the worksheet image."""
    question_id: str
    student_answer: str
    correct_answer: str
    score: float          # 0.0 – 1.0
    ai_confidence: float  # 0.0 – 1.0
    reasoning: str
    position: Optional[dict] = None   # {"x": float, "y": float} relative coords
    crop_image_url: Optional[str] = None
    source_attempt_id: Optional[int] = None


async def grade_worksheet_images(
    image_bytes_list: list[bytes],
    mime_types: list[str],
    lesson: dict,
    attempt_id: Optional[int] = None,
    upload_id: Optional[int] = None,
) -> list[GradedAnswer]:
    """Grade worksheet images against the lesson YAML schema.

    Args:
        image_bytes_list: List of raw image bytes (all active attempt images).
        mime_types: Corresponding MIME types.
        lesson: Lesson dict from lesson_loader (contains fill_in_blank, MCQ, etc.).
        attempt_id: The OmoUploadAttempt.id to record as source_attempt_id.
        upload_id: The OmoUpload.id used for crop provenance object paths.

    Returns:
        List of GradedAnswer objects, one per question.
        Empty list on failure (fail-closed).

    Raises:
        RuntimeError: If circuit breaker threshold is reached (3 consecutive errors).
    """
    global _consecutive_errors

    if _consecutive_errors >= _CIRCUIT_BREAKER_THRESHOLD:
        raise RuntimeError(
            f"OMO grader circuit breaker open after {_CIRCUIT_BREAKER_THRESHOLD} consecutive errors"
        )

    questions = _build_question_schema(lesson)
    if not questions:
        logger.warning(
            "omo_grader: no questions found in lesson %s — returning empty grades",
            lesson.get("title", "unknown"),
        )
        return []

    try:
        from google import genai
        from google.genai import types as genai_types
    except ImportError:
        logger.warning("google-genai not available — returning mock grades for local dev")
        _consecutive_errors = 0
        return _mock_grades(questions, attempt_id)

    _grader_model, _grader_location = get_model_for_task("omo_grader")
    client = genai.Client(vertexai=True, project="lingoleap-dev", location=_grader_location)

    # #1717: split 2-page worksheet spreads (Sharp scanners etc.) into single
    # page halves so Gemini doesn't have to attend across the spine. Generic —
    # only triggers when aspect ratio looks landscape; passes portrait through.
    expanded: list[tuple[bytes, str]] = []
    for data, mime in zip(image_bytes_list, mime_types):
        expanded.extend(_split_spread(data, mime))

    image_parts = [
        genai_types.Part.from_bytes(data=data, mime_type=mime)
        for data, mime in expanded
    ]
    logger.info("OMO grader: prepared %d image parts (from %d input images)",
                len(image_parts), len(image_bytes_list))

    # OCR-only schema: Gemini returns handwriting + confidence + reasoning.
    # correct_answer + score are computed in Python (see _score_answer).
    response_schema = {
        "type": "array",
        "items": {
            "type": "object",
            "properties": {
                "question_id":   {"type": "string"},
                "student_answer":{"type": "string"},
                "ai_confidence": {"type": "number"},
                "reasoning":     {"type": "string"},
                "position_x":    {"type": "number"},
                "position_y":    {"type": "number"},
            },
            "required": ["question_id", "student_answer", "ai_confidence", "reasoning"],
        },
    }

    system_prompt = _build_grading_prompt(questions)

    try:
        response = await asyncio.wait_for(
            asyncio.to_thread(
                client.models.generate_content,
                model=_grader_model,
                contents=[genai_types.Content(parts=image_parts, role="user")],
                config=genai_types.GenerateContentConfig(
                    system_instruction=system_prompt,
                    response_mime_type="application/json",
                    response_schema=response_schema,
                    max_output_tokens=4096,  # #1717: room for split-image responses
                    temperature=0.0,   # #1712: deterministic — no creative completion
                    # #1717: thinking_budget=0 — experiment showed thinking did
                    # not improve OCR letter location (4/5→4/5 unchanged) but
                    # doubled cost. Keep disabled. The real improvement came
                    # from split-image preprocessing (see _split_spread).
                    thinking_config=genai_types.ThinkingConfig(thinking_budget=0),
                    automatic_function_calling=genai_types.AutomaticFunctionCallingConfig(
                        disable=True
                    ),
                ),
            ),
            timeout=120,  # #1717: thinking enabled — give it room (was 60)
        )
    except asyncio.TimeoutError:
        _consecutive_errors += 1
        logger.error("OMO grader timeout after 60s (consecutive_errors=%d)", _consecutive_errors)
        if _consecutive_errors >= _CIRCUIT_BREAKER_THRESHOLD:
            raise RuntimeError("OMO grader circuit breaker opened")
        return []
    except Exception as exc:
        _consecutive_errors += 1
        logger.error("OMO grader Gemini call failed: %s (consecutive_errors=%d)", exc, _consecutive_errors)
        if _consecutive_errors >= _CIRCUIT_BREAKER_THRESHOLD:
            raise RuntimeError("OMO grader circuit breaker opened")
        return []

    # Parse response
    import json
    try:
        raw_text = response.text or ""
        if not raw_text:
            raise ValueError("Gemini returned empty grading response")
        items = json.loads(raw_text)
        if not isinstance(items, list):
            raise ValueError(f"Expected list, got {type(items)}")
    except Exception as exc:
        _consecutive_errors += 1
        logger.error("OMO grader JSON parse failed: %s (consecutive_errors=%d)", exc, _consecutive_errors)
        if _consecutive_errors >= _CIRCUIT_BREAKER_THRESHOLD:
            raise RuntimeError("OMO grader circuit breaker opened")
        return []

    # Reset circuit breaker on success
    _consecutive_errors = 0

    # Lookup table: question_id → full question dict (for validation + scoring)
    qmap = {q["id"]: q for q in questions}

    results = []
    fabricated_count = 0
    low_confidence_count = 0
    for item in items:
        try:
            qid = str(item.get("question_id", ""))
            raw_student_ans = str(item.get("student_answer", "")).strip()
            ai_conf = float(item.get("ai_confidence", 0.0))
            reasoning = str(item.get("reasoning", ""))

            question = qmap.get(qid)
            if not question:
                logger.warning("OMO grader: skipping unknown question_id %s", qid)
                continue

            # #1712 anti-fabrication: coerce to empty if outside allowed_values.
            student_ans, was_fabricated = _validate_student_answer(raw_student_ans, question)
            if was_fabricated:
                fabricated_count += 1
                reasoning = (
                    f"[anti-fabrication] AI 回傳 '{raw_student_ans}' 不在合法答案 "
                    f"{question.get('allowed_values', [])[:5]}… 內，視為無作答。"
                )
                ai_conf = 0.0

            # #1715 low-confidence threshold: when Gemini self-reports doubt,
            # don't grade — flag for teacher review. Threshold is intentionally
            # generic (no PDF / device / handwriting-specific tuning) so it
            # generalizes across student worksheets.
            if student_ans and ai_conf < _LOW_CONFIDENCE_THRESHOLD:
                low_confidence_count += 1
                reasoning = (
                    f"[low-confidence] AI 看到 '{student_ans}' 但 confidence={ai_conf:.2f} < "
                    f"{_LOW_CONFIDENCE_THRESHOLD}，建議老師判讀。原因：{reasoning}"
                )
                student_ans = ""

            correct_ans = question["correct_answer"]
            qtype = question["type"]
            score = _score_answer(student_ans, correct_ans, qtype)

            results.append(GradedAnswer(
                question_id=qid,
                student_answer=student_ans,
                correct_answer=correct_ans,
                score=score,
                ai_confidence=ai_conf,
                reasoning=reasoning,
                position={
                    "x": float(item.get("position_x", 0.0)),
                    "y": float(item.get("position_y", 0.0)),
                } if "position_x" in item else None,
                source_attempt_id=attempt_id,
            ))
        except Exception as exc:
            logger.warning("OMO grader: skipping malformed answer item %s: %s", item, exc)

    if fabricated_count:
        logger.warning(
            "OMO grader: coerced %d/%d fabricated answers to empty for lesson '%s'",
            fabricated_count, len(results), lesson.get("title", "unknown"),
        )
    if low_confidence_count:
        logger.info(
            "OMO grader: flagged %d/%d low-confidence (< %.2f) answers for teacher review on lesson '%s'",
            low_confidence_count, len(results), _LOW_CONFIDENCE_THRESHOLD,
            lesson.get("title", "unknown"),
        )

    # Crop provenance: upload image strips for each non-empty answered question
    # when the caller provides a real upload id.
    if upload_id is not None:
        for result in results:
            if not (result.student_answer or "").strip():
                continue
            if not result.position or not image_bytes_list:
                continue
            q_info = {
                'type': 'multiple_choice' if result.question_id.startswith('mc_') else 'fill_blank',
                'position': result.position,
            }
            gs_uri = _crop_and_upload(
                image_bytes_list,
                q_info,
                upload_id,
                result.question_id,
            )
            result.crop_image_url = gs_uri

    # #1973: sort by YAML question order (fb_1, fb_2, …, mc_1, mc_2, …) so the
    # client renders in a stable, student-readable order rather than Gemini's
    # visual-scan order (which can jump around — esp. after _split_spread).
    qid_order = {q["id"]: idx for idx, q in enumerate(questions)}
    results.sort(key=lambda g: qid_order.get(g.question_id, len(qid_order)))

    logger.info(
        "OMO grader: graded %d/%d questions for lesson '%s'",
        len(results),
        len(questions),
        lesson.get("title", "unknown"),
    )
    return results


def _mock_grades(questions: list[dict], attempt_id: Optional[int]) -> list[GradedAnswer]:
    """Return mock GradedAnswer objects for local dev (no Gemini available)."""
    return [
        GradedAnswer(
            question_id=q["id"],
            student_answer="[mock answer]",
            correct_answer=q["correct_answer"],
            score=1.0,
            ai_confidence=0.9,
            reasoning="本地開發模式：模擬批改結果",
            crop_image_url=None,
            source_attempt_id=attempt_id,
        )
        for q in questions
    ]
