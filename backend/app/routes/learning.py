import logging
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from ..services.ai_service import generate_socratic_question

router = APIRouter(tags=["learning"])
logger = logging.getLogger(__name__)


class LearningSessionCreate(BaseModel):
    student_id: str
    story_id: str


@router.post("/learning-sessions", status_code=201)
def create_learning_session(payload: LearningSessionCreate):
    """Stub: create a new learning session. Full implementation pending DB."""
    logger.info("New learning session: student=%s story=%s", payload.student_id, payload.story_id)
    return {"status": "created", "student_id": payload.student_id, "story_id": payload.story_id}


# ── Step 3: Socratic Comprehension Q&A ──────────────────────────────────────

class ConversationTurn(BaseModel):
    role: str   # "ai" | "student"
    text: str


class ComprehensionRequest(BaseModel):
    story_title: str
    story_text: str            # paragraphs joined with "\n"
    conversation: list[ConversationTurn] = []


class ComprehensionResponse(BaseModel):
    question: str
    question_number: int       # how many AI questions have been asked so far (including this one)


@router.post("/comprehension/question", response_model=ComprehensionResponse)
async def get_comprehension_question(payload: ComprehensionRequest):
    """
    Generate the next Socratic question for a reading comprehension session.

    The frontend sends the full conversation history; this endpoint returns
    the next AI question. Call this after each student answer (and on initial
    load with an empty conversation to get the first question).
    """
    try:
        conversation = [t.model_dump() for t in payload.conversation]
        question = await generate_socratic_question(
            story_title=payload.story_title,
            story_text=payload.story_text,
            conversation=conversation,
        )
    except RuntimeError as e:
        # API key not configured — return a fallback question so demo still works
        logger.warning("AI service not configured: %s", e)
        question = _fallback_question(payload.conversation)

    # Count how many AI turns have been in the conversation (including this new one)
    ai_count = sum(1 for t in payload.conversation if t.role == "ai") + 1

    return ComprehensionResponse(question=question, question_number=ai_count)


def _fallback_question(conversation: list[ConversationTurn]) -> str:
    """Return a pre-written question when AI API is not available."""
    ai_count = sum(1 for t in conversation if t.role == "ai")
    fallback = [
        "這篇課文的主角是誰？他（她）做了什麼事？",
        "為什麼主角要這樣做？你覺得他的理由合理嗎？",
        "讀完這篇課文，你有什麼感想？如果是你，你會怎麼做？",
    ]
    return fallback[min(ai_count, len(fallback) - 1)]
