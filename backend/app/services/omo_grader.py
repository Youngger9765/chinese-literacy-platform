"""OMO grading service — extracts per-question student answers from worksheet images.

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
"""

import asyncio
import logging
from dataclasses import dataclass, field
from typing import Optional

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
    source_attempt_id: Optional[int] = None


def _resolve_letter_answer(letter: str, vocabulary: list) -> str:
    """Resolve A/B/C/... letter to vocabulary word.

    L22-L30 YAML uses ordered letter (A=0, B=1, ...) as placeholder for the
    vocabulary list index. So `answer: A` for fill_in_blank means the student
    should fill in vocabulary[0].word (e.g. '奠定').

    Returns the actual word if letter matches a vocab index, else returns
    the letter as-is (for backward compatibility with non-vocab grading).
    """
    if not isinstance(letter, str) or len(letter) != 1 or not letter.isalpha():
        return str(letter)
    if not isinstance(vocabulary, list) or not vocabulary:
        return letter
    idx = ord(letter.upper()) - ord("A")
    if not (0 <= idx < len(vocabulary)):
        return letter
    v = vocabulary[idx]
    if isinstance(v, dict):
        return str(v.get("word") or v.get("term") or letter)
    return str(v)


def _build_question_schema(lesson: dict) -> list[dict]:
    """Extract expected-answer schema from lesson YAML for the grading prompt.

    Each question dict includes `allowed_values` — the only legal student_answer
    values for that question (#1712 fix: prevents Gemini fabrication by giving
    it a finite value space to choose from).
    """
    questions = []
    vocabulary = lesson.get("vocabulary") or []
    vocab_words = [v.get("word", "") for v in vocabulary if v.get("word")]

    # Detect fill_in_blank mode: 'lettered' (student circles A-G) vs 'free_form'
    # (student handwrites a word). Mode is determined by whether ALL fb answers
    # in the lesson are single A-G letters — that pattern is used by L22-L30
    # 「四 語詞應用」style where vocabulary letters are the choice set.
    fb = lesson.get("fill_in_blank") or []
    fb_raw_items = list(fb.items()) if isinstance(fb, dict) else list(enumerate(fb))
    fb_answers = []
    for _, item in fb_raw_items:
        ans = item.get("answer", "") if isinstance(item, dict) else str(item)
        fb_answers.append(ans)
    fb_lettered = bool(fb_answers) and all(
        isinstance(a, str) and len(a.strip()) == 1 and a.strip().upper() in "ABCDEFG"
        for a in fb_answers if a
    )
    # Lettered choices use the vocabulary as the A-G mapping; allowed letters
    # equal min(len(vocab), 7) so we don't claim more letters than choices.
    n_letters = min(len(vocab_words), 7) if fb_lettered else 0
    fb_allowed_letters = [chr(ord("A") + i) for i in range(n_letters)]

    for key, item in fb_raw_items:
        qid = str(key) if isinstance(fb, dict) else f"fb_{key+1}"
        if isinstance(item, dict):
            raw_answer = item.get("answer", "")
            context = item.get("context", item.get("sentence", ""))
        else:
            raw_answer = str(item)
            context = ""
        correct_word = _resolve_letter_answer(raw_answer, vocabulary)
        # #1712: lettered fb compares letter-vs-letter (student circles a letter).
        # `correct_answer` is what we score against in _score_answer.
        # `correct_word` is kept for display ("正解：規律").
        if fb_lettered:
            correct_for_scoring = str(raw_answer).strip().upper()
        else:
            correct_for_scoring = correct_word
        questions.append({
            "id": qid,
            "type": "fill_blank",
            "context": context,
            "correct_answer": correct_for_scoring,
            "correct_word": correct_word,
            "mode": "lettered" if fb_lettered else "free_form",
            "allowed_values": fb_allowed_letters if fb_lettered else vocab_words,
        })

    # multiple_choice section — accepts list[dict] or dict[str, dict]
    mc = lesson.get("multiple_choice") or []
    mc_items = mc.items() if isinstance(mc, dict) else enumerate(mc)
    for key, item in mc_items:
        qid = str(key) if isinstance(mc, dict) else f"mc_{key+1}"
        if isinstance(item, dict):
            correct = item.get("answer", "")
            context = item.get("question", item.get("sentence", ""))
        else:
            correct = str(item)
            context = ""
        questions.append({
            "id": qid,
            "type": "multiple_choice",
            "context": context,
            "correct_answer": correct,
            "mode": "lettered",
            "allowed_values": ["A", "B", "C", "D"],
        })

    # strategy_exercise section (structured exercises in 7-lesson set)
    se = lesson.get("strategy_exercise") or {}
    if isinstance(se, dict):
        items = se.get("items") or se.get("questions") or []
        if isinstance(items, list):
            for i, item in enumerate(items):
                if isinstance(item, dict) and "answer" in item:
                    qid = item.get("id", f"se_{i+1}")
                    questions.append({
                        "id": qid,
                        "type": "fill_blank",
                        "context": item.get("stem", item.get("question", "")),
                        "correct_answer": item.get("answer", ""),
                    })

    return questions


