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


async def generate_exit_ticket_questions(
    story_content: list[str],
    wrong_chars: list[str] | None = None,
) -> dict:
    """
    Generate exit-ticket questions for a story.

    Tries AI generation first. If AI fails (fallback=True), returns an
    empty questions list so the frontend can use its local rule-based fallback.

    Args:
        story_content: List of paragraphs from the story
        wrong_chars: Characters the student mispronounced during reading

    Returns:
        {
            "questions": [
                {
                    "id": int,
                    "question": str,
                    "options": [str, str, str, str],
                    "correct_index": int,   # 0-3
                    "explanation": str,
                }
            ],
            "source": "ai" | "fallback"
        }
    """
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
