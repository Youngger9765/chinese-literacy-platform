import logging
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from ..auth.dependencies import get_current_user
from ..database import get_db
from ..models.school import ClassroomStudent
from ..models.session import LearningSession
from ..models.user import User
from ..schemas.session import (
    SessionCreateRequest,
    SessionDetailResponse,
    SessionListResponse,
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


@router.post("/comprehension/question", response_model=ComprehensionResponse)
async def get_comprehension_question(
    payload: ComprehensionRequest,
    current_user: User = Depends(get_current_user),
):
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
async def comprehension_chat(
    payload: ComprehensionChatRequest,
    current_user: User = Depends(get_current_user),
):
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
    except RuntimeError as e:
        raise HTTPException(status_code=503, detail=str(e))
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
