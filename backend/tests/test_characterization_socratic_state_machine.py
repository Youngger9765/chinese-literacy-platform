"""
Characterization tests for backend/app/services/socratic/state_machine.py (refactor #1835).

Locks in:
  - determine_phase() transition logic (factual/inferential/evaluative)
  - rebuild_state_from_turns() correct reconstruction of SessionState from DB rows

These are pure-logic functions with no DB or LLM calls — ideal unit tests.

Run: cd backend && python -m pytest tests/test_characterization_socratic_state_machine.py -v
"""

import pytest
from unittest.mock import MagicMock


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _make_turn(role: str, text: str, is_correct: bool = False, phase: str | None = None):
    turn = MagicMock()
    turn.role = role
    turn.text = text
    turn.is_correct = is_correct
    turn.phase = phase
    return turn


# ---------------------------------------------------------------------------
# Tests for determine_phase
# ---------------------------------------------------------------------------

class TestDeterminePhase:
    """determine_phase(understood_count, total_attempts) → phase string."""

    def test_zero_understood_is_factual(self):
        from app.services.socratic.state_machine import determine_phase
        assert determine_phase(0, 0) == "factual"

    def test_one_understood_is_factual(self):
        from app.services.socratic.state_machine import determine_phase
        assert determine_phase(1, 2) == "factual"

    def test_two_understood_is_inferential(self):
        from app.services.socratic.state_machine import determine_phase
        assert determine_phase(2, 3) == "inferential"

    def test_three_understood_is_inferential(self):
        from app.services.socratic.state_machine import determine_phase
        assert determine_phase(3, 4) == "inferential"

    def test_four_understood_is_evaluative(self):
        from app.services.socratic.state_machine import determine_phase
        assert determine_phase(4, 5) == "evaluative"

    def test_five_understood_is_evaluative(self):
        from app.services.socratic.state_machine import determine_phase
        assert determine_phase(5, 5) == "evaluative"

    def test_boundary_at_two_exactly(self):
        """Boundary: count==2 must switch from factual to inferential."""
        from app.services.socratic.state_machine import determine_phase
        assert determine_phase(1, 2) == "factual"
        assert determine_phase(2, 3) == "inferential"

    def test_boundary_at_four_exactly(self):
        """Boundary: count==4 must switch from inferential to evaluative."""
        from app.services.socratic.state_machine import determine_phase
        assert determine_phase(3, 4) == "inferential"
        assert determine_phase(4, 5) == "evaluative"

    def test_phase_values_are_valid_strings(self):
        """All returned phases must be from the known set."""
        from app.services.socratic.state_machine import determine_phase, PHASE_ORDER
        for count in range(7):
            phase = determine_phase(count, count + 1)
            assert phase in PHASE_ORDER, f"determine_phase({count}, ...) = {phase!r} not in PHASE_ORDER"

    def test_tautology_break_if_boundary_wrong(self):
        """This test MUST fail if the threshold at count==2 is changed.

        To verify non-tautology: temporarily change `if understood_count <= 1:` to
        `if understood_count <= 2:` in state_machine.py → this test should FAIL.
        Restore after verifying.
        """
        from app.services.socratic.state_machine import determine_phase
        # count=2 is INFERENTIAL, not factual
        assert determine_phase(2, 10) != "factual"


# ---------------------------------------------------------------------------
# Tests for rebuild_state_from_turns
# ---------------------------------------------------------------------------

