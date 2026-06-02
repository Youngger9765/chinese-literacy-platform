"""Executable spec — mcq_rescue_agent state machine + store + schema contracts.

spec_id: mcq.rescue.scaffold_and_fail_closed
canonical_source: backend/app/services/mcq_rescue_agent.py
owns_code:
  backend/app/services/mcq_rescue_agent.py
  backend/app/services/rescue_session_store.py
  backend/app/services/rescue_state_machine.py
related_issues: [1887]
human_spec: specs/modules/mcq-rescue/INTENT.md

Machine-verifiable contracts — all pure Python, no AI, no DB:

  A. apply_state_transitions — state machine invariants
  B. RescueSessionStore — make_key, TTL, rate-limit constants
  C. RESCUE_RESPONSE_SCHEMA — required fields present
  D. McqRescueAgent constants — fail-closed thresholds pinned

Contracts NOT tested here (require Gemini SDK / mock):
  - start_session / process_response AI call behaviour
  - idempotency on re-start
  - circuit breaker triggers RuntimeError on 3rd consecutive AI error

Run: cd backend && python -m pytest specs/test_mcq_rescue_spec.py -v
"""
from __future__ import annotations

from app.services.rescue_session_store import RescueSessionState, RescueSessionStore
from app.services.rescue_state_machine import apply_state_transitions, _fallback_prompt
from app.services.mcq_rescue_agent import (
    RESCUE_RESPONSE_SCHEMA,
    McqRescueAgent,
)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _fresh_state(current_step: int = 1, give_up_count: int = 0) -> RescueSessionState:
    return RescueSessionState(
        session_id="spec_test_session",
        user_id=1,
        question_id="q1",
        lesson_id="L1",
        wrong_choice="B",
        question_text="這段在描述什麼？",
        correct_answer="A",
        strategy_type="main_idea",
        current_step=current_step,
        give_up_count=give_up_count,
    )


# ---------------------------------------------------------------------------
# A. apply_state_transitions — state machine invariants
# ---------------------------------------------------------------------------

def test_step_advances_when_criteria_met():
    """should_advance=True + step < 5 → current_step increments by 1."""
    state = _fresh_state(current_step=2)
    _, _, final_step, _ = apply_state_transitions(
        state=state,
        give_up_detected=False,
        should_advance=True,
        should_terminate=False,
        returned_step=2,
        reasoning="student met advance criteria",
    )
    assert final_step == 3


def test_step_does_not_advance_past_5():
    """At step 5, should_advance does NOT increment step further."""
    state = _fresh_state(current_step=5)
    _, _, final_step, _ = apply_state_transitions(
        state=state,
        give_up_detected=False,
        should_advance=True,
        should_terminate=False,
        returned_step=5,
        reasoning="at step 5",
    )
    assert final_step == 5


def test_step5_plus_advance_sets_terminate():
    """current_step=5 + should_advance=True → should_terminate becomes True."""
    state = _fresh_state(current_step=5)
    _, should_terminate, _, _ = apply_state_transitions(
        state=state,
        give_up_detected=False,
        should_advance=True,
        should_terminate=False,
        returned_step=5,
        reasoning="step 5 advance",
    )
    assert should_terminate is True


def test_step_stays_when_not_advancing():
    """should_advance=False → step unchanged."""
    state = _fresh_state(current_step=3)
    _, _, final_step, _ = apply_state_transitions(
        state=state,
        give_up_detected=False,
        should_advance=False,
        should_terminate=False,
        returned_step=3,
        reasoning="student not ready",
    )
    assert final_step == 3


def test_give_up_increments_count():
    """give_up_detected=True increments state.give_up_count."""
    state = _fresh_state(give_up_count=1)
    apply_state_transitions(
        state=state,
        give_up_detected=True,
        should_advance=False,
        should_terminate=False,
        returned_step=1,
        reasoning="give up",
    )
    assert state.give_up_count == 2


def test_real_answer_resets_give_up_count():
    """give_up_detected=False resets give_up_count to 0."""
    state = _fresh_state(give_up_count=2)
    apply_state_transitions(
        state=state,
        give_up_detected=False,
        should_advance=False,
        should_terminate=False,
        returned_step=1,
        reasoning="real answer",
    )
    assert state.give_up_count == 0


def test_give_up_threshold_skips_to_step_5():
    """give_up_count reaching threshold → returned_step forced to 5."""
    state = _fresh_state(current_step=2, give_up_count=2)
    # One more give_up → count = 3 = threshold
    _, _, final_step, reasoning = apply_state_transitions(
        state=state,
        give_up_detected=True,
        should_advance=False,
        should_terminate=False,
        returned_step=2,
        reasoning="",
        give_up_threshold=3,
    )
    assert final_step == 5
    assert "Give-up threshold" in reasoning


