"""TDD for team_arena.engine._compute_highlights — PRD §0 v2 改版 Q.

Pure, white-box tests against synthetic events logs (the exact shape
`submit_answer` appends to `session.scoreboard["events"]`) — no DB, no
HTTP, so every highlight's priority rule can be locked precisely without
having to drive a real match through dozens of turns.
"""
from __future__ import annotations

from types import SimpleNamespace

from app.services.team_arena import engine as svc


def _session_with_events(events: list[dict]) -> SimpleNamespace:
    return SimpleNamespace(scoreboard={"events": events})


def _member(student_id: int) -> SimpleNamespace:
    return SimpleNamespace(student_id=student_id)


class TestComputeHighlightsPriority:
    def test_base_destroyed_wins_over_everything(self):
        events = [
            {"turn_no": 0, "student_id": 1, "correct": True, "event": "tower_fallen", "elapsed_ms": 100, "weapon": None},
            {"turn_no": 1, "student_id": 1, "correct": True, "event": "base_destroyed", "elapsed_ms": 50, "weapon": None},
        ]
        session = _session_with_events(events)
        highlights = svc._compute_highlights(session, [_member(1)])
        assert highlights[1] == svc._HIGHLIGHT_BASE_DESTROYED

    def test_tower_fallen_beats_fastest_and_streak(self):
        events = [
            {"turn_no": 0, "student_id": 1, "correct": True, "event": "tower_fallen", "elapsed_ms": 5000, "weapon": None},
            {"turn_no": 1, "student_id": 2, "correct": True, "event": "damage", "elapsed_ms": 10, "weapon": None},
        ]
        session = _session_with_events(events)
        highlights = svc._compute_highlights(session, [_member(1), _member(2)])
        assert highlights[1] == svc._HIGHLIGHT_TOWER_FALLEN
        assert highlights[2] == svc._HIGHLIGHT_FASTEST  # fastest among the REMAINING events

    def test_call_teammate_assisted_correct_answer(self):
        """The "fastest of the match" rule runs before the call_teammate
        rule and uses setdefault, so with only ONE event in the whole
        match this student deterministically collects _HIGHLIGHT_FASTEST
        first (code-reviewer finding: the prior looser either/or
        assertion didn't actually lock this down)."""
        events = [
            {"turn_no": 0, "student_id": 3, "correct": True, "event": "damage", "elapsed_ms": 5000, "weapon": "call_teammate"},
        ]
        session = _session_with_events(events)
        highlights = svc._compute_highlights(session, [_member(3)])
        assert highlights[3] == svc._HIGHLIGHT_FASTEST

    def test_call_teammate_assigned_when_student_has_no_other_signal(self):
        events = [
            {"turn_no": 0, "student_id": 1, "correct": True, "event": "tower_fallen", "elapsed_ms": 1, "weapon": None},
            {"turn_no": 1, "student_id": 2, "correct": True, "event": "damage", "elapsed_ms": 9000, "weapon": "call_teammate"},
        ]
        session = _session_with_events(events)
        highlights = svc._compute_highlights(session, [_member(1), _member(2)])
        assert highlights[1] == svc._HIGHLIGHT_TOWER_FALLEN
        assert highlights[2] == svc._HIGHLIGHT_CALL_TEAMMATE

    def test_streak_of_two_or_more_correct_answers(self):
        """Student 1 streaks twice but is NOT the fastest (student 2 takes
        that spot with a quicker answer) -- isolates the streak rule from
        the fastest-of-the-match rule it would otherwise also qualify for."""
        events = [
            {"turn_no": 0, "student_id": 1, "correct": True, "event": "damage", "elapsed_ms": 9000, "weapon": None},
            {"turn_no": 1, "student_id": 2, "correct": True, "event": "damage", "elapsed_ms": 1, "weapon": None},
            {"turn_no": 2, "student_id": 1, "correct": True, "event": "damage", "elapsed_ms": 9000, "weapon": None},
        ]
        session = _session_with_events(events)
        highlights = svc._compute_highlights(session, [_member(1), _member(2)])
        assert highlights[1] == svc._HIGHLIGHT_STREAK
        assert highlights[2] == svc._HIGHLIGHT_FASTEST

    def test_single_correct_answer_is_not_a_streak(self):
        events = [
            {"turn_no": 0, "student_id": 1, "correct": True, "event": "damage", "elapsed_ms": 1, "weapon": None},
        ]
        session = _session_with_events(events)
        highlights = svc._compute_highlights(session, [_member(1)])
        # Only event in the match -> also the fastest -> gets _HIGHLIGHT_FASTEST,
        # never a fabricated streak claim.
        assert highlights[1] == svc._HIGHLIGHT_FASTEST

    def test_no_events_at_all_is_neutral_never_negative(self):
        session = _session_with_events([])
        highlights = svc._compute_highlights(session, [_member(1), _member(2)])
        assert highlights[1] == svc._HIGHLIGHT_NEUTRAL
        assert highlights[2] == svc._HIGHLIGHT_NEUTRAL
        assert "沒有" not in highlights[1] and "失敗" not in highlights[1]

    def test_wrong_answers_never_generate_a_highlight_by_themselves(self):
        events = [
            {"turn_no": 0, "student_id": 1, "correct": False, "event": None, "elapsed_ms": 10, "weapon": None},
        ]
        session = _session_with_events(events)
        highlights = svc._compute_highlights(session, [_member(1)])
        assert highlights[1] == svc._HIGHLIGHT_NEUTRAL

    def test_every_member_gets_exactly_one_highlight(self):
        events = [
            {"turn_no": 0, "student_id": 1, "correct": True, "event": "tower_fallen", "elapsed_ms": 1, "weapon": None},
        ]
        session = _session_with_events(events)
        members = [_member(1), _member(2), _member(3)]
        highlights = svc._compute_highlights(session, members)
        assert set(highlights.keys()) == {1, 2, 3}
        assert all(isinstance(v, str) and v for v in highlights.values())
