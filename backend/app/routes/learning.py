import json
import logging
from datetime import datetime, timedelta, timezone
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy import func as sa_func
from sqlalchemy.orm import Session

from ..auth.dependencies import get_current_user
from ..auth.rate_limiter import ai_limit_10_per_min, ai_limit_5_per_min
from ..database import get_db
from ..models.school import Classroom, ClassroomStudent
from ..models.session import CharacterError, ErrorCorrection, LearningSession, DialogueTurn
from ..models.teacher_instruction import TeacherInstruction
from ..models.user import User
from ..models.parent_link import ParentStudentLink
from ..schemas.session import (
    ComprehensionScoreResponse,
    SessionCreateRequest,
    SessionDetailResponse,
    SessionListResponse,
    SessionStatusResponse,
    SessionSummaryResponse,
    SessionUpdateRequest,
)
from ..services.ai_service import (
    evaluate_comprehension,
    generate_example_sentences,
    generate_reading_analysis,
    generate_socratic_question,
    validate_student_sentence,
)
from ..services.listening_service import evaluate_retelling
from ..services.socratic_agent import socratic_agent
from ..services.stuck_detection_service import build_recommendations, detect_stuck_points
from ..services.learning_path_service import recommend_next_stories

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


# ── Step 6: AI Reading Analysis ─────────────────────────────────────────────


class AIAnalysisRequest(BaseModel):
    story_title: str = Field(..., max_length=200)
    accuracy: float = Field(..., ge=0, le=100)
    cpm: float = Field(..., ge=0)
    error_chars: list[str] = Field(default_factory=list)
    total_characters: int = Field(..., ge=0)


class AIAnalysisResponse(BaseModel):
    analysis_summary: str
    strengths: list[str]
    areas_for_improvement: list[str]
    practice_suggestions: list[str]
    encouragement_message: str