def test_current_step_clamped_to_1_to_5():
    """current_step is always within [1, 5] after transitions."""
    # Test with an out-of-range returned_step (edge case)
    state = _fresh_state(current_step=3)
    _, _, final_step, _ = apply_state_transitions(
        state=state,
        give_up_detected=False,
        should_advance=False,
        should_terminate=False,
        returned_step=0,   # invalid — should be clamped
        reasoning="",
    )
    assert 1 <= final_step <= 5


# ---------------------------------------------------------------------------
# B. RescueSessionStore constants and make_key
# ---------------------------------------------------------------------------

def test_store_make_key_format():
    """make_key(user_id, question_id) → 'mcq_rescue_{uid}_{qid}'."""
    key = RescueSessionStore.make_key(42, "q_001")
    assert key == "mcq_rescue_42_q_001"


def test_store_ttl_is_30_minutes():
    """TTL_SECONDS must be 1800 (30 minutes, matching Socratic agent)."""
    assert RescueSessionStore.TTL_SECONDS == 30 * 60


def test_store_rate_limit_constants():
    """RATE_LIMIT=30 and RATE_WINDOW=60 are spec-pinned."""
    assert RescueSessionStore.RATE_LIMIT == 30
    assert RescueSessionStore.RATE_WINDOW == 60


def test_store_get_returns_none_for_missing_session():
    """Store.get() returns None when session_id is unknown (no crash)."""
    store = RescueSessionStore()
    result = store.get("nonexistent_session")
    assert result is None


def test_store_save_and_get_round_trips():
    """save() followed by get() returns the same state object."""
    store = RescueSessionStore()
    state = _fresh_state()
    store.save(state)
    retrieved = store.get("spec_test_session")
    assert retrieved is state


def test_store_delete_removes_session():
    """delete() removes session; subsequent get() returns None."""
    store = RescueSessionStore()
    state = _fresh_state()
    store.save(state)
    store.delete("spec_test_session")
    assert store.get("spec_test_session") is None


def test_store_rate_limit_not_exceeded_initially():
    """check_rate_limit returns False for a fresh session key (not yet limited)."""
    store = RescueSessionStore()
    exceeded = store.check_rate_limit("brand_new_session_id")
    assert exceeded is False


# ---------------------------------------------------------------------------
# C. RESCUE_RESPONSE_SCHEMA — required fields
# ---------------------------------------------------------------------------

_REQUIRED_FIELDS = [
    "ai_feedback",
    "next_question",
    "should_advance",
    "should_terminate",
    "give_up_detected",
    "current_step",
    "reasoning",
]


def test_rescue_schema_has_all_required_fields():
    """RESCUE_RESPONSE_SCHEMA.required contains all 7 contractual fields."""
    required = RESCUE_RESPONSE_SCHEMA.get("required", [])
    for field in _REQUIRED_FIELDS:
        assert field in required, f"'{field}' missing from RESCUE_RESPONSE_SCHEMA required"


def test_rescue_schema_properties_match_required():
    """Every required field must also appear in 'properties'."""
    props = RESCUE_RESPONSE_SCHEMA.get("properties", {})
    required = RESCUE_RESPONSE_SCHEMA.get("required", [])
    for field in required:
        assert field in props, f"required field '{field}' not in properties"


def test_rescue_schema_should_advance_is_boolean():
    """should_advance property type must be 'boolean' (not string)."""
    prop_type = RESCUE_RESPONSE_SCHEMA["properties"]["should_advance"]["type"]
    assert prop_type == "boolean"


def test_rescue_schema_current_step_is_integer():
    """current_step property type must be 'integer'."""
    prop_type = RESCUE_RESPONSE_SCHEMA["properties"]["current_step"]["type"]
    assert prop_type == "integer"


# ---------------------------------------------------------------------------
# D. McqRescueAgent constants — fail-closed thresholds
# ---------------------------------------------------------------------------

def test_max_consecutive_errors_is_3():
    """MAX_CONSECUTIVE_ERRORS must be 3 (circuit breaker threshold)."""
    assert McqRescueAgent.MAX_CONSECUTIVE_ERRORS == 3


def test_give_up_threshold_is_3():
    """GIVE_UP_THRESHOLD must be 3 (consecutive give-up → step 5)."""
    assert McqRescueAgent.GIVE_UP_THRESHOLD == 3


def test_max_answer_length_is_500():
    """MAX_ANSWER_LENGTH must be 500 characters (input cap)."""
    assert McqRescueAgent.MAX_ANSWER_LENGTH == 500


# ---------------------------------------------------------------------------
# E. _fallback_prompt — step-specific fallback messages
# ---------------------------------------------------------------------------

def test_fallback_prompt_returns_string_for_all_valid_steps():
    """_fallback_prompt returns a non-empty string for steps 1-5."""
    for step in range(1, 6):
        msg = _fallback_prompt(step)
        assert isinstance(msg, str)
        assert len(msg) > 0, f"step {step} fallback is empty"


def test_fallback_prompt_returns_string_for_unknown_step():
    """_fallback_prompt falls back gracefully for unknown step numbers."""
    msg = _fallback_prompt(99)
    assert isinstance(msg, str)
    assert len(msg) > 0
