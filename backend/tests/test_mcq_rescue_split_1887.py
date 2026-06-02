"""
TDD unit tests for mcq_rescue_agent.py split (Issue #1887).

Tests target the behaviour that must be preserved after splitting into:
  - rescue_session_store.py
  - rescue_state_machine.py
  - rescue_prompt_builder.py

Three required tests (per issue spec):
  1. start_session_is_idempotent_and_returns_last_ai_message
  2. ai_error_fallback_never_advances_or_terminates
  3. three_give_ups_moves_to_step_five_without_terminating_immediately

Run with:
    cd backend && python -m pytest tests/test_mcq_rescue_split_1887.py -v
"""

from __future__ import annotations

import asyncio
import sys
import os
from unittest.mock import AsyncMock, patch

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import pytest
from google.genai import errors as genai_errors

from app.services.mcq_rescue_agent import (
    McqRescueAgent,
    RescueSessionState,
    RescueSessionStore,
    _store,
)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

FAKE_USER_ID = 77
BASE_KWARGS = dict(
    lesson_id="G6-L23",
    wrong_choice="B",
    question_text="本文主要在說什麼？",
    correct_answer="D",
    strategy_type="summary_psr",
)


def _fresh_agent() -> McqRescueAgent:
    """Return an agent instance. (module singleton is also fine — tests clean up store.)"""
    return McqRescueAgent()


def _make_api_error(msg: str = "Simulated error") -> genai_errors.APIError:
    return genai_errors.APIError(429, {"error": {"message": msg}})


def _good_ai_result(step: int = 1, advance: bool = False) -> dict:
    return {
        "ai_feedback": "好，讓我們繼續。",
        "next_question": "你能說說嗎？",
        "should_advance": advance,
        "should_terminate": False,
        "give_up_detected": False,
        "current_step": step,
        "reasoning": "Student engaged normally.",
    }


def _give_up_ai_result(step: int = 1) -> dict:
    return {
        "ai_feedback": "沒關係，換個方式。",
        "next_question": "試試看嗎？",
        "should_advance": False,
        "should_terminate": False,
        "give_up_detected": True,
        "current_step": step,
        "reasoning": "Student signalled give-up.",
    }


@pytest.fixture(autouse=True)
def _clean_store():
    """Reset module-level session store before every test."""
    _store._sessions.clear()
    _store._rate_counts.clear()
    yield
    _store._sessions.clear()
    _store._rate_counts.clear()


# ---------------------------------------------------------------------------
# Test 1: start_session is idempotent and returns the last AI message
# ---------------------------------------------------------------------------

class TestStartSessionIdempotent:
    """start_session called twice for the same user+question must:
       - NOT overwrite the existing session
       - return the last AI message from conversation history (not blank)
    """

    @pytest.mark.asyncio
    async def test_start_session_is_idempotent_and_returns_last_ai_message(self):
        """Reload never shows a blank bubble — returns last AI turn text."""
        agent = _fresh_agent()
        question_id = "Q-idem-1887"

        # First call — creates a new session
        session_id, first_response = await agent.start_session(
            user_id=FAKE_USER_ID,
            question_id=question_id,
            **BASE_KWARGS,
        )
        assert first_response.ai_feedback, "First response must have non-empty ai_feedback"

        # Manually advance conversation to simulate a real dialogue
        state = _store.get(session_id)
        assert state is not None
        last_ai_text = "你說得不錯！那課文哪一段提到這個？"
        state.conversation.append({"role": "student", "text": "文章講的是主題"})
        state.conversation.append({"role": "ai", "text": last_ai_text})
        state.current_step = 2
        _store.save(state)

        # Second call (idempotent resume)
        session_id2, resume_response = await agent.start_session(
            user_id=FAKE_USER_ID,
            question_id=question_id,
            **BASE_KWARGS,
        )

        assert session_id2 == session_id, "Idempotent: must return same session_id"
        assert resume_response.ai_feedback == last_ai_text, (
            f"Must return last AI message {last_ai_text!r}, got {resume_response.ai_feedback!r}"
        )
        assert resume_response.current_step == 2, "Must preserve current_step from existing state"
        assert resume_response.should_advance is False, "Resume must not set should_advance=True"
        assert resume_response.should_terminate is False, "Resume must not terminate"

        # Session state must be unchanged (not reset)
        final_state = _store.get(session_id)
        assert final_state is not None
        assert final_state.current_step == 2, "Store state must not be reset by idempotent call"