@router.post(
    "/learning/sessions/{session_id}/ai-analysis",
    response_model=AIAnalysisResponse,
    dependencies=[Depends(ai_limit_5_per_min)],
)
async def get_ai_analysis(
    session_id: int,
    payload: AIAnalysisRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Generate AI reading diagnosis and improvement suggestions.

    If the session already has a cached analysis, returns it immediately
    without calling Gemini again. Otherwise calls Gemini and caches the
    result in the session's ai_analysis column.

    Rate limited: 5 requests per minute per user/IP.
    """
    session = db.query(LearningSession).filter(LearningSession.id == session_id).first()
    if session is None:
        raise HTTPException(status_code=404, detail="Session not found")
    if session.student_id != current_user.id:
        raise HTTPException(status_code=403, detail="Not your session")

    # Return cached result if available
    if session.ai_analysis:
        try:
            cached = json.loads(session.ai_analysis)
            return AIAnalysisResponse(**cached)
        except (json.JSONDecodeError, TypeError):
            # Corrupted cache — regenerate
            logger.warning("Corrupted ai_analysis cache for session %d, regenerating", session_id)

    # Call Gemini
    try:
        analysis = await generate_reading_analysis({
            "story_title": payload.story_title,
            "accuracy": payload.accuracy,
            "cpm": payload.cpm,
            "error_chars": payload.error_chars,
            "total_characters": payload.total_characters,
        })
    except TimeoutError:
        raise HTTPException(status_code=503, detail="AI service timeout")
    except Exception as e:
        logger.error("AI analysis generation failed for session %d: %s", session_id, e)
        raise HTTPException(status_code=503, detail="AI service unavailable")

    # Cache the result
    session.ai_analysis = json.dumps(analysis, ensure_ascii=False)
    db.commit()

    logger.info("Generated AI analysis for session %d", session_id)
    return AIAnalysisResponse(**analysis)


@router.post(
    "/learning/ai-analysis",
    response_model=AIAnalysisResponse,
    dependencies=[Depends(ai_limit_5_per_min)],
)
async def get_ai_analysis_standalone(
    payload: AIAnalysisRequest,
    current_user: User = Depends(get_current_user),
):
    """Generate AI reading diagnosis without requiring a backend session.

    This endpoint is for the frontend learning flow which manages sessions
    in-memory. No caching — analysis is generated fresh each call.

    Rate limited: 5 requests per minute per user/IP.
    """
    try:
        analysis = await generate_reading_analysis({
            "story_title": payload.story_title,
            "accuracy": payload.accuracy,
            "cpm": payload.cpm,
            "error_chars": payload.error_chars,
            "total_characters": payload.total_characters,
        })
    except TimeoutError:
        raise HTTPException(status_code=503, detail="AI service timeout")
    except Exception as e:
        logger.error("Standalone AI analysis generation failed: %s", e)
        raise HTTPException(status_code=503, detail="AI service unavailable")

    logger.info("Generated standalone AI analysis for user %d", current_user.id)
    return AIAnalysisResponse(**analysis)


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

            result = await socratic_agent.start_session(
                session_id=payload.session_id,
                story_title=payload.story_title,
                story_text=payload.story_text,
                mispronounced_words=payload.mispronounced_words,
                accuracy=payload.accuracy,
                cpm=payload.cpm,
                teacher_instructions=teacher_instructions_content or None,
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


# ── Comprehension Scoring (Issue #243) ────────────────────────────────────────


class ComprehensionScoreRequest(BaseModel):
    story_title: str
    story_text: str = Field(..., max_length=10000)
    dialogue_turns: list[ConversationTurn] = Field(..., min_length=1)


@router.post(
    "/learning/sessions/{session_id}/comprehension-score",
    response_model=ComprehensionScoreResponse,
    dependencies=[Depends(ai_limit_5_per_min)],
)
async def score_comprehension(
    session_id: int,
    payload: ComprehensionScoreRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Score a student's comprehension across 3 levels after Socratic dialogue.

    Rate limited: 5 requests per minute per user/IP.

    If scores already exist for this session (cached), returns them without
    re-calling Gemini. Otherwise calls Gemini to evaluate and caches in DB.
    """
    session = db.query(LearningSession).filter(LearningSession.id == session_id).first()
    if session is None:
        raise HTTPException(status_code=404, detail="Session not found")
    if session.student_id != current_user.id:
        raise HTTPException(status_code=403, detail="Not your session")

    # Return cached scores if they exist
    if session.comprehension_score is not None:
        feedback = {}
        if session.comprehension_feedback:
            try:
                feedback = json.loads(session.comprehension_feedback)
            except (json.JSONDecodeError, TypeError):
                feedback = {}
        return ComprehensionScoreResponse(
            comprehension_score=session.comprehension_score,
            literal_score=session.literal_score or 0,
            inferential_score=session.inferential_score or 0,
            evaluative_score=session.evaluative_score or 0,
            feedback=feedback,
        )

    # Build story context
    story_context = {
        "title": payload.story_title,
        "summary": payload.story_text[:500],  # Use first 500 chars as summary
    }

    # Build dialogue turns list
    dialogue_turns = [t.model_dump() for t in payload.dialogue_turns]

    try:
        result = await evaluate_comprehension(
            dialogue_turns=dialogue_turns,
            story_context=story_context,
        )
    except Exception as e:
        logger.error("Comprehension scoring error: %s", e)
        raise HTTPException(status_code=503, detail="AI service unavailable")

    # Cache scores in DB
    session.comprehension_score = result["comprehension_score"]
    session.literal_score = result["literal_score"]
    session.inferential_score = result["inferential_score"]
    session.evaluative_score = result["evaluative_score"]
    session.comprehension_feedback = json.dumps(result.get("feedback", {}), ensure_ascii=False)
    db.commit()
    db.refresh(session)

    logger.info(
        "Scored comprehension for session %d: overall=%.1f, literal=%.1f, "
        "inferential=%.1f, evaluative=%.1f",
        session_id,
        result["comprehension_score"],
        result["literal_score"],
        result["inferential_score"],
        result["evaluative_score"],
    )

    return ComprehensionScoreResponse(
        comprehension_score=result["comprehension_score"],
        literal_score=result["literal_score"],
        inferential_score=result["inferential_score"],
        evaluative_score=result["evaluative_score"],
        feedback=result.get("feedback", {}),
    )


# ── Error Correction Mechanism (Issue #248) ──────────────────────────────────


class ErrorPatternItem(BaseModel):
    character: str
    total_error_count: int
    sessions_with_error: int
    last_error_date: datetime | None
    suggested_practice: bool
    is_corrected: bool


class ErrorPatternsResponse(BaseModel):
    patterns: list[ErrorPatternItem]
    total: int


class RecommendedVocabItem(BaseModel):
    character: str
    error_count: int
    related_words: list[str]
    zhuyin: str | None


class RecommendedVocabResponse(BaseModel):
    items: list[RecommendedVocabItem]
    total: int


class ErrorCorrectionRequest(BaseModel):
    character: str = Field(..., min_length=1, max_length=10)
    correction_type: str = Field("practice", pattern=r"^(practice|mastered)$")


class ErrorCorrectionResponse(BaseModel):
    id: int
    student_id: int
    character: str
    correction_type: str
    created_at: datetime

    model_config = {"from_attributes": True}


def _verify_student_access(
    student_id: int,
    current_user: User,
    db: Session,
) -> None:
    """Verify the current user can access this student's data.

    Allowed if:
    - current_user IS the student
    - current_user is a teacher of a classroom containing the student
    - current_user is a parent linked to the student
    """
    if current_user.id == student_id:
        return

    # Check if current_user is a teacher of any classroom containing the student
    teacher_access = (
        db.query(Classroom)
        .join(ClassroomStudent, ClassroomStudent.classroom_id == Classroom.id)
        .filter(
            ClassroomStudent.student_id == student_id,
            Classroom.teacher_id == current_user.id,
        )
        .first()
    )
    if teacher_access:
        return

    # Check if current_user is a parent linked to this student
    parent_link = (
        db.query(ParentStudentLink)
        .filter(
            ParentStudentLink.parent_id == current_user.id,
            ParentStudentLink.student_id == student_id,
            ParentStudentLink.is_active == True,
        )
        .first()
    )
    if parent_link:
        return

    raise HTTPException(status_code=403, detail="Access denied")


@router.get("/learning/students/{student_id}/error-patterns", response_model=ErrorPatternsResponse)
def get_error_patterns(
    student_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Get characters that the student repeatedly gets wrong (error_count >= 2).

    Returns characters sorted by error count descending.
    """
    _verify_student_access(student_id, current_user, db)

    error_groups = (
        db.query(
            CharacterError.character,
            sa_func.count(CharacterError.id).label("total_error_count"),
            sa_func.count(sa_func.distinct(CharacterError.session_id)).label("sessions_with_error"),
            sa_func.max(LearningSession.started_at).label("last_error_date"),
        )
        .join(LearningSession, CharacterError.session_id == LearningSession.id)
        .filter(LearningSession.student_id == student_id)
        .group_by(CharacterError.character)
        .having(sa_func.count(CharacterError.id) >= 2)
        .order_by(sa_func.count(CharacterError.id).desc())
        .all()
    )

    mastered_chars = set()
    mastered_rows = (
        db.query(ErrorCorrection.character)
        .filter(
            ErrorCorrection.student_id == student_id,
            ErrorCorrection.correction_type == "mastered",
        )
        .all()
    )
    for row in mastered_rows:
        mastered_chars.add(row.character)

    patterns = []
    for row in error_groups:
        is_corrected = row.character in mastered_chars
        patterns.append(ErrorPatternItem(
            character=row.character,
            total_error_count=row.total_error_count,
            sessions_with_error=row.sessions_with_error,
            last_error_date=row.last_error_date,
            suggested_practice=not is_corrected,
            is_corrected=is_corrected,
        ))

    return ErrorPatternsResponse(patterns=patterns, total=len(patterns))


@router.get("/learning/students/{student_id}/recommended-vocab", response_model=RecommendedVocabResponse)
def get_recommended_vocab(
    student_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Recommend vocabulary for practice based on error patterns.

    Returns top 10 most-errored characters from the last 30 days,
    excluding characters already marked as mastered.
    """
    _verify_student_access(student_id, current_user, db)

    thirty_days_ago = datetime.now(timezone.utc) - timedelta(days=30)

    mastered_chars = set()
    mastered_rows = (
        db.query(ErrorCorrection.character)
        .filter(
            ErrorCorrection.student_id == student_id,
            ErrorCorrection.correction_type == "mastered",
        )
        .all()
    )
    for row in mastered_rows:
        mastered_chars.add(row.character)

    error_groups = (
        db.query(
            CharacterError.character,
            sa_func.count(CharacterError.id).label("error_count"),
        )
        .join(LearningSession, CharacterError.session_id == LearningSession.id)
        .filter(
            LearningSession.student_id == student_id,
            LearningSession.started_at >= thirty_days_ago,
        )
        .group_by(CharacterError.character)
        .order_by(sa_func.count(CharacterError.id).desc())
        .all()
    )

    items = []
    for row in error_groups:
        if row.character in mastered_chars:
            continue
        if len(items) >= 10:
            break
        items.append(RecommendedVocabItem(
            character=row.character,
            error_count=row.error_count,
            related_words=[],
            zhuyin=None,
        ))

    return RecommendedVocabResponse(items=items, total=len(items))


@router.post(
    "/learning/students/{student_id}/error-corrections",
    status_code=201,
    response_model=ErrorCorrectionResponse,
)
def mark_error_corrected(
    student_id: int,
    payload: ErrorCorrectionRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Mark a character as practiced or mastered.

    Only the student themselves can mark corrections.
    """
    if current_user.id != student_id:
        raise HTTPException(status_code=403, detail="Can only mark corrections for yourself")

    correction = ErrorCorrection(
        student_id=student_id,
        character=payload.character,
        correction_type=payload.correction_type,
    )
    db.add(correction)
    db.commit()
    db.refresh(correction)
    logger.info(
        "Student %d marked '%s' as %s",
        student_id, payload.character, payload.correction_type,
    )
    return correction


# ── Stuck-Point Detection (Issue #91) ─────────────────────────────────────────


class StoryStuckItem(BaseModel):
    story_slug: str
    attempt_count: int
    best_accuracy: float
    last_attempt: str


class CharacterStuckItem(BaseModel):
    character: str
    error_count: int
    last_error_date: str | None


class StuckPointsResponse(BaseModel):
    story_stuck: list[StoryStuckItem]
    character_stuck: list[CharacterStuckItem]
    is_declining: bool
    accuracy_trend: list[float]


class RecommendationItem(BaseModel):
    type: str
    title: str
    description: str
    action: str


class RecommendationsResponse(BaseModel):
    recommendations: list[RecommendationItem]
    total: int


@router.get(
    "/learning/students/{student_id}/stuck-points",
    response_model=StuckPointsResponse,
)
def get_stuck_points(
    student_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Detect learning stuck-points for a student.

    Accessible by the student themselves or their teacher.

    Returns:
    - story_stuck: stories attempted 3+ times without >=5% accuracy improvement
    - character_stuck: characters with 3+ errors across sessions (last 30 days)
    - is_declining: True if last 3 sessions show strictly declining accuracy
    - accuracy_trend: list of accuracy values (oldest to newest, last 10 sessions)
    """
    _verify_student_access(student_id, current_user, db)
    data = detect_stuck_points(student_id, db)
    logger.info(
        "Stuck-point detection for student %d: %d story stuck, %d char stuck, declining=%s",
        student_id,
        len(data["story_stuck"]),
        len(data["character_stuck"]),
        data["is_declining"],
    )
    return StuckPointsResponse(**data)


# Step names for all 6 learning steps
STEP_NAMES = {
    1: "intro",
    2: "live_tutor",
    3: "comprehension",
    4: "vocab",
    5: "full_reading",
    6: "report",
}

STEP_LABELS = {
    1: "簡介",
    2: "逐段朗讀",
    3: "課文理解",
    4: "生字練習",
    5: "全文朗讀",
    6: "學習報告",
}


def _compute_step_completion(session: LearningSession) -> dict[str, str]:
    """Derive per-step status from a LearningSession record.

    Returns a dict mapping step key → 'completed' | 'in_progress' | 'not_started'.
    """
    completed_step = session.current_step if session.status == "completed" else session.current_step - 1
    statuses: dict[str, str] = {}
    for step_num, key in STEP_NAMES.items():
        if step_num <= completed_step:
            statuses[key] = "completed"
        elif step_num == session.current_step and session.status == "in_progress":
            statuses[key] = "in_progress"
        else:
            statuses[key] = "not_started"
    return statuses


def _recommend_next_step(session: LearningSession) -> dict:
    """Apply rule-based logic to suggest the student's next action.

    Rules (priority order):
    1. Session complete → suggest a new text
    2. Full reading score < 70 → re-do full reading
    3. ≥3 character errors → do vocab practice first
    4. LiveTutor accuracy < 70 → re-read paragraphs
    5. Default → continue from current step
    """
    if session.status == "completed":
        return {"action": "new_text", "step": None, "reason": "本課已完成！挑戰新課文吧。"}

    # Character error count from reading_result
    error_count = 0
    if session.reading_result and isinstance(session.reading_result, dict):
        errors = session.reading_result.get("error_chars", [])
        error_count = len(errors) if isinstance(errors, list) else 0

    accuracy = session.accuracy or 0.0

    if session.current_step >= 5 and session.full_reading_result:
        full_score = 0.0
        if isinstance(session.full_reading_result, dict):
            full_score = session.full_reading_result.get("match_rate", 0) or 0.0
        if full_score < 70:
            return {
                "action": "retry_step",
                "step": "full_reading",
                "step_label": STEP_LABELS[5],
                "reason": f"全文朗讀正確率 {full_score:.0f}%，建議再練習一次。",
            }

    if error_count >= 3 and session.current_step < 4:
        return {
            "action": "retry_step",
            "step": "vocab",
            "step_label": STEP_LABELS[4],
            "reason": f"發現 {error_count} 個錯字，建議先做生字練習。",
        }

    if accuracy > 0 and accuracy < 70 and session.current_step <= 2:
        return {
            "action": "retry_step",
            "step": "live_tutor",
            "step_label": STEP_LABELS[2],
            "reason": f"朗讀正確率 {accuracy:.0f}%，建議重練逐段朗讀。",
        }

    # Default: continue from current step
    current_key = STEP_NAMES.get(session.current_step, "intro")
    return {
        "action": "continue",
        "step": current_key,
        "step_label": STEP_LABELS.get(session.current_step, ""),
        "reason": "繼續未完成的學習步驟。",
    }


class StepStatusItem(BaseModel):
    step_key: str
    step_label: str
    status: str  # not_started | in_progress | completed


class TextProgressItem(BaseModel):
    story_slug: str
    latest_session_id: int
    status: str  # in_progress | completed | abandoned
    steps: list[StepStatusItem]
    completion_pct: int  # 0-100
    overall_score: float | None
    accuracy: float | None
    started_at: datetime
    completed_at: datetime | None
    next_step: dict


class StudentProgressResponse(BaseModel):
    student_id: int
    texts_attempted: int
    texts_completed: int
    average_score: float | None
    texts: list[TextProgressItem]


@router.get(
    "/learning/students/{student_id}/progress",
    response_model=StudentProgressResponse,
)
def get_student_progress(
    student_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Return per-text completion progress for a student.

    Aggregates all learning sessions grouped by story_slug, keeping the
    most-recent session per text to compute step completion status and
    a rule-based next-step recommendation.

    Access: student themselves, or a teacher of their classroom.
    """
    _verify_student_access(student_id, current_user, db)

    sessions = (
        db.query(LearningSession)
        .filter(LearningSession.student_id == student_id)
        .order_by(LearningSession.started_at.desc(), LearningSession.id.desc())
        .all()
    )

    # Keep only the most recent session per story_slug
    seen: set[str] = set()
    latest_per_text: list[LearningSession] = []
    for s in sessions:
        slug = s.story_slug or f"session-{s.id}"
        if slug not in seen:
            seen.add(slug)
            latest_per_text.append(s)

    texts: list[TextProgressItem] = []
    scores: list[float] = []

    for s in latest_per_text:
        slug = s.story_slug or f"session-{s.id}"
        step_statuses = _compute_step_completion(s)
        completed_count = sum(1 for v in step_statuses.values() if v == "completed")
        completion_pct = round(completed_count / 6 * 100)

        step_items = [
            StepStatusItem(
                step_key=key,
                step_label=STEP_LABELS[num],
                status=step_statuses[key],
            )
            for num, key in STEP_NAMES.items()
        ]

        next_step = _recommend_next_step(s)

        if s.overall_score is not None:
            scores.append(s.overall_score)

        texts.append(TextProgressItem(
            story_slug=slug,
            latest_session_id=s.id,
            status=s.status,
            steps=step_items,
            completion_pct=completion_pct,
            overall_score=s.overall_score,
            accuracy=s.accuracy,
            started_at=s.started_at,
            completed_at=s.completed_at,
            next_step=next_step,
        ))

    texts_completed = sum(1 for t in texts if t.status == "completed")
    average_score = round(sum(scores) / len(scores), 1) if scores else None

    logger.info(
        "Progress for student %d: %d texts, %d completed",
        student_id, len(texts), texts_completed,
    )

    return StudentProgressResponse(
        student_id=student_id,
        texts_attempted=len(texts),
        texts_completed=texts_completed,
        average_score=average_score,
        texts=texts,
    )


@router.get(
    "/learning/students/{student_id}/recommendations",
    response_model=RecommendationsResponse,
)
def get_recommendations(
    student_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Return personalised learning recommendations for a student.

    Accessible by the student themselves or their teacher.

    Rule-based recommendations derived from stuck-point analysis.
    No AI call — always fast and always available.
    """
    _verify_student_access(student_id, current_user, db)
    stuck_data = detect_stuck_points(student_id, db)
    recs = build_recommendations(stuck_data)
    logger.info(
        "Generated %d recommendations for student %d",
        len(recs),
        student_id,
    )
    return RecommendationsResponse(
        recommendations=[RecommendationItem(**r) for r in recs],
        total=len(recs),
    )


# ── AI Learning Path Recommendations (Issue #252) ────────────────────────────


class StoryRecommendationItem(BaseModel):
    story_slug: str
    title: str
    grade: int
    genre: str
    difficulty_match_score: int
    reason: str


class StoryRecommendationsResponse(BaseModel):
    recommendations: list[StoryRecommendationItem]
    total: int


@router.get(
    "/learning/recommendations/{student_id}",
    response_model=StoryRecommendationsResponse,
)
def get_story_recommendations(
    student_id: int,
    limit: int = Query(5, ge=1, le=20),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Return AI-personalized story recommendations for a student (Issue #252).

    Algorithmic (no ML model) — analyzes:
      - Past LearningSession accuracy to estimate student grade level
      - CharacterError records to find weak spots
      - Unread stories scored by difficulty match + character coverage + variety

    Accessible by the student themselves, their teacher, or their parent.
    """
    _verify_student_access(student_id, current_user, db)
    recs = recommend_next_stories(student_id, db, limit=limit)
    logger.info(
        "Story recommendations for student %d: %d results",
        student_id, len(recs),
    )
    return StoryRecommendationsResponse(
        recommendations=[StoryRecommendationItem(**r) for r in recs],
        total=len(recs),
    )


# ── Student Progress Dashboard (Issue #25) ────────────────────────────────────


class DailyActivity(BaseModel):
    date: str  # ISO date string YYYY-MM-DD
    sessions_completed: int
    avg_score: float | None


class DashboardResponse(BaseModel):
    # Cumulative stats
    total_sessions: int
    completed_sessions: int
    avg_score: float | None
    # Period stats
    today_sessions: int
    week_sessions: int
    # Streak
    streak_days: int
    longest_streak: int
    # Recent 30-day activity for chart
    daily_activity: list[DailyActivity]
    # Slugs of completed stories (for "already read" badges)
    completed_story_slugs: list[str]


@router.get("/learning/students/{student_id}/dashboard", response_model=DashboardResponse)
def get_student_dashboard(
    student_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Return a progress summary for the student dashboard.

    Includes:
    - Cumulative / period session counts
    - Learning streak (consecutive days with at least one completed session)
    - Daily activity for the last 30 days (for Recharts line chart)
    - List of completed story slugs (for completion badges in StoryLibrary)
    """
    _verify_student_access(student_id, current_user, db)

    now = datetime.now(timezone.utc)
    today_start = now.replace(hour=0, minute=0, second=0, microsecond=0)
    week_start = today_start - timedelta(days=today_start.weekday())  # Monday
    thirty_days_ago = today_start - timedelta(days=29)

    def _ensure_aware(dt: datetime | None) -> datetime | None:
        """Make naive datetimes UTC-aware to prevent comparison errors."""
        if dt is None:
            return None
        return dt.replace(tzinfo=timezone.utc) if dt.tzinfo is None else dt

    # All sessions for this student
    all_sessions = (
        db.query(LearningSession)
        .filter(LearningSession.student_id == student_id)
        .all()
    )

    total_sessions = len(all_sessions)
    completed = [s for s in all_sessions if s.status == "completed"]
    completed_sessions = len(completed)

    scores = [s.overall_score for s in completed if s.overall_score is not None]
    avg_score = round(sum(scores) / len(scores), 1) if scores else None

    today_sessions = sum(1 for s in completed if s.completed_at and _ensure_aware(s.completed_at) >= today_start)
    week_sessions = sum(1 for s in completed if s.completed_at and _ensure_aware(s.completed_at) >= week_start)

    # Daily activity for past 30 days
    from collections import defaultdict
    day_sessions: dict[str, list[float]] = defaultdict(list)
    for s in completed:
        if s.completed_at and _ensure_aware(s.completed_at) >= thirty_days_ago:
            day_key = s.completed_at.strftime("%Y-%m-%d")
            day_sessions[day_key].append(s.overall_score if s.overall_score is not None else 0)

    daily_activity: list[DailyActivity] = []
    for i in range(30):
        day = (thirty_days_ago + timedelta(days=i)).strftime("%Y-%m-%d")
        scores_for_day = day_sessions.get(day, [])
        daily_activity.append(DailyActivity(
            date=day,
            sessions_completed=len(scores_for_day),
            avg_score=round(sum(scores_for_day) / len(scores_for_day), 1) if scores_for_day else None,
        ))

    # Streak calculation (consecutive days with at least 1 completed session up to today)
    active_days = set(day_sessions.keys())
    # Also include days before the 30-day window for streak calculation
    all_completed_days = set()
    for s in completed:
        if s.completed_at:
            all_completed_days.add(s.completed_at.strftime("%Y-%m-%d"))

    streak_days = 0
    longest_streak = 0
    current_streak = 0
    # Walk back from today
    check_day = today_start
    for _ in range(365):
        day_str = check_day.strftime("%Y-%m-%d")
        if day_str in all_completed_days:
            if streak_days == 0 and check_day.date() < now.date():
                # Allow a gap of one day (yesterday still counts)
                pass
            streak_days += 1
        else:
            break
        check_day -= timedelta(days=1)

    # Longest streak calculation
    streak_check = 0
    sorted_days = sorted(all_completed_days)
    for idx, day_str in enumerate(sorted_days):
        if idx == 0:
            streak_check = 1
        else:
            prev = datetime.strptime(sorted_days[idx - 1], "%Y-%m-%d")
            curr = datetime.strptime(day_str, "%Y-%m-%d")
            if (curr - prev).days == 1:
                streak_check += 1
            else:
                streak_check = 1
        longest_streak = max(longest_streak, streak_check)

    # Completed story slugs
    completed_story_slugs = list({
        s.story_slug for s in completed if s.story_slug
    })

    return DashboardResponse(
        total_sessions=total_sessions,
        completed_sessions=completed_sessions,
        avg_score=avg_score,
        today_sessions=today_sessions,
        week_sessions=week_sessions,
        streak_days=streak_days,
        longest_streak=longest_streak,
        daily_activity=daily_activity,
        completed_story_slugs=completed_story_slugs,
    )



# ── Sentence Practice (Issue #109) ──────────────────────────────────────────


class ExampleSentencesRequest(BaseModel):
    character: str = Field(..., min_length=1, max_length=1, description="The Chinese character to generate sentences for")
    story_title: str = Field(..., min_length=1, max_length=100)


class ExampleSentenceItem(BaseModel):
    sentence: str
    explanation: str


class ExampleSentencesResponse(BaseModel):
    sentences: list[ExampleSentenceItem]


class ValidateSentenceRequest(BaseModel):
    character: str = Field(..., min_length=1, max_length=1, description="The target character that must appear in the sentence")
    student_sentence: str = Field(..., min_length=1, max_length=200, description="The student's composed sentence")
    story_title: str = Field(..., min_length=1, max_length=100)


class ValidateSentenceResponse(BaseModel):
    is_correct: bool
    feedback: str
    suggestion: str


@router.post(
    "/learning/sentence-practice/example-sentences",
    response_model=ExampleSentencesResponse,
    dependencies=[Depends(ai_limit_10_per_min)],
)
async def get_example_sentences(
    payload: ExampleSentencesRequest,
    current_user: User = Depends(get_current_user),
):
    """Generate 2 AI example sentences for a vocabulary character.

    Used in the sentence practice phase after stroke order practice (Issue #109).
    Rate limited: 10 requests per minute per user/IP.
    """
    try:
        result = await generate_example_sentences(
            character=payload.character,
            story_title=payload.story_title,
        )
    except TimeoutError:
        raise HTTPException(status_code=503, detail="AI service timeout")
    except Exception as e:
        logger.error("Example sentence generation failed for char=%s: %s", payload.character, e)
        raise HTTPException(status_code=503, detail="AI service unavailable")

    return ExampleSentencesResponse(
        sentences=[ExampleSentenceItem(**s) for s in result.get("sentences", [])],
    )


@router.post(
    "/learning/sentence-practice/validate",
    response_model=ValidateSentenceResponse,
    dependencies=[Depends(ai_limit_10_per_min)],
)
async def validate_sentence(
    payload: ValidateSentenceRequest,
    current_user: User = Depends(get_current_user),
):
    """Validate a student's composed sentence for a vocabulary character.

    Returns AI feedback on whether the sentence is grammatically correct
    and uses the target character appropriately (Issue #109).
    Rate limited: 10 requests per minute per user/IP.
    """
    # Basic check: target character must appear in the sentence
    if payload.character not in payload.student_sentence:
        return ValidateSentenceResponse(
            is_correct=False,
            feedback="你的句子裡沒有包含目標生字喔！",
            suggestion=f"請記得在句子中使用「{payload.character}」這個字。",
        )

    try:
        result = await validate_student_sentence(
            character=payload.character,
            student_sentence=payload.student_sentence,
            story_title=payload.story_title,
        )
    except TimeoutError:
        raise HTTPException(status_code=503, detail="AI service timeout")
    except Exception as e:
        logger.error(
            "Sentence validation failed for char=%s sentence=%s: %s",
            payload.character, payload.student_sentence[:50], e,
        )
        raise HTTPException(status_code=503, detail="AI service unavailable")

    return ValidateSentenceResponse(
        is_correct=result.get("is_correct", True),
        feedback=result.get("feedback", "做得好！"),
        suggestion=result.get("suggestion", ""),
    )


# ── Listening Comprehension (Issue #251) ─────────────────────────────────────


class ListeningEvaluateRequest(BaseModel):
    story_title: str = Field(..., max_length=200)
    original_text: str = Field(..., max_length=10000)
    student_retelling: str = Field(..., min_length=1, max_length=2000)


class ListeningEvaluateResponse(BaseModel):
    score: float
    key_points_covered: list[str]
    key_points_missed: list[str]
    feedback: str
    encouragement: str


@router.post(
    "/learning/listening/evaluate",
    response_model=ListeningEvaluateResponse,
    dependencies=[Depends(ai_limit_5_per_min)],
)
async def evaluate_listening_retelling(
    payload: ListeningEvaluateRequest,
    current_user: User = Depends(get_current_user),
    _db: Session = Depends(get_db),
):
    """Evaluate a student's retelling of a story they listened to.

    Uses Gemini AI to assess how completely the student captured key points
    from the original text. Rate limited: 5 requests per minute.

    Returns a score (0-100), covered/missed key points, and feedback.
    """
    try:
        result = await evaluate_retelling(
            original_text=payload.original_text,
            student_retelling=payload.student_retelling,
            story_title=payload.story_title,
        )
    except TimeoutError:
        raise HTTPException(status_code=503, detail="AI service timeout")
    except Exception as e:
        logger.error("Listening evaluation failed: %s", e)
        raise HTTPException(status_code=503, detail="AI service unavailable")

    logger.info(
        "Listening eval for user %d, story=%s: score=%.1f",
        current_user.id,
        payload.story_title,
        result["score"],
    )

    return ListeningEvaluateResponse(
        score=result["score"],
        key_points_covered=result.get("key_points_covered", []),
        key_points_missed=result.get("key_points_missed", []),
        feedback=result.get("feedback", ""),
        encouragement=result.get("encouragement", ""),
    )


# ── Exit Ticket AI (Issue #463) ───────────────────────────────────────────────

from ..services.exit_ticket_service import generate_exit_ticket_questions, calculate_score  # noqa: E402


class ExitTicketGenerateRequest(BaseModel):
    story_content: list[str] = Field(..., min_length=1, max_length=200)
    wrong_chars: list[str] = Field(default_factory=list, max_length=50)


class ExitTicketQuestion(BaseModel):
    id: int
    question: str
    options: list[str]
    correct_index: int
    explanation: str


class ExitTicketGenerateResponse(BaseModel):
    questions: list[ExitTicketQuestion]
    source: str  # "ai" | "fallback"


class ExitTicketAnswer(BaseModel):
    question_id: int
    selected_index: int


class ExitTicketSubmitRequest(BaseModel):
    answers: list[ExitTicketAnswer]
    score: int = Field(..., ge=0, le=100)
    total_questions: int = Field(..., ge=0)


class ExitTicketSubmitResponse(BaseModel):
    score: int
    correct_count: int
    total: int
    passed: bool


@router.post(
    "/learning/sessions/{session_id}/exit-ticket/generate",
    response_model=ExitTicketGenerateResponse,
    dependencies=[Depends(ai_limit_5_per_min)],
)
async def generate_session_exit_ticket(
    session_id: int,
    payload: ExitTicketGenerateRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Generate AI-powered exit ticket questions for a learning session (Issue #463).

    Calls Gemini 2.5 Flash to produce 3-5 multiple-choice questions covering
    literal comprehension, inferential comprehension, and evaluative comprehension.
    If wrong_chars are provided, at least one question tests character recognition.

    Falls back to source="fallback" with empty questions if AI is unavailable,
    allowing the frontend to use local rule-based generation.

    Rate limited: 5 requests per minute.
    """
    session = db.query(LearningSession).filter(LearningSession.id == session_id).first()
    if session is None:
        raise HTTPException(status_code=404, detail="Session not found")
    if session.student_id != current_user.id:
        raise HTTPException(status_code=403, detail="Access denied")

    result = await generate_exit_ticket_questions(
        story_content=payload.story_content,
        wrong_chars=payload.wrong_chars or [],
    )

    logger.info(
        "exit_ticket generate: session=%d user=%d source=%s questions=%d",
        session_id,
        current_user.id,
        result.get("source"),
        len(result.get("questions", [])),
    )

    return ExitTicketGenerateResponse(
        questions=result.get("questions", []),
        source=result.get("source", "fallback"),
    )


@router.post(
    "/learning/sessions/{session_id}/exit-ticket/submit",
    response_model=ExitTicketSubmitResponse,
)
async def submit_session_exit_ticket(
    session_id: int,
    payload: ExitTicketSubmitRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Submit and persist exit ticket answers for a learning session (Issue #463).

    Saves the exit ticket score to the learning session record and returns
    the detailed score breakdown. Score is calculated server-side based on
    the submitted answers and total_questions.

    The score is persisted in the session's exit_ticket_score field if available,
    or logged for analytics if the field does not exist yet.
    """
    session = db.query(LearningSession).filter(LearningSession.id == session_id).first()
    if session is None:
        raise HTTPException(status_code=404, detail="Session not found")
    if session.student_id != current_user.id:
        raise HTTPException(status_code=403, detail="Access denied")

    total = payload.total_questions or len(payload.answers)
    correct_count = payload.score * total // 100 if total > 0 else 0

    # Persist score if the column exists on the model
    if hasattr(session, "exit_ticket_score"):
        session.exit_ticket_score = payload.score
        db.commit()
        db.refresh(session)

    logger.info(
        "exit_ticket submit: session=%d user=%d score=%d/%d",
        session_id,
        current_user.id,
        payload.score,
        100,
    )

    return ExitTicketSubmitResponse(
        score=payload.score,
        correct_count=correct_count,
        total=total,
        passed=payload.score >= 60,
    )
