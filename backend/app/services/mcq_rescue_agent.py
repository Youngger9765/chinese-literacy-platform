"""
MCQ Rescue Agent — per-strategy AI tutor for wrong-answer scaffolding.

When a student answers an MCQ incorrectly, this agent runs a 5-step SOP
(per 林國源 principal + 5/1 expert meeting) to guide the student to the
correct answer using strategy-specific scaffolding prompts.

Architecture mirrors socratic_agent.py:
  - SessionStore with TTL + rate limit
  - Circuit breaker: 3 consecutive AI errors → RuntimeError → 503
  - Structured Gemini output with reasoning field on EVERY response
  - Error fallback: should_advance=False (NEVER True on error — auto-passing students on error is catastrophic)

Session key: mcq_rescue_{user_id}_{question_id}
"""

from __future__ import annotations

import asyncio
import logging
import time
from dataclasses import dataclass, field

from google.genai import errors as genai_errors
from google.genai import types as genai_types

from .ai_service import generate_structured_response
from .input_sanitizer import sanitize_ai_input
from .persona import TUTOR_PERSONA
from .strategy_prompts import StrategyPromptError, load_strategy_prompt

# AI-layer exceptions we expect and handle gracefully.
# Any other exception (KeyError, TypeError, AttributeError, JSONDecodeError, …)
# is a *code bug* or SDK regression and must bubble so Sentry sees it.
_AI_ERRORS = (
    genai_errors.APIError,
    asyncio.TimeoutError,
    ValueError,  # sanitize_ai_input may raise
)

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Session State
# ---------------------------------------------------------------------------

@dataclass
class RescueSessionState:
    session_id: str
    user_id: int
    question_id: str
    lesson_id: str
    wrong_choice: str
    question_text: str
    correct_answer: str
    strategy_type: str | None
    # SOP state
    current_step: int = 1          # 1-5
    conversation: list[dict] = field(default_factory=list)   # {role, text}
    consecutive_errors: int = 0
    give_up_count: int = 0         # consecutive "不知道" / "我不會"
    created_at: float = field(default_factory=time.time)
    is_terminated: bool = False


# ---------------------------------------------------------------------------
# Session Store
# ---------------------------------------------------------------------------

class RescueSessionStore:
    """In-memory session store for MCQ rescue dialogues.

    Mirrors SessionStore from socratic_agent.py.
    Key: mcq_rescue_{user_id}_{question_id}
    TTL: 30 minutes (same as Socratic agent)
    Rate limit: 30 requests / 60 seconds per session
    """

    TTL_SECONDS = 30 * 60
    RATE_LIMIT = 30
    RATE_WINDOW = 60

    def __init__(self) -> None:
        self._sessions: dict[str, RescueSessionState] = {}
        self._rate_counts: dict[str, list[float]] = {}

    @staticmethod
    def make_key(user_id: int, question_id: str) -> str:
        return f"mcq_rescue_{user_id}_{question_id}"

    def get(self, session_id: str) -> RescueSessionState | None:
        self._cleanup()
        return self._sessions.get(session_id)

    def save(self, state: RescueSessionState) -> None:
        self._sessions[state.session_id] = state

    def delete(self, session_id: str) -> None:
        self._sessions.pop(session_id, None)

    def check_rate_limit(self, session_id: str) -> bool:
        """Return True if rate limit exceeded."""
        now = time.time()
        timestamps = self._rate_counts.get(session_id, [])
        timestamps = [t for t in timestamps if now - t < self.RATE_WINDOW]
        if len(timestamps) >= self.RATE_LIMIT:
            return True
        timestamps.append(now)
        self._rate_counts[session_id] = timestamps
        return False

    def _cleanup(self) -> None:
        now = time.time()
        expired = [
            sid for sid, s in self._sessions.items()
            if now - s.created_at > self.TTL_SECONDS
        ]
        for sid in expired:
            del self._sessions[sid]


# Module-level singleton
_store = RescueSessionStore()


# ---------------------------------------------------------------------------
# Gemini response schema
# ---------------------------------------------------------------------------

