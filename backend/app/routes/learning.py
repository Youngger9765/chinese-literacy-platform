import logging
from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from ..auth.dependencies import get_current_user
from ..auth.rate_limiter import ai_limit_10_per_min, ai_limit_5_per_min
from ..database import get_db
from ..models.school import ClassroomStudent
from ..models.session import LearningSession, DialogueTurn
from ..models.user import User
from ..schemas.session import (
    SessionCreateRequest,
    SessionDetailResponse,
    SessionListResponse,
    SessionStatusResponse,
    SessionSummaryResponse,
    SessionUpdateRequest,
)
from ..services.ai_service import generate_socratic_question
from ..services.socratic_agent import socratic_agent

router = APIRouter(tags=["learning"])
logger = logging.getLogger(__name__)


# ── Learning Session CRUD ────────────────────────────────────────────────────


@router.post("/learning/sessions", status_code=201, response_model=SessionDetailResponse)
def create_learning_session(
    payload: SessionCreateRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Create a new learning session for the authenticated student."""
    # Auto-fill classroom_id from the student's first active enrollment (if any)
    enrollment = (
        db.query(ClassroomStudent)
        .filter(ClassroomStudent.student_id == current_user.id)
        .first()
    )
    classroom_id = enrollment.classroom_id if enrollment else None

    session = LearningSession(
        student_id=current_user.id,
        story_slug=payload.story_slug,
        status="in_progress",
        current_step=1,
        classroom_id=classroom_id,
    )
    db.add(session)
    db.commit()
    db.refresh(session)
    logger.info(
        "Created learning session %d for user %d, story=%s",
        session.id, current_user.id, payload.story_slug,
    )
    return session


@router.get("/learning/sessions", response_model=SessionListResponse)
def list_my_sessions(
    limit: int = Query(20, ge=1, le=100),
    offset: int = Query(0, ge=0),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """List learning sessions for the authenticated student, newest first."""
    query = db.query(LearningSession).filter(
        LearningSession.student_id == current_user.id,
    )
    total = query.count()
    items = (
        query
        .order_by(LearningSession.started_at.desc())
        .offset(offset)
        .limit(limit)
        .all()
    )
    return SessionListResponse(
        items=[SessionSummaryResponse.model_validate(s) for s in items],
        total=total,
    )


@router.get("/learning/sessions/{session_id}", response_model=SessionDetailResponse)
def get_session_detail(
    session_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Get full detail of a single learning session (must be own session)."""
    session = db.query(LearningSession).filter(LearningSession.id == session_id).first()
    if session is None:
        raise HTTPException(status_code=404, detail="Session not found")
    if session.student_id != current_user.id:
        raise HTTPException(status_code=403, detail="Not your session")
    return session


@router.get("/learning/sessions/{session_id}/report", response_model=SessionDetailResponse)
def get_session_report(
    session_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Get session report (semantic alias for session detail)."""
    return get_session_detail(session_id, current_user, db)


@router.get("/learning/sessions/{session_id}/status", response_model=SessionStatusResponse)
def get_session_status(
    session_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """
    Get the resumable status of a learning session.

    Returns whether the session can be resumed, the current step, and
    whether it has been completed.  Used by the frontend to show the
    "繼續上次的學習？" prompt.
    """
    session = db.query(LearningSession).filter(LearningSession.id == session_id).first()
    if session is None:
        raise HTTPException(status_code=404, detail="Session not found")
    if session.student_id != current_user.id:
        raise HTTPException(status_code=403, detail="Not your session")

    is_completed = session.status == "completed" or session.completed_at is not None
    is_resumable = not is_completed and session.status == "in_progress"

    return SessionStatusResponse(
        id=session.id,
        story_slug=session.story_slug,
        current_step=session.current_step,
        status=session.status,
        is_resumable=is_resumable,
        is_completed=is_completed,
        started_at=session.started_at,
        completed_at=session.completed_at,
    )


@router.patch("/learning/sessions/{session_id}", response_model=SessionDetailResponse)
def update_session(
    session_id: int,
    payload: SessionUpdateRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Update learning session progress (must be own session)."""
    session = db.query(LearningSession).filter(LearningSession.id == session_id).first()
    if session is None:
        raise HTTPException(status_code=404, detail="Session not found")
    if session.student_id != current_user.id:
        raise HTTPException(status_code=403, detail="Not your session")

    update_data = payload.model_dump(exclude_unset=True)
    for field, value in update_data.items():
        setattr(session, field, value)

    db.commit()
    db.refresh(session)
    logger.info("Updated learning session %d: %s", session_id, list(update_data.keys()))
    return session


# ── Step 3: Socratic Comprehension Q&A ──────────────────────────────────────

class ConversationTurn(BaseModel):
    role: str   # "ai" | "student"
    text: str


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
    # Optional DB learning session ID — when provided, dialogue turns are persisted (Issue #242)
    db_session_id: int | None = None


class ComprehensionChatResponse(BaseModel):
    question: str
    feedback: str | None = None
    understood: bool | None = None
    understood_count: int
    required_count: int
    phase: str
    is_complete: bool
    referenced_paragraph: int | None = None


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
    except RuntimeError as e:
        raise HTTPException(status_code=503, detail=str(e))
    except Exception as e:
        logger.error("Comprehension chat error: %s", e)
        raise HTTPException(status_code=500, detail="AI service error")

    # Persist dialogue turns when a DB session ID is provided (Issue #242)
    if payload.db_session_id is not None:
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


# ── Dialogue history (Issue #242) ─────────────────────────────────────────────


class DialogueTurnResponse(BaseModel):
    id: int
    turn_order: int
    role: str
    text: str
    is_correct: bool | None
    phase: str | None
    created_at: datetime

    model_config = {"from_attributes": True}


class DialogueHistoryResponse(BaseModel):
    session_id: int
    story_slug: str | None
    turns: list[DialogueTurnResponse]
    total: int


@router.get(
    "/learning/sessions/{session_id}/dialogue",
    response_model=DialogueHistoryResponse,
)
def get_dialogue_history(
    session_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Return the full Socratic dialogue Q&A history for a learning session.

    Returns turns in order (turn_order ASC).
    Returns an empty list if the session exists but has no recorded dialogue.
    """
    session = db.query(LearningSession).filter(LearningSession.id == session_id).first()
    if session is None:
        raise HTTPException(status_code=404, detail="Session not found")
    if session.student_id != current_user.id:
        raise HTTPException(status_code=403, detail="Not your session")

    turns = (
        db.query(DialogueTurn)
        .filter(DialogueTurn.learning_session_id == session_id)
        .order_by(DialogueTurn.turn_order)
        .all()
    )

    return DialogueHistoryResponse(
        session_id=session_id,
        story_slug=session.story_slug,
        turns=[DialogueTurnResponse.model_validate(t) for t in turns],
        total=len(turns),
    )
