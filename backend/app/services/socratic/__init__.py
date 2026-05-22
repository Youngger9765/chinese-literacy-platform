"""
Socratic dialogue agent with answer evaluation.
Manages session state, evaluates student comprehension, and generates
follow-up questions using structured Gemini output.
"""

import logging
from dataclasses import dataclass

from google.genai import types as genai_types
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from ..ai_service import generate_structured_response
from ..input_sanitizer import sanitize_ai_input
from .models import SessionState
from .prompt_builder import build_system_prompt
from .session_store import SessionStore
from .state_machine import PHASE_ORDER, determine_phase, rebuild_state_from_turns

logger = logging.getLogger(__name__)


# Module-level singleton
_store = SessionStore()


# Gemini response schema for structured output
EVALUATION_SCHEMA = {
    "type": "object",
    "properties": {
        "understood": {
            "type": "boolean",
            "description": "Whether the student's answer demonstrates understanding of the question",
        },
        "feedback": {
            "type": "string",
            "description": "Brief, warm feedback on the student's answer (1-2 sentences in Traditional Chinese)",
        },
        "question": {
            "type": "string",
            "description": "The next Socratic question in Traditional Chinese",
        },
        "phase": {
            "type": "string",
            "enum": ["factual", "inferential", "evaluative"],
            "description": "The phase of the next question",
        },
        "referenced_paragraph": {
            "type": "INTEGER",
            "description": "答錯時，答案所在的段落編號（從 1 開始）。答對時為 null。",
            "nullable": True,
        },
    },
    "required": ["understood", "feedback", "question", "phase"],
}


@dataclass
class AgentResponse:
    question: str
    feedback: str | None
    understood: bool | None
    understood_count: int
    required_count: int
    phase: str
    is_complete: bool
    referenced_paragraph: int | None = None


