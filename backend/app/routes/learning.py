import logging
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from ..services.ai_service import generate_socratic_question
from ..services.socratic_agent import socratic_agent

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
    except Exception as e:
        # AI service unavailable (auth, network, etc.) — return a fallback question
        logger.warning("AI service error: %s", e)
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


# ── Step 3b: Socratic Comprehension Chat (with evaluation) ───────────────────

class ComprehensionChatRequest(BaseModel):
    session_id: str
    story_title: str
    story_text: str
    student_answer: str | None = Field(None, max_length=500)  # None = start session
    # Optional reading results from LiveTutor (Issue #17)
    mispronounced_words: list[str] | None = None
    accuracy: float | None = Field(None, ge=0, le=100)
    cpm: float | None = Field(None, gt=0)


class ComprehensionChatResponse(BaseModel):
    question: str
    feedback: str | None = None
    understood: bool | None = None
    understood_count: int
    required_count: int
    phase: str
    is_complete: bool
    referenced_paragraph: int | None = None


@router.post("/comprehension/chat", response_model=ComprehensionChatResponse)
async def comprehension_chat(payload: ComprehensionChatRequest):
    """
    Socratic dialogue with answer evaluation.
    Send student_answer=null to start a new session and get the first question.
    """
    try:
        if payload.student_answer is None:
            result = await socratic_agent.start_session(
                session_id=payload.session_id,
                story_title=payload.story_title,
                story_text=payload.story_text,
                mispronounced_words=payload.mispronounced_words,
                accuracy=payload.accuracy,
                cpm=payload.cpm,
            )
        else:
            result = await socratic_agent.process_answer(
                session_id=payload.session_id,
                student_answer=payload.student_answer,
            )
    except ValueError as e:
        status = 429 if "Rate limit" in str(e) else 422
        raise HTTPException(status_code=status, detail=str(e))
    except Exception as e:
        logger.error("Comprehension chat error: %s", e)
        raise HTTPException(status_code=500, detail="AI service error")

    return ComprehensionChatResponse(
        question=result.question,
        feedback=result.feedback,
        understood=result.understood,
        understood_count=result.understood_count,
        required_count=result.required_count,
        phase=result.phase,
        is_complete=result.is_complete,
        referenced_paragraph=result.referenced_paragraph,
    )