RESCUE_RESPONSE_SCHEMA = {
    "type": "object",
    "properties": {
        "ai_feedback": {
            "type": "string",
            "description": "AI tutor response to the student (1-3 sentences, Traditional Chinese zh-TW)",
        },
        "next_question": {
            "type": "string",
            "description": "Follow-up question or prompt for the student in Traditional Chinese. Empty string if terminating.",
        },
        "should_advance": {
            "type": "boolean",
            "description": "True if the student's answer meets the advance_when criteria for the current step",
        },
        "should_terminate": {
            "type": "boolean",
            "description": "True if the rescue session should end (student passed, gave up, or reached step 5)",
        },
        "give_up_detected": {
            "type": "boolean",
            "description": "True if student appears to be giving up (不知道 / 我不會 / 隨便 / etc.)",
        },
        "current_step": {
            "type": "integer",
            "description": "The step number (1-5) that was just evaluated or is now active",
        },
        "reasoning": {
            "type": "string",
            "description": "Internal reasoning: why should_advance/should_terminate were set as they are. For audit and debugging.",
        },
    },
    "required": [
        "ai_feedback",
        "next_question",
        "should_advance",
        "should_terminate",
        "give_up_detected",
        "current_step",
        "reasoning",
    ],
}


# ---------------------------------------------------------------------------
# Response dataclass
# ---------------------------------------------------------------------------

@dataclass
class RescueResponse:
    current_step: int
    should_advance: bool
    should_terminate: bool
    give_up_detected: bool
    ai_feedback: str
    next_question: str
    reasoning: str


# ---------------------------------------------------------------------------
# Agent
# ---------------------------------------------------------------------------

