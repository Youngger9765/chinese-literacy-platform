"""
rescue_state_machine.py — State transition logic for MCQ Rescue sessions.

Extracted from mcq_rescue_agent.py (Issue #1887).
Handles give-up counting, step advancement, and termination decisions.
"""

from __future__ import annotations

from .rescue_session_store import RescueSessionState


def _fallback_prompt(step: int) -> str:
    """Return a step-appropriate fallback prompt for AI error scenarios."""
    fallbacks = {
        1: "你能說說看，這題在問什麼嗎？",
        2: "課文裡哪一段和這個問題有關？",
        3: "你能用自己的話說說那段在講什麼嗎？",
        4: "那 A/B/C/D 哪個選項符合你剛才說的？",
        5: "我們一起來看一下答案好了。",
    }
    return fallbacks.get(step, fallbacks[1])


def apply_state_transitions(
    state: RescueSessionState,
    give_up_detected: bool,
    should_advance: bool,
    should_terminate: bool,
    returned_step: int,
    reasoning: str,
    give_up_threshold: int = 3,
) -> tuple[bool, bool, int, str]:
    """Apply all state machine transitions for a rescue session turn.

    Handles:
      1. give_up_count increment / reset
      2. Auto-skip to step 5 on give_up_threshold reached
      3. Step advancement when criteria met
      4. Termination when step 5 + should_advance

    Args:
        state: Current session state (mutated in place).
        give_up_detected: Whether the AI detected a give-up response.
        should_advance: Whether the AI says the student met advance criteria.
        should_terminate: Whether the AI says to terminate.
        returned_step: The step number returned by the AI.
        reasoning: Audit reasoning string (may be appended to).
        give_up_threshold: Consecutive give-up count that triggers step 5.

    Returns:
        (should_advance, should_terminate, final_step, reasoning) after transitions.
    """
    # 1. Update give_up_count
    if give_up_detected:
        state.give_up_count += 1
    else:
        state.give_up_count = 0  # Reset on real answer

    # 2. Auto-skip to step 5 if give-up threshold reached
    if state.give_up_count >= give_up_threshold:
        returned_step = 5
        should_advance = False
        should_terminate = False  # Let step 5 run first, then terminate
        reasoning = reasoning + " [Give-up threshold reached — advancing to step 5 direct teach]"

    # 3. Advance step if criteria met
    if should_advance and returned_step == state.current_step and state.current_step < 5:
        state.current_step += 1
        returned_step = state.current_step

    # 4. If step 5 is active and should_advance, terminate
    if state.current_step == 5 and should_advance:
        should_terminate = True

    # 5. Clamp step to valid range
    state.current_step = max(1, min(5, returned_step))

    return should_advance, should_terminate, state.current_step, reasoning