class TestRebuildStateFromTurns:
    """rebuild_state_from_turns() must reconstruct SessionState correctly from turn rows."""

    def test_empty_turns_returns_default_state(self):
        from app.services.socratic.state_machine import rebuild_state_from_turns

        state = rebuild_state_from_turns(
            turns=[],
            story_title="Test Story",
            story_text="Some text",
            session_id="sess-001",
        )
        assert state.understood_count == 0
        assert state.total_attempts == 0
        assert state.current_phase == "factual"
        assert state.conversation == []

    def test_student_turns_increment_total_attempts(self):
        from app.services.socratic.state_machine import rebuild_state_from_turns

        turns = [
            _make_turn("student", "my answer 1"),
            _make_turn("student", "my answer 2"),
        ]
        state = rebuild_state_from_turns(
            turns=turns,
            story_title="T",
            story_text="txt",
        )
        assert state.total_attempts == 2

    def test_correct_feedback_increments_understood_count(self):
        from app.services.socratic.state_machine import rebuild_state_from_turns

        turns = [
            _make_turn("student", "answer"),
            _make_turn("feedback", "Good!", is_correct=True),
            _make_turn("student", "answer2"),
            _make_turn("feedback", "Correct!", is_correct=True),
        ]
        state = rebuild_state_from_turns(
            turns=turns,
            story_title="T",
            story_text="txt",
        )
        assert state.understood_count == 2

    def test_wrong_feedback_does_not_increment_understood(self):
        from app.services.socratic.state_machine import rebuild_state_from_turns

        turns = [
            _make_turn("student", "wrong answer"),
            _make_turn("feedback", "Try again", is_correct=False),
        ]
        state = rebuild_state_from_turns(
            turns=turns,
            story_title="T",
            story_text="txt",
        )
        assert state.understood_count == 0

    def test_conversation_reconstructed_in_order(self):
        from app.services.socratic.state_machine import rebuild_state_from_turns

        turns = [
            _make_turn("tutor", "First question?"),
            _make_turn("student", "My answer"),
            _make_turn("feedback", "Good!"),
        ]
        state = rebuild_state_from_turns(
            turns=turns,
            story_title="T",
            story_text="txt",
        )
        assert len(state.conversation) == 3
        assert state.conversation[0] == {"role": "tutor", "text": "First question?"}
        assert state.conversation[1] == {"role": "student", "text": "My answer"}

    def test_phase_driven_by_understood_count(self):
        """After 2 correct answers, phase must be inferential."""
        from app.services.socratic.state_machine import rebuild_state_from_turns

        turns = [
            _make_turn("student", "a1"),
            _make_turn("feedback", "ok", is_correct=True),
            _make_turn("student", "a2"),
            _make_turn("feedback", "ok", is_correct=True),
        ]
        state = rebuild_state_from_turns(
            turns=turns,
            story_title="T",
            story_text="txt",
        )
        assert state.understood_count == 2
        assert state.current_phase == "inferential"

    def test_latest_turn_phase_overrides_computed_phase(self):
        """If the latest turn has a phase set, it should override the computed phase."""
        from app.services.socratic.state_machine import rebuild_state_from_turns

        # understood_count=0 would give factual, but last turn says evaluative
        turns = [
            _make_turn("tutor", "Q?", phase="evaluative"),
        ]
        state = rebuild_state_from_turns(
            turns=turns,
            story_title="T",
            story_text="txt",
        )
        assert state.current_phase == "evaluative"

    def test_session_id_propagated(self):
        from app.services.socratic.state_machine import rebuild_state_from_turns

        state = rebuild_state_from_turns(
            turns=[],
            story_title="T",
            story_text="txt",
            session_id="my-session-id-123",
        )
        assert state.session_id == "my-session-id-123"

    def test_tautology_break_correct_feedback_counts(self):
        """MUST fail if feedback role does not increment understood_count.

        To verify non-tautology: change state_machine.py to stop incrementing
        understood_count on is_correct=True turns → this assertion must FAIL.
        """
        from app.services.socratic.state_machine import rebuild_state_from_turns

        turns = [
            _make_turn("feedback", "Good!", is_correct=True),
            _make_turn("feedback", "Good!", is_correct=True),
            _make_turn("feedback", "Good!", is_correct=True),
        ]
        state = rebuild_state_from_turns(
            turns=turns,
            story_title="T",
            story_text="txt",
        )
        # 3 correct feedback → must be evaluative (count=3 → inferential by determine_phase)
        assert state.understood_count == 3
        assert state.current_phase == "inferential"