class SocraticAgent:
    REQUIRED_UNDERSTOOD = 5
    MAX_ANSWER_LENGTH = 500
    MAX_HISTORY_TURNS = 10
    MAX_CONSECUTIVE_ERRORS = 3

    def _build_system_prompt(self, state: SessionState) -> str:
        return build_system_prompt(state)

    async def start_session(
        self,
        session_id: str,
        story_title: str,
        story_text: str,
        mispronounced_words: list[str] | None = None,
        accuracy: float | None = None,
        cpm: float | None = None,
        teacher_instructions: list[str] | None = None,
        genre: str | None = None,
        reading_strategy: str | None = None,
        db: Session | None = None,
        db_session_id: int | None = None,
    ) -> tuple["AgentResponse", bool]:
        """Start or resume a session.

        Returns (AgentResponse, is_resumed).
        is_resumed=True means the session was restored from memory or DB (no Gemini call).
        is_resumed=False means a fresh Gemini call was made.
        """
        # 1. Check in-memory cache first; fall back to dialogue_state DB snapshot (Issue #961)
        existing_state = _store.get(session_id, db=db, db_session_id=db_session_id)
        if existing_state is not None:
            last_ai_turn = next(
                (t for t in reversed(existing_state.conversation) if t["role"] == "ai"),
                None,
            )
            question = last_ai_turn["text"] if last_ai_turn else "請繼續回答上一個問題。"
            return AgentResponse(
                question=question,
                feedback=None,
                understood=None,
                understood_count=existing_state.understood_count,
                required_count=self.REQUIRED_UNDERSTOOD,
                phase=existing_state.current_phase,
                is_complete=existing_state.understood_count >= self.REQUIRED_UNDERSTOOD,
            ), True

        # 2. Try to restore from DB turns (survives Cloud Run restart)
        if db is not None and db_session_id is not None:
            try:
                # Import here to avoid circular imports at module load time
                from ...models.session import DialogueTurn  # noqa: PLC0415

                turns = (
                    db.query(DialogueTurn)
                    .filter(DialogueTurn.learning_session_id == db_session_id)
                    .order_by(DialogueTurn.turn_order)
                    .all()
                )

                if turns:
                    state = self._rebuild_state_from_turns(
                        turns=turns,
                        session_id=session_id,
                        story_title=story_title,
                        story_text=story_text,
                        mispronounced_words=mispronounced_words,
                        accuracy=accuracy,
                        cpm=cpm,
                        teacher_instructions=teacher_instructions,
                        genre=genre,
                        reading_strategy=reading_strategy,
                    )
                    _store.save(state, db=db, db_session_id=db_session_id)
                    last_ai_turn = next(
                        (t for t in reversed(state.conversation) if t["role"] == "ai"),
                        None,
                    )
                    question = last_ai_turn["text"] if last_ai_turn else "請繼續回答上一個問題。"
                    return AgentResponse(
                        question=question,
                        feedback=None,
                        understood=None,
                        understood_count=state.understood_count,
                        required_count=self.REQUIRED_UNDERSTOOD,
                        phase=state.current_phase,
                        is_complete=state.understood_count >= self.REQUIRED_UNDERSTOOD,
                    ), True
            except (SQLAlchemyError, AttributeError, KeyError) as e:
                logger.warning("Failed to restore session from DB turns (will start fresh): %s", e)

        # 3. Fresh start — only Gemini call that's actually needed
        state = SessionState(
            session_id=session_id,
            story_title=story_title,
            story_text=story_text,
            mispronounced_words=mispronounced_words,
            accuracy=accuracy,
            cpm=cpm,
            teacher_instructions=teacher_instructions,
            genre=genre,
            reading_strategy=reading_strategy,
        )

        system_prompt = self._build_system_prompt(state)
        contents = [
            genai_types.Content(
                role="user",
                parts=[genai_types.Part(text="請開始提問。請提出第一個事實性問題。")],
            )
        ]

        try:
            result = await generate_structured_response(
                system_prompt=system_prompt,
                contents=contents,
                response_schema=EVALUATION_SCHEMA,
                task="socratic_question",
            )
            question = result.get("question", "這篇課文的主角是誰？")
            phase = result.get("phase", "factual")
        except Exception as e:
            logger.warning("AI service error in start_session: %s", e)
            question = "這篇課文的主角是誰？他（她）做了什麼事？"
            phase = "factual"

        state.current_phase = phase
        state.conversation.append({"role": "ai", "text": question})
        _store.save(state, db=db, db_session_id=db_session_id)

        return AgentResponse(
            question=question,
            feedback=None,
            understood=None,
            understood_count=0,
            required_count=self.REQUIRED_UNDERSTOOD,
            phase=phase,
            is_complete=False,
        ), False

    def _rebuild_state_from_turns(
        self,
        turns: list,
        session_id: str,
        story_title: str,
        story_text: str,
        mispronounced_words: list[str] | None,
        accuracy: float | None,
        cpm: float | None,
        teacher_instructions: list[str] | None,
        genre: str | None,
        reading_strategy: str | None,
    ) -> "SessionState":
        return rebuild_state_from_turns(
            turns=turns,
            session_id=session_id,
            story_title=story_title,
            story_text=story_text,
            mispronounced_words=mispronounced_words,
            accuracy=accuracy,
            cpm=cpm,
            teacher_instructions=teacher_instructions,
            genre=genre,
            reading_strategy=reading_strategy,
        )

    def clear_session(
        self,
        session_id: str,
        db: Session | None = None,
        db_session_id: int | None = None,
    ) -> None:
        """Remove a session from memory and optionally delete its DB turns.

        Called when the student clicks '重新開始'.
        """
        # Remove from in-memory store
        if session_id in _store._sessions:
            del _store._sessions[session_id]

        # Delete DB turns and dialogue_state snapshot so next mount starts fresh
        if db is not None and db_session_id is not None:
            try:
                from ...models.session import DialogueTurn, LearningSession  # noqa: PLC0415

                db.query(DialogueTurn).filter(
                    DialogueTurn.learning_session_id == db_session_id
                ).delete(synchronize_session=False)

                ls = db.query(LearningSession).filter_by(id=db_session_id).first()
                if ls is not None:
                    ls.dialogue_state = None

                db.commit()
            except SQLAlchemyError as e:
                logger.warning("Failed to delete DB dialogue turns on restart: %s", e)

    async def process_answer(
        self,
        session_id: str,
        student_answer: str,
        db: Session | None = None,
        db_session_id: int | None = None,
    ) -> AgentResponse:
        """Process a student's answer, evaluate understanding, return next question."""
        # Rate limiting check
        if _store.check_rate_limit(session_id):
            raise ValueError("Rate limit exceeded. Please wait before sending another answer.")

        # Input validation
        if not student_answer or not student_answer.strip():
            raise ValueError("Answer cannot be empty")
        if len(student_answer) > self.MAX_ANSWER_LENGTH:
            raise ValueError(f"Answer too long (max {self.MAX_ANSWER_LENGTH} characters)")
        student_answer = student_answer.strip()

        # Sanitize input to prevent prompt injection (Issue #270)
        student_answer, _was_sanitized = sanitize_ai_input(
            student_answer, user_id=session_id
        )

        state = _store.get(session_id, db=db, db_session_id=db_session_id)
        if state is None:
            raise ValueError(f"Session {session_id} not found or expired")

        state.conversation.append({"role": "student", "text": student_answer})
        state.total_attempts += 1

        # Truncate conversation history to keep only last N turns
        if len(state.conversation) > self.MAX_HISTORY_TURNS:
            # Keep first turn (initial question) + last MAX_HISTORY_TURNS-1 turns
            state.conversation = [state.conversation[0]] + state.conversation[-(self.MAX_HISTORY_TURNS - 1):]

        system_prompt = self._build_system_prompt(state)

        # Build Gemini contents from conversation
        contents: list[genai_types.Content] = [
            genai_types.Content(
                role="user",
                parts=[genai_types.Part(text="請開始提問。")],
            )
        ]
        for turn in state.conversation:
            role = "model" if turn["role"] == "ai" else "user"
            contents.append(
                genai_types.Content(
                    role=role,
                    parts=[genai_types.Part(text=turn["text"])],
                )
            )
        # Ensure last message is from user
        if contents[-1].role == "model":
            contents.append(
                genai_types.Content(
                    role="user",
                    parts=[genai_types.Part(text="請根據我的回答進行評估，然後繼續提問。")],
                )
            )

        try:
            result = await generate_structured_response(
                system_prompt=system_prompt,
                contents=contents,
                response_schema=EVALUATION_SCHEMA,
                task="socratic_agent_process",
            )
            understood = result.get("understood", False)
            feedback = result.get("feedback", "")
            question = result.get("question", "")
            phase = result.get("phase", state.current_phase)
            referenced_paragraph = result.get("referenced_paragraph")

            # Validate referenced_paragraph bounds
            num_paragraphs = len([p for p in state.story_text.split("\n") if p.strip()])
            if referenced_paragraph is not None:
                if not isinstance(referenced_paragraph, int) or referenced_paragraph < 1 or referenced_paragraph > num_paragraphs:
                    logger.warning("Invalid referenced_paragraph %s (valid: 1-%d), resetting to None", referenced_paragraph, num_paragraphs)
                    referenced_paragraph = None

            # Validate phase
            if phase not in PHASE_ORDER:
                logger.warning("Invalid phase '%s', using current: %s", phase, state.current_phase)
                phase = state.current_phase

            # Validate question is non-empty
            if not question or not question.strip():
                question = _fallback_question(state)

            state.consecutive_errors = 0  # Reset on success

        except Exception as e:
            state.consecutive_errors += 1
            logger.warning(
                "AI service error in process_answer (attempt %d/%d): %s",
                state.consecutive_errors,
                self.MAX_CONSECUTIVE_ERRORS,
                e,
                extra={
                    "event": "socratic_ai_error",
                    "consecutive_errors": state.consecutive_errors,
                    "max_consecutive_errors": self.MAX_CONSECUTIVE_ERRORS,
                    "session_id": session_id,
                    "error": str(e),
                },
            )

            if state.consecutive_errors >= self.MAX_CONSECUTIVE_ERRORS:
                logger.error(
                    "Circuit breaker triggered: %d consecutive AI errors for session %s",
                    state.consecutive_errors,
                    session_id,
                    extra={
                        "event": "circuit_breaker_triggered",
                        "consecutive_errors": state.consecutive_errors,
                        "session_id": session_id,
                    },
                )
                _store.save(state, db=db, db_session_id=db_session_id)
                raise RuntimeError("AI 服務暫時無法使用，請稍後再試。") from e

            understood = False  # Don't auto-pass on error; re-ask instead
            feedback = "讓我再想一下，請你再回答一次好嗎？"
            question = _fallback_question(state)
            phase = state.current_phase
            referenced_paragraph = None

        if understood:
            state.understood_count += 1
            referenced_paragraph = None  # Clear on correct answer
            # Advance phase based on understood count.
            # Phase sets the prompt for the NEXT question, so offset by 1:
            # count 0-1 → factual (Q1-Q2), 2-3 → inferential (Q3-Q4), 4+ → evaluative (Q5)
            state.current_phase = determine_phase(state.understood_count, state.total_attempts)
            phase = state.current_phase

        is_complete = state.understood_count >= self.REQUIRED_UNDERSTOOD

        if not is_complete:
            state.conversation.append({"role": "ai", "text": question})

        _store.save(state, db=db, db_session_id=db_session_id)

        return AgentResponse(
            question=question,
            feedback=feedback,
            understood=understood,
            understood_count=state.understood_count,
            required_count=self.REQUIRED_UNDERSTOOD,
            phase=phase,
            is_complete=is_complete,
            referenced_paragraph=referenced_paragraph,
        )


def _fallback_question(state: SessionState) -> str:
    """Return a pre-written question when AI is unavailable."""
    fallback = {
        "factual": "這篇課文的主角是誰？他（她）做了什麼事？",
        "inferential": "為什麼主角要這樣做？你覺得他的理由合理嗎？",
        "evaluative": "讀完這篇課文，你有什麼感想？如果是你，你會怎麼做？",
    }
    return fallback.get(state.current_phase, fallback["factual"])


# Module-level agent singleton
socratic_agent = SocraticAgent()

__all__ = [
    "AgentResponse",
    "SessionState",
    "SessionStore",
    "SocraticAgent",
    "socratic_agent",
]