# ---------------------------------------------------------------------------
# Test 2: AI error fallback never advances or terminates (fail-closed)
# ---------------------------------------------------------------------------

class TestAiErrorFallbackFailClosed:
    """On AI error, process_response must return:
       - should_advance = False  (NEVER auto-pass a student)
       - should_terminate = False (keep session alive for retry)

    This is the fail-closed guarantee from the architecture docstring.
    """

    def _seed_state(self, question_id: str) -> str:
        session_id = RescueSessionStore.make_key(FAKE_USER_ID, question_id)
        state = RescueSessionState(
            session_id=session_id,
            user_id=FAKE_USER_ID,
            question_id=question_id,
            lesson_id="G6-L23",
            wrong_choice="B",
            question_text="本文主要在說什麼？",
            correct_answer="D",
            strategy_type="summary_psr",
        )
        state.conversation.append({"role": "ai", "text": "Opening."})
        _store.save(state)
        return session_id

    @pytest.mark.asyncio
    async def test_ai_error_fallback_never_advances_or_terminates(self):
        """Fail-closed: APIError → should_advance=False, should_terminate=False."""
        agent = _fresh_agent()
        session_id = self._seed_state("Q-fail-closed-1887")

        with patch(
            "app.services.mcq_rescue_agent.generate_structured_response",
            new_callable=AsyncMock,
            side_effect=_make_api_error("Quota exceeded"),
        ):
            response = await agent.process_response(
                session_id=session_id,
                student_text="我不確定",
            )

        assert response.should_advance is False, (
            "CRITICAL: should_advance must be False on AI error — "
            "auto-passing students on error is catastrophic"
        )
        assert response.should_terminate is False, (
            "should_terminate must be False on AI error — "
            "session must stay alive for the student to retry"
        )
        assert response.ai_feedback, "Fallback must provide a non-empty ai_feedback"
        assert response.reasoning, "Fallback must provide a non-empty reasoning for audit"

    @pytest.mark.asyncio
    async def test_ai_error_fallback_on_asyncio_timeout(self):
        """asyncio.TimeoutError is also an AI-layer error — same fail-closed behaviour."""
        agent = _fresh_agent()
        session_id = self._seed_state("Q-timeout-1887")

        with patch(
            "app.services.mcq_rescue_agent.generate_structured_response",
            new_callable=AsyncMock,
            side_effect=asyncio.TimeoutError(),
        ):
            response = await agent.process_response(
                session_id=session_id,
                student_text="嗯",
            )

        assert response.should_advance is False
        assert response.should_terminate is False

    @pytest.mark.asyncio
    async def test_ai_error_does_not_reset_step(self):
        """AI error must not change current_step — student stays at same step."""
        agent = _fresh_agent()
        question_id = "Q-step-lock-1887"
        session_id = RescueSessionStore.make_key(FAKE_USER_ID, question_id)
        state = RescueSessionState(
            session_id=session_id,
            user_id=FAKE_USER_ID,
            question_id=question_id,
            lesson_id="G6-L23",
            wrong_choice="B",
            question_text="本文主要在說什麼？",
            correct_answer="D",
            strategy_type="summary_psr",
            current_step=3,   # Already at step 3
        )
        state.conversation.append({"role": "ai", "text": "Step 3 prompt."})
        _store.save(state)

        with patch(
            "app.services.mcq_rescue_agent.generate_structured_response",
            new_callable=AsyncMock,
            side_effect=_make_api_error(),
        ):
            response = await agent.process_response(
                session_id=session_id,
                student_text="不知道",
            )

        assert response.current_step == 3, (
            f"AI error must not change current_step; expected 3, got {response.current_step}"
        )
        assert response.should_advance is False