class McqRescueAgent:
    MAX_ANSWER_LENGTH = 500
    MAX_HISTORY_TURNS = 10
    MAX_CONSECUTIVE_ERRORS = 3
    GIVE_UP_THRESHOLD = 3       # 3 consecutive give-up responses → skip to step 5

    def _build_system_prompt(
        self,
        state: RescueSessionState,
        prompt_data: dict,
    ) -> str:
        step_index = state.current_step - 1
        steps = prompt_data.get("steps", [])
        current_step_data = steps[step_index] if 0 <= step_index < len(steps) else {}

        step_descriptions = "\n".join(
            f"  步驟 {s['step']} [{s.get('name','')}] — {s.get('label','')}：{s.get('intent','')}"
            for s in steps
        )

        tone_lines = "\n".join(f"  - {t}" for t in prompt_data.get("tone", []))

        terminate_conds = prompt_data.get("terminate_conditions", [])
        if isinstance(terminate_conds, list):
            terminate_str = "\n".join(f"  - {c}" for c in terminate_conds)
        else:
            terminate_str = str(terminate_conds)

        return f"""{TUTOR_PERSONA}

你是「MCQ 解題助教」。學生在閱讀理解選擇題答錯了，你的任務是用 5 步驟 SOP 引導他找到正確答案。

【策略類型】{prompt_data.get("display_name", "通用")}
{prompt_data.get("description", "")}

【學生答錯的題目】
題目：{state.question_text}
學生選了：{state.wrong_choice}

【5 步驟 SOP 總覽】
{step_descriptions}

【目前步驟】步驟 {state.current_step} — {current_step_data.get("label", "")}
目標：{current_step_data.get("intent", "")}
advance 條件：{current_step_data.get("advance_when", "")}
fail 條件：{current_step_data.get("fail_when", "")}

引導原則（此步驟）：
{current_step_data.get("sample_prompt", "")}

【結束條件】
{terminate_str}

【語氣規範】
{tone_lines}

評分規則：
- should_advance = true：學生回答達到此步驟的 advance_when 條件
- should_advance = false：學生還沒達到，繼續同一步驟引導
- should_terminate = true：
  (a) 步驟 4 學生選對了（rescue 成功），或
  (b) 步驟 5 完成（已直接教學），或
  (c) 連續 {self.GIVE_UP_THRESHOLD} 次 give_up_detected=true
- give_up_detected = true：學生說「不知道」「隨便」「我不會」「放棄」等敷衍或放棄詞
- reasoning 欄位：必填。說明為什麼你設定了 should_advance / should_terminate 這樣的值

絕對禁止：
- 不可直接給答案，除非到了步驟 5
- 不可說「答案是 X」直到 step 5
- 不可讓學生答錯也 should_advance=true（即使他很接近）
- 不可在 AI 出錯時讓 should_advance=true（錯誤降級必須 should_advance=false）"""

    async def start_session(
        self,
        user_id: int,
        question_id: str,
        lesson_id: str,
        wrong_choice: str,
        question_text: str,
        correct_answer: str,
        strategy_type: str | None,
    ) -> tuple[str, RescueResponse]:
        """Start a new rescue session.

        Returns (session_id, first_response).
        Reuses existing session if one exists for this user+question (idempotent).
        """
        session_id = RescueSessionStore.make_key(user_id, question_id)

        # Idempotent: if session already exists, return the last AI message
        existing = _store.get(session_id)
        if existing is not None and not existing.is_terminated:
            last_ai_text = next(
                (t["text"] for t in reversed(existing.conversation) if t["role"] == "ai"),
                None,
            )
            # Bug 4 fix: populate ai_feedback from history so the frontend
            # never renders a blank bubble when the student reloads.
            resume_msg = last_ai_text or "讓我們繼續——你能告訴我，這題在問什麼嗎？"
            return session_id, RescueResponse(
                current_step=existing.current_step,
                should_advance=False,
                should_terminate=False,
                give_up_detected=False,
                ai_feedback=resume_msg,
                next_question="",
                reasoning="Session resumed from memory.",
            )

        # Bug 3 fix: StrategyPromptError means a required YAML file is missing
        # or malformed — treat as a server-side configuration error (500).
        # Re-raise as RuntimeError so the route's `except RuntimeError → 503`
        # path fires and the frontend gets an explicit error instead of silence.
        try:
            prompt_data = load_strategy_prompt(strategy_type)
        except StrategyPromptError as exc:
            logger.error(
                "Strategy prompt unavailable for strategy_type=%r: %s",
                strategy_type,
                exc,
                extra={"event": "mcq_rescue_strategy_prompt_error", "strategy_type": strategy_type},
            )
            raise RuntimeError(
                f"Strategy prompt unavailable for '{strategy_type}': {exc}"
            ) from exc

        # Validate that the required 'opening' key exists.
        opening_template = prompt_data.get("opening", "")
        if not opening_template:
            logger.error(
                "Strategy prompt missing 'opening' key for strategy_type=%r",
                strategy_type,
                extra={"event": "mcq_rescue_strategy_prompt_error", "strategy_type": strategy_type},
            )
            raise RuntimeError(
                f"Strategy prompt for '{strategy_type}' is missing required 'opening' key"
            )

        state = RescueSessionState(
            session_id=session_id,
            user_id=user_id,
            question_id=question_id,
            lesson_id=lesson_id,
            wrong_choice=wrong_choice,
            question_text=question_text,
            correct_answer=correct_answer,
            strategy_type=strategy_type,
        )

        # Build opening message from template
        opening = opening_template.replace("{wrong_answer}", wrong_choice)
        # Remove image_hint placeholder if present (text-only phase)
        opening = opening.replace("{image_hint}", "圖示")

        state.conversation.append({"role": "ai", "text": opening})
        _store.save(state)

        return session_id, RescueResponse(
            current_step=1,
            should_advance=False,
            should_terminate=False,
            give_up_detected=False,
            ai_feedback=opening,
            next_question="",
            reasoning="Session started. Opening message rendered from strategy template.",
        )

    async def process_response(
        self,
        session_id: str,
        student_text: str,
    ) -> RescueResponse:
        """Process a student's response in an active rescue session.

        Implements circuit breaker (3 consecutive AI errors → RuntimeError → 503).
        Error fallback: should_advance=False, should_terminate=False.
        """
        # Rate limit check
        if _store.check_rate_limit(session_id):
            raise ValueError("Rate limit exceeded. Please wait before sending another response.")

        # Input validation
        if not student_text or not student_text.strip():
            raise ValueError("Response cannot be empty")
        if len(student_text) > self.MAX_ANSWER_LENGTH:
            raise ValueError(f"Response too long (max {self.MAX_ANSWER_LENGTH} characters)")
        student_text = student_text.strip()

        state = _store.get(session_id)
        if state is None:
            raise ValueError(f"Rescue session {session_id} not found or expired")
        if state.is_terminated:
            raise ValueError("Rescue session is already terminated")

        # Sanitize input
        student_text, _ = sanitize_ai_input(student_text, user_id=str(state.user_id))

        state.conversation.append({"role": "student", "text": student_text})

        # Truncate history
        if len(state.conversation) > self.MAX_HISTORY_TURNS:
            state.conversation = (
                [state.conversation[0]]
                + state.conversation[-(self.MAX_HISTORY_TURNS - 1):]
            )

        prompt_data = load_strategy_prompt(state.strategy_type)
        system_prompt = self._build_system_prompt(state, prompt_data)

        # Build Gemini contents
        contents: list[genai_types.Content] = [
            genai_types.Content(
                role="user",
                parts=[genai_types.Part(text="請開始引導學生。")],
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
                    parts=[genai_types.Part(text="請根據我的回答繼續引導。")],
                )
            )

        try:
            result = await generate_structured_response(
                system_prompt=system_prompt,
                contents=contents,
                response_schema=RESCUE_RESPONSE_SCHEMA,
            )
            ai_feedback = result.get("ai_feedback", "")
            next_question = result.get("next_question", "")
            should_advance = bool(result.get("should_advance", False))
            should_terminate = bool(result.get("should_terminate", False))
            give_up_detected = bool(result.get("give_up_detected", False))
            returned_step = result.get("current_step", state.current_step)

            # Bug 2 fix: reasoning is required for audit trail.
            # An empty/missing reasoning means the schema contract was violated —
            # raise so this surfaces in Sentry rather than silently losing audit data.
            reasoning = result.get("reasoning", "").strip()
            if not reasoning:
                raise ValueError(
                    "Gemini response is missing required 'reasoning' field — "
                    "audit trail cannot be maintained"
                )

            # Validate returned step
            if not isinstance(returned_step, int) or not (1 <= returned_step <= 5):
                logger.warning(
                    "Invalid current_step %r from AI, using state step %d",
                    returned_step,
                    state.current_step,
                )
                returned_step = state.current_step

            state.consecutive_errors = 0  # Reset on success

        except _AI_ERRORS as e:
            # Bug 1 fix: only catch known AI-layer errors here.
            # KeyError / TypeError / AttributeError / JSONDecodeError and other
            # unexpected exceptions are NOT caught — they bubble up to the route's
            # generic `except Exception → 500` handler so Sentry sees them
            # immediately instead of on the 3rd consecutive failure.
            state.consecutive_errors += 1
            logger.error(
                "AI service error in mcq_rescue process_response (attempt %d/%d): %s",
                state.consecutive_errors,
                self.MAX_CONSECUTIVE_ERRORS,
                e,
                exc_info=True,
                extra={
                    "event": "mcq_rescue_ai_error",
                    "consecutive_errors": state.consecutive_errors,
                    "session_id": session_id,
                    "error": str(e),
                },
            )

            if state.consecutive_errors >= self.MAX_CONSECUTIVE_ERRORS:
                logger.error(
                    "Circuit breaker triggered: %d consecutive AI errors for rescue session %s",
                    state.consecutive_errors,
                    session_id,
                    extra={
                        "event": "mcq_rescue_circuit_breaker",
                        "session_id": session_id,
                    },
                )
                _store.save(state)
                raise RuntimeError("AI 服務暫時無法使用，請稍後再試。") from e

            # Fail-closed: should_advance=False, never auto-pass on error
            ai_feedback = "讓我再想一下，你能再說一次嗎？"
            next_question = _fallback_prompt(state.current_step)
            should_advance = False
            should_terminate = False
            give_up_detected = False
            returned_step = state.current_step
            reasoning = f"AI error fallback (attempt {state.consecutive_errors})"

        # Update give_up_count
        if give_up_detected:
            state.give_up_count += 1
        else:
            state.give_up_count = 0  # Reset on real answer

        # Auto-skip to step 5 if too many give-ups
        if state.give_up_count >= self.GIVE_UP_THRESHOLD:
            returned_step = 5
            should_advance = False
            should_terminate = False  # Let step 5 run first, then terminate
            reasoning += " [Give-up threshold reached — advancing to step 5 direct teach]"

        # Advance step if criteria met
        if should_advance and returned_step == state.current_step and state.current_step < 5:
            state.current_step += 1
            returned_step = state.current_step

        # If step 5 is active and should_advance, terminate
        if state.current_step == 5 and should_advance:
            should_terminate = True

        # Clamp step
        state.current_step = max(1, min(5, returned_step))

        # Persist AI response
        full_ai_text = ai_feedback
        if next_question:
            full_ai_text = f"{ai_feedback}\n{next_question}".strip()
        state.conversation.append({"role": "ai", "text": full_ai_text})

        if should_terminate:
            state.is_terminated = True

        _store.save(state)

        return RescueResponse(
            current_step=state.current_step,
            should_advance=should_advance,
            should_terminate=should_terminate,
            give_up_detected=give_up_detected,
            ai_feedback=ai_feedback,
            next_question=next_question,
            reasoning=reasoning,
        )


def _fallback_prompt(step: int) -> str:
    fallbacks = {
        1: "你能說說看，這題在問什麼嗎？",
        2: "課文裡哪一段和這個問題有關？",
        3: "你能用自己的話說說那段在講什麼嗎？",
        4: "那 A/B/C/D 哪個選項符合你剛才說的？",
        5: "我們一起來看一下答案好了。",
    }
    return fallbacks.get(step, fallbacks[1])


# Module-level agent singleton
mcq_rescue_agent = McqRescueAgent()
