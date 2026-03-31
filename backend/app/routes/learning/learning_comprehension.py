"""Socratic Comprehension Q&A and Chat routes (Step 3).

Handles generating comprehension questions and the Socratic dialogue chat.
Dialogue history and scoring are in learning_comprehension_score.py.
"""
import logging
import time
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from ...auth.dependencies import get_current_user
from ...auth.rate_limiter import ai_limit_10_per_min
from ...database import get_db
from ...models.session import DialogueTurn, LearningSession
from ...models.teacher_instruction import TeacherInstruction
from ...models.user import User
from ...services.ai_service import generate_socratic_question
from ...services.ai_usage_tracker import last_usage, log_ai_usage
from ...services.socratic_agent import socratic_agent
from ._helpers import ConversationTurn

router = APIRouter()
logger = logging.getLogger(__name__)


# ── Step 3: Socratic Comprehension Q&A ──────────────────────────────────────

class ComprehensionRequest(BaseModel):
    story_title: str
    story_text: str = Field(..., max_length=10000)  # paragraphs joined with "\n"
    conversation: list[ConversationTurn] = []


class ComprehensionResponse(BaseModel):
    question: str
    question_number: int       # how many AI questions have been asked so far (including this one)


@router.post(
    "/comprehension/question",
    response_model=ComprehensionResponse,
    dependencies=[Depends(ai_limit_10_per_min)],
)
async def get_comprehension_question(
    payload: ComprehensionRequest,
    current_user: User = Depends(get_current_user),
):
    """
    Generate the next Socratic question for a reading comprehension session.

    Rate limited: 10 requests per minute per user/IP.

    The frontend sends the full conversation history; this endpoint returns
    the next AI question. Call this after each student answer (and on initial
    load with an empty conversation to get the first question).
    """
    start_time = time.monotonic()
    ai_success = True
    ai_error_type = None
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
        ai_success = False
        ai_error_type = type(e).__name__

    latency_ms = int((time.monotonic() - start_time) * 1000)

    # Track AI usage (Issue #874)
    usage = last_usage.get()
    log_ai_usage(
        None,  # no db session in this endpoint
        endpoint="/comprehension/question",
        step="comprehension_question",
        student_id=current_user.id,
        story_title=payload.story_title,
        input_tokens=usage.input_tokens if usage else 0,
        output_tokens=usage.output_tokens if usage else 0,
        model=usage.model if usage else "gemini-2.5-flash",
        latency_ms=latency_ms,
        success=ai_success,
        error_type=ai_error_type,
    )

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
    # Optional DB learning session ID — when provided, dialogue turns are persisted (Issue #242)
    db_session_id: int | None = None
    # Genre-aware Socratic (#615)
    genre: str | None = None
    reading_strategy: str | None = None


class ConversationHistoryItem(BaseModel):
    role: str  # "ai" | "student" | "feedback"
    text: str
    understood: bool | None = None  # only for feedback turns


class ComprehensionChatResponse(BaseModel):
    question: str
    feedback: str | None = None
    understood: bool | None = None
    understood_count: int
    required_count: int
    phase: str
    is_complete: bool
    referenced_paragraph: int | None = None
    # Session persistence fields (Issue #632)
    resumed: bool = False  # True = restored from memory/DB, no Gemini call
    conversation_history: list[ConversationHistoryItem] = []  # populated when resumed=True