# ---------------------------------------------------------------------------
# Test 3: Three give-ups moves to step 5 without terminating immediately
# ---------------------------------------------------------------------------

class TestThreeGiveUpsDirectTeach:
    """After 3 consecutive give-up responses, the agent must:
       - Advance current_step to 5 (direct-teach path)
       - NOT terminate immediately (step 5 must run first)

    This matches the give_up_count >= GIVE_UP_THRESHOLD logic in process_response.
    """

    def _seed_state(self, question_id: str, current_step: int = 1) -> str:
        session_id = RescueSessionStore.make_key(FAKE_USER_ID, question_id)
        state = RescueSessionState(
            session_id=session_id,
            user_id=FAKE_USER_ID,
            question_id=question_id,
            lesson_id="G6-L23",
            wrong_choice="B",
            question_text="本文主要在說什麼？",
            correct_answer="D",
            strategy_type="summary_psr",
            current_step=current_step,
        )
        state.conversation.append({"role": "ai", "text": "Opening."})
        _store.save(state)
        return session_id

    @pytest.mark.asyncio
    async def test_three_give_ups_moves_to_step_five_without_terminating_immediately(self):
        """3 consecutive give-ups → current_step jumps to 5, should_terminate stays False."""
        agent = _fresh_agent()
        session_id = self._seed_state("Q-giveup-1887")

        give_up_result = _give_up_ai_result(step=1)

        with patch(
            "app.services.mcq_rescue_agent.generate_structured_response",
            new_callable=AsyncMock,
            return_value=give_up_result,
        ):
            # Give-up 1
            r1 = await agent.process_response(session_id=session_id, student_text="不知道")
            assert r1.give_up_detected is True
            # Should NOT be at step 5 yet (only 1 give-up)
            state_after_1 = _store.get(session_id)
            assert state_after_1.give_up_count == 1

            # Give-up 2
            r2 = await agent.process_response(session_id=session_id, student_text="我不會")
            assert r2.give_up_detected is True
            state_after_2 = _store.get(session_id)
            assert state_after_2.give_up_count == 2

            # Give-up 3 — threshold reached
            r3 = await agent.process_response(session_id=session_id, student_text="隨便")

        assert r3.give_up_detected is True, "Third give-up must still set give_up_detected=True"
        assert r3.current_step == 5, (
            f"After 3 give-ups, current_step must jump to 5 (direct-teach). Got {r3.current_step}"
        )
        assert r3.should_terminate is False, (
            "Must NOT terminate immediately on 3rd give-up — step 5 direct-teach must run first"
        )
        # Verify state was persisted correctly
        final_state = _store.get(session_id)
        assert final_state is not None
        assert final_state.current_step == 5

    @pytest.mark.asyncio
    async def test_give_up_count_resets_on_real_answer(self):
        """give_up_count resets to 0 when a student gives a real (non-give-up) answer."""
        agent = _fresh_agent()
        session_id = self._seed_state("Q-giveup-reset-1887")

        # Two give-ups
        with patch(
            "app.services.mcq_rescue_agent.generate_structured_response",
            new_callable=AsyncMock,
            return_value=_give_up_ai_result(step=1),
        ):
            await agent.process_response(session_id=session_id, student_text="不知道")
            await agent.process_response(session_id=session_id, student_text="我不會")

        state = _store.get(session_id)
        assert state.give_up_count == 2

        # Real answer — count resets
        with patch(
            "app.services.mcq_rescue_agent.generate_structured_response",
            new_callable=AsyncMock,
            return_value=_good_ai_result(step=1),
        ):
            await agent.process_response(session_id=session_id, student_text="文章在講摘要策略")

        state = _store.get(session_id)
        assert state.give_up_count == 0, (
            f"give_up_count must reset to 0 after real answer; got {state.give_up_count}"
        )
        assert state.current_step < 5, "Step must not jump to 5 after real answer"
