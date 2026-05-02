"""
Exit Ticket Service — AI-powered generation and persistence (Issue #463).

Handles:
- AI question generation via Gemini 2.5 Flash (delegates to ai_service)
- Rule-based fallback when AI is unavailable
- Score calculation for submitted answers
"""

import logging

from ..services.ai_service import generate_exit_ticket as _ai_generate

logger = logging.getLogger(__name__)

# Minimum passing score to surface in the report
PASSING_SCORE = 60


def _from_lesson_yaml(lesson_data: dict) -> list[dict]:
    """Transform lesson YAML multiple_choice into exit-ticket schema (Issue #1402).

    YAML schema (from #1369 docx parser):
        multiple_choice:
          - question: "..."
            options: [A_text, B_text, C_text, D_text]
            answer: "A" | "B" | "C" | "D"

    Exit-ticket schema:
        {id, question, options[4], correct_index 0-3, explanation}

    Drops malformed entries (fewer than 4 options).
    """
    questions: list[dict] = []
    for i, q in enumerate(lesson_data.get("multiple_choice") or []):
        options = q.get("options") or []
        if len(options) < 4:
            continue
        answer = (q.get("answer") or "A").strip().upper()
        first = answer[:1]
        correct_index = ord(first) - ord("A") if first.isalpha() else 0
        correct_index = max(0, min(3, correct_index))
        questions.append({
            "id": i + 1,
            "question": (q.get("question") or "").strip(),
            "options": options[:4],
            "correct_index": correct_index,
            "explanation": "",
        })
    return questions


async def generate_exit_ticket_questions(
    story_content: list[str],
    wrong_chars: list[str] | None = None,
    lesson_data: dict | None = None,
) -> dict:
    """
    Generate exit-ticket questions for a story.

    YAML-first (Issue #1402): if lesson_data carries pre-authored
    multiple_choice from the lesson YAML (158 lessons all do, courtesy of
    #1369 docx parser), serve those without calling AI. Saves ~24M tokens
    per month at 100 students x 158 lessons x 1 session/day.

    Falls back to AI generation only when YAML has no MCQ (rare/never).
    If AI also fails, returns empty list so the frontend can use its
    local rule-based fallback.

    Args:
        story_content: List of paragraphs from the story
        wrong_chars: Characters the student mispronounced during reading
        lesson_data: Optional pre-loaded lesson YAML dict (carries multiple_choice)

    Returns:
        {
            "questions": [{"id", "question", "options"[4], "correct_index", "explanation"}],
            "source": "pregenerated" | "ai" | "fallback"
        }
    """
    if lesson_data:
        questions = _from_lesson_yaml(lesson_data)
        if questions:
            logger.info(
                "exit_ticket_service: served %d questions from YAML (lesson=%s, no AI call)",
                len(questions),
                lesson_data.get("lesson_code") or lesson_data.get("title", "?"),
            )
            return {"questions": questions, "source": "pregenerated"}

    full_text = "\n".join(story_content)
    try:
        result = await _ai_generate(text=full_text, wrong_chars=wrong_chars or [])
    except Exception as e:
        logger.error("exit_ticket_service: AI generate raised exception: %s", e)
        return {"questions": [], "source": "fallback"}

    if result.get("fallback") or not result.get("questions"):
        logger.info("exit_ticket_service: using fallback (AI unavailable)")
        return {"questions": [], "source": "fallback"}

    return {"questions": result["questions"], "source": "ai"}


def calculate_score(questions: list[dict], answers: list[dict]) -> dict:
    """
    Calculate score for submitted exit ticket answers.

    Args:
        questions: Generated questions with correct_index
        answers: [{"question_id": int, "selected_index": int}, ...]

    Returns:
        {"score": int, "correct_count": int, "total": int}
        score is 0-100 (percentage), rounded to nearest integer.
        NEVER returns a score > 0 if answers is empty.
    """
    if not questions or not answers:
        return {"score": 0, "correct_count": 0, "total": len(questions)}

    answer_map = {a["question_id"]: a["selected_index"] for a in answers}
    correct_count = 0

    for q in questions:
        selected = answer_map.get(q["id"])
        if selected is not None and selected == q["correct_index"]:
            correct_count += 1

    total = len(questions)
    score = round((correct_count / total) * 100) if total > 0 else 0
    return {"score": score, "correct_count": correct_count, "total": total}