@router.post(
    "/comprehension/chat",
    response_model=ComprehensionChatResponse,
    dependencies=[Depends(ai_limit_10_per_min)],
)
async def comprehension_chat(
    payload: ComprehensionChatRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """
    Socratic dialogue with answer evaluation.

    Rate limited: 10 requests per minute per user/IP.

    Send student_answer=null to start a new session and get the first question.
    Optionally pass db_session_id (integer DB LearningSession PK) to persist
    dialogue turns for later retrieval via GET /api/learning/sessions/{id}/dialogue.

    When the session is restored from memory or DB (after refresh / Cloud Run restart),
    the response includes resumed=true and conversation_history so the frontend can
    display the prior conversation without a Gemini call.
    """
    is_resumed = False
    conversation_history: list[ConversationHistoryItem] = []
    start_time = time.monotonic()
    ai_success = True
    ai_error_type = None

    # Validate db_session_id ownership to prevent IDOR (Insecure Direct Object Reference).
    # A malicious user cannot read or write another student's dialogue by guessing session IDs.
    if payload.db_session_id is not None:
        owned = (
            db.query(LearningSession.id)
            .filter(
                LearningSession.id == payload.db_session_id,
                LearningSession.student_id == current_user.id,
            )
            .first()
        )
        if not owned:
            raise HTTPException(status_code=403, detail="Session not found")

    try:
        if payload.student_answer is None:
            # Fetch active teacher instructions for this student (Issue #90)
            teacher_instructions_content: list[str] = []
            try:
                instructions = (
                    db.query(TeacherInstruction)
                    .filter(
                        TeacherInstruction.student_id == current_user.id,
                        TeacherInstruction.is_active == True,  # noqa: E712
                    )
                    .all()
                )
                teacher_instructions_content = [i.content for i in instructions]
            except Exception as e:
                logger.warning("Failed to fetch teacher instructions: %s", e)

            result, is_resumed = await socratic_agent.start_session(
                session_id=payload.session_id,
                story_title=payload.story_title,
                story_text=payload.story_text,
                mispronounced_words=payload.mispronounced_words,
                accuracy=payload.accuracy,
                cpm=payload.cpm,
                teacher_instructions=teacher_instructions_content or None,
                genre=payload.genre,
                reading_strategy=payload.reading_strategy,
                db=db,
                db_session_id=payload.db_session_id,
            )

            # When resuming, build conversation_history from DB turns so the
            # frontend can display prior Q&A without extra API calls.
            if is_resumed and payload.db_session_id is not None:
                try:
                    turns = (
                        db.query(DialogueTurn)
                        .filter(DialogueTurn.learning_session_id == payload.db_session_id)
                        .order_by(DialogueTurn.turn_order)
                        .all()
                    )
                    for turn in turns:
                        conversation_history.append(
                            ConversationHistoryItem(
                                role=turn.role,
                                text=turn.text,
                                understood=turn.is_correct,
                            )
                        )
                except Exception as e:
                    logger.warning("Failed to fetch conversation history for resume: %s", e)
        else:
            result = await socratic_agent.process_answer(
                session_id=payload.session_id,
                student_answer=payload.student_answer,
            )
    except ValueError as e:
        ai_success = False
        ai_error_type = "ValueError"
        status = 429 if "Rate limit" in str(e) else 422
        raise HTTPException(status_code=status, detail=str(e))
    except RuntimeError as e:
        ai_success = False
        ai_error_type = "RuntimeError"
        raise HTTPException(status_code=503, detail=str(e))
    except Exception as e:
        ai_success = False
        ai_error_type = type(e).__name__
        logger.error("Comprehension chat error: %s", e)
        raise HTTPException(status_code=500, detail="AI service error")

    # Persist dialogue turns when a DB session ID is provided (Issue #242).
    # Skip persistence when resuming — turns are already in DB.
    if payload.db_session_id is not None and not is_resumed:
        try:
            _persist_dialogue_turns(
                db=db,
                socratic_session_id=payload.session_id,
                learning_session_id=payload.db_session_id,
                student_answer=payload.student_answer,
                result=result,
            )
        except Exception as e:
            # Non-fatal — log and continue so the chat still works
            logger.warning("Failed to persist dialogue turn: %s", e)

    # Track AI usage (Issue #874) — skip tracking for resumed sessions (no Gemini call)
    if not is_resumed:
        latency_ms = int((time.monotonic() - start_time) * 1000)
        usage = last_usage.get()
        log_ai_usage(
            db,
            endpoint="/comprehension/chat",
            step="comprehension",
            student_id=current_user.id,
            story_title=payload.story_title,
            session_id=payload.db_session_id,
            input_tokens=usage.input_tokens if usage else 0,
            output_tokens=usage.output_tokens if usage else 0,
            model=usage.model if usage else "gemini-2.5-flash",
            latency_ms=latency_ms,
            success=ai_success,
            error_type=ai_error_type,
        )

    return ComprehensionChatResponse(
        question=result.question,
        feedback=result.feedback,
        understood=result.understood,
        understood_count=result.understood_count,
        required_count=result.required_count,
        phase=result.phase,
        is_complete=result.is_complete,
        referenced_paragraph=result.referenced_paragraph,
        resumed=is_resumed,
        conversation_history=conversation_history,
    )


# ── Step 3c: Restart session (Issue #632) ────────────────────────────────────

class ComprehensionRestartRequest(BaseModel):
    session_id: str
    db_session_id: int | None = None  # when provided, also clears DB turns


@router.post(
    "/comprehension/restart",
    status_code=204,
    dependencies=[Depends(ai_limit_10_per_min)],
)
async def comprehension_restart(
    payload: ComprehensionRestartRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """
    Clear the in-memory session and (optionally) delete DB turns for a given
    db_session_id so the next fetchFirstQuestion call starts a fresh Gemini session.

    Called when the student clicks '重新開始'.
    """
    socratic_agent.clear_session(
        session_id=payload.session_id,
        db=db,
        db_session_id=payload.db_session_id,
    )


def _persist_dialogue_turns(
    db: Session,
    socratic_session_id: str,
    learning_session_id: int,
    student_answer: str | None,
    result,
) -> None:
    """Persist one round of dialogue turns to the DB.

    Each call to comprehension_chat produces up to three turns:
    1. Student answer (if not the first question)
    2. AI feedback (if answer was evaluated)
    3. AI question (always)

    Turn order is derived from the current count of existing turns.
    """
    existing_count = (
        db.query(DialogueTurn)
        .filter(DialogueTurn.socratic_session_id == socratic_session_id)
        .count()
    )
    order = existing_count
    turns_to_add = []

    if student_answer is not None:
        # Student answer turn
        turns_to_add.append(
            DialogueTurn(
                socratic_session_id=socratic_session_id,
                learning_session_id=learning_session_id,
                turn_order=order,
                role="student",
                text=student_answer,
                phase=result.phase,
            )
        )
        order += 1

        # Feedback turn (if evaluation was done)
        if result.feedback is not None and result.understood is not None:
            turns_to_add.append(
                DialogueTurn(
                    socratic_session_id=socratic_session_id,
                    learning_session_id=learning_session_id,
                    turn_order=order,
                    role="feedback",
                    text=result.feedback,
                    is_correct=result.understood,
                    phase=result.phase,
                )
            )
            order += 1
    else:
        # This is the first call (student_answer=None) — no student/feedback turns yet.
        # The AI question below is the opening question.
        pass

    # AI question turn (always, unless session just completed)
    if not result.is_complete or student_answer is None:
        turns_to_add.append(
            DialogueTurn(
                socratic_session_id=socratic_session_id,
                learning_session_id=learning_session_id,
                turn_order=order,
                role="ai",
                text=result.question,
                phase=result.phase,
            )
        )

    if turns_to_add:
        db.add_all(turns_to_add)
        db.commit()