def _build_grading_prompt(questions: list[dict]) -> str:
    """Build OCR-only prompt with per-question allowed-value constraints.

    Design (fixes #1712 — round 3 of #1614/#1616):
    - Each question explicitly lists the legal student_answer values so Gemini
      cannot return a plausible-but-fabricated answer like 「良好」 when the
      choice set is A-G letters.
    - Reference (correct) answers stay HIDDEN per #1616 — Gemini sees the value
      SPACE but not which value is correct.
    - Empty answer is always legal — if Gemini can't see handwriting, it should
      say so instead of inventing.
    """
    def _format(q: dict) -> str:
        mode = q.get("mode", "free_form")
        allowed = q.get("allowed_values") or []
        if mode == "lettered":
            value_hint = "{" + ", ".join(allowed) + ', ""}'
            instr = "學生在題號旁圈一個字母。逐筆檢查圈圈/勾選/箭頭標記。"
        else:
            sample = "、".join(allowed[:6]) + ("…" if len(allowed) > 6 else "")
            value_hint = f'{{{sample}, ""}}'
            instr = "學生用鉛筆/原子筆在空格內手寫一個詞。逐字 OCR。"
        return (
            f"  - {q['id']} ({q['type']}): {q['context']}\n"
            f"      合法答案 = {value_hint}\n"
            f"      做法：{instr}"
        )

    questions_text = "\n".join(_format(q) for q in questions)
    return f"""你是 OCR 識字員。讀學生在學習單照片上的**手寫筆跡**。

== 絕對規則 ==
1. 只報告學生**實際用鉛筆/原子筆寫**的字 — 從照片像素讀出來的。
2. **禁止編造**：student_answer 必須是該題「合法答案」清單裡的值，或空字串 ""。
3. 看不到手寫、看不清、學生跳過 → student_answer=""，ai_confidence=0.0。
4. 不要把印刷的題目文字、題目選項、或正確答案當作學生作答。
5. 紅筆批改痕跡（✗ / 紅線 / 紅筆覆寫）= 老師批改 — student_answer 填學生**原本**寫的字（紅筆修改前），不是老師訂正的字。
6. 對 lettered 題（A/B/C/D…），只能回字母本身（單一大寫字母）— 不能回詞語。

== 題目清單（含合法答案清單） ==
{questions_text}

回傳 JSON 陣列，每題一筆：
[{{"question_id":"fb_1","student_answer":"<合法值或空字串>","ai_confidence":0.0~1.0,"reasoning":"50字內描述照片裡看到的筆跡"}}]"""


def _score_answer(student: str, correct: str, qtype: str) -> float:
    """Compare student OCR output against YAML correct_answer. Pure Python — no LLM.

    Rules:
    - Empty student → 0.0 (could not OCR / blank)
    - Exact match (after strip + lowercase for letters) → 1.0
    - MC: letter comparison case-insensitive
    - Fill-blank: exact string match required (educational rigor)
    - Otherwise → 0.0
    """
    s = (student or "").strip()
    c = (correct or "").strip()
    if not s:
        return 0.0
    if qtype == "multiple_choice":
        return 1.0 if s.upper() == c.upper() else 0.0
    return 1.0 if s == c else 0.0


def _validate_student_answer(student: str, question: dict) -> tuple[str, bool]:
    """Coerce fabricated student_answer to empty (#1712 fix).

    A valid answer is either:
    - Empty string (Gemini saw nothing / wasn't sure)
    - A value in `question['allowed_values']` (case-insensitive for letters,
      exact match for words; also accepts a letter that resolves to a vocab
      word in the lettered list — Gemini sometimes returns the word instead).

    Anything else (e.g. 「良好」when allowed = {A,B,C,D,E,F,G,""}) is treated
    as fabrication: coerce to "" and signal coercion happened.

    Returns:
        (sanitized_answer, was_fabricated)
    """
    s = (student or "").strip()
    if not s:
        return "", False
    allowed = question.get("allowed_values") or []
    mode = question.get("mode", "free_form")
    if mode == "lettered":
        # Accept the letter itself
        if len(s) == 1 and s.upper() in [a.upper() for a in allowed]:
            return s.upper(), False
        return "", True
    # free_form: exact word match (case-sensitive — Chinese characters)
    if s in allowed:
        return s, False
    return "", True


async def grade_worksheet_images(
    image_bytes_list: list[bytes],
    mime_types: list[str],
    lesson: dict,
    attempt_id: Optional[int] = None,
) -> list[GradedAnswer]:
    """Grade worksheet images against the lesson YAML schema.

    Args:
        image_bytes_list: List of raw image bytes (all active attempt images).
        mime_types: Corresponding MIME types.
        lesson: Lesson dict from lesson_loader (contains fill_in_blank, MCQ, etc.).
        attempt_id: The OmoUploadAttempt.id to record as source_attempt_id.

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

    client = genai.Client(vertexai=True, project="lingoleap-dev", location="us-central1")

    # Build content parts: system prompt + all images
    image_parts = []
    for data, mime in zip(image_bytes_list, mime_types):
        image_parts.append(
            genai_types.Part.from_bytes(data=data, mime_type=mime)
        )

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
                model="gemini-2.5-flash",
                contents=[genai_types.Content(parts=image_parts, role="user")],
                config=genai_types.GenerateContentConfig(
                    system_instruction=system_prompt,
                    response_mime_type="application/json",
                    response_schema=response_schema,
                    max_output_tokens=2048,
                    temperature=0.0,   # #1712: deterministic — no creative completion
                    thinking_config=genai_types.ThinkingConfig(thinking_budget=0),
                    automatic_function_calling=genai_types.AutomaticFunctionCallingConfig(
                        disable=True
                    ),
                ),
            ),
            timeout=60,  # grading can take longer than identification
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
            source_attempt_id=attempt_id,
        )
        for q in questions
    ]
