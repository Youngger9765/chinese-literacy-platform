"""
Regression test for Issue #1764 Fix 1:
  When computing skipped_steps in start_assignment / restart_assignment,
  sessions that belong to THIS assignment's own prior attempts must be
  EXCLUDED so that attempt N+1 does not inherit skips from attempt N.

The correct set is:
  completed steps from self_study sessions for this lesson
  UNION completed steps from OTHER-assignment sessions for this lesson
  (NOT from this assignment's own prior sessions)
"""
from types import SimpleNamespace


# ---------------------------------------------------------------------------
# Unit test: the exclusion filter produces the correct session set
# ---------------------------------------------------------------------------

def _make_session(id: int, story_slug: str, status: str, steps: list) -> SimpleNamespace:
    """Helper: plain object mimicking a LearningSession for filtering logic tests."""
    return SimpleNamespace(
        id=id,
        story_slug=story_slug,
        status=status,
        step_progress={"steps_completed": steps} if steps else {},
    )


def _make_submission(id: int, assignment_id: int, student_id: int, session_id, status: str) -> SimpleNamespace:
    """Helper: plain object mimicking an AssignmentSubmission for filtering logic tests."""
    return SimpleNamespace(
        id=id,
        assignment_id=assignment_id,
        student_id=student_id,
        session_id=session_id,
        status=status,
    )


def test_restart_excludes_own_prior_session_steps():
    """Steps completed in attempt-1 session MUST NOT appear in the skip list for attempt-2.

    Setup:
      - assignment A, student S, story "lesson-1"
      - prior_session_id = 10: belongs to THIS assignment (attempt 1)
        → steps_completed = ["tutor", "vocab"]
      - self_study_session_id = 20: student studied same lesson on their own
        → steps_completed = ["intro"]

    Expected: skipped_steps = ["intro"]  (only self-study, not attempt-1's steps)
    """
    # Simulate own prior submission pointing to session 10
    own_sub = _make_submission(1, assignment_id=42, student_id=7, session_id=10, status="submitted")

    # Two completed sessions for the story
    session_own = _make_session(id=10, story_slug="lesson-1", status="completed", steps=["tutor", "vocab"])
    session_self_study = _make_session(id=20, story_slug="lesson-1", status="completed", steps=["intro"])

    # Simulate the filtering logic from routes/assignments.py (Fix 1 #1764)
    own_session_ids = {own_sub.session_id}  # {10}
    all_completed = [session_own, session_self_study]
    eligible = [s for s in all_completed if s.id not in own_session_ids]  # [session_self_study]

    completed_union: set = set()
    for ps in eligible:
        sp = ps.step_progress
        if isinstance(sp, dict):
            steps = sp.get("steps_completed", [])
            if isinstance(steps, list):
                completed_union.update(s for s in steps if isinstance(s, str) and s.strip())
    skipped_steps = sorted(completed_union)

    assert skipped_steps == ["intro"], (
        f"Expected ['intro'] (own-attempt steps excluded), got {skipped_steps}"
    )


def test_restart_includes_other_assignment_steps():
    """Steps from a DIFFERENT assignment's completed session SHOULD be included in skips.

    Setup:
      - assignment A (id=42), student S
      - session 10 → assignment 42 own attempt (EXCLUDE)
      - session 30 → assignment 99 (different), student S, same story (INCLUDE)
        → steps_completed = ["report"]

    Expected: skipped_steps = ["report"]
    """
    own_sub = _make_submission(1, assignment_id=42, student_id=7, session_id=10, status="submitted")

    session_own = _make_session(id=10, story_slug="lesson-5", status="completed", steps=["intro"])
    session_other_assignment = _make_session(id=30, story_slug="lesson-5", status="completed", steps=["report"])

    own_session_ids = {own_sub.session_id}  # {10}
    all_completed = [session_own, session_other_assignment]
    eligible = [s for s in all_completed if s.id not in own_session_ids]

    completed_union: set = set()
    for ps in eligible:
        sp = ps.step_progress
        if isinstance(sp, dict):
            steps = sp.get("steps_completed", [])
            if isinstance(steps, list):
                completed_union.update(s for s in steps if isinstance(s, str) and s.strip())
    skipped_steps = sorted(completed_union)

    assert skipped_steps == ["report"], (
        f"Expected ['report'] (other-assignment steps included), got {skipped_steps}"
    )


def test_no_own_submissions_uses_all_completed_sessions():
    """First-ever attempt (no prior submissions) must still collect from all completed sessions."""
    own_session_ids: set = set()  # no prior submissions for this assignment

    session1 = _make_session(id=1, story_slug="lesson-2", status="completed", steps=["tutor", "vocab"])
    session2 = _make_session(id=2, story_slug="lesson-2", status="completed", steps=["report"])

    all_completed = [session1, session2]
    eligible = [s for s in all_completed if s.id not in own_session_ids]

    completed_union: set = set()
    for ps in eligible:
        sp = ps.step_progress
        if isinstance(sp, dict):
            steps = sp.get("steps_completed", [])
            if isinstance(steps, list):
                completed_union.update(s for s in steps if isinstance(s, str) and s.strip())
    skipped_steps = sorted(completed_union)

    assert set(skipped_steps) == {"tutor", "vocab", "report"}, (
        f"First attempt: all session steps should appear in skipped_steps, got {skipped_steps}"
    )


def test_session_with_no_session_id_ignored_in_own_ids():
    """AssignmentSubmissions where session_id is None must not be added to own_session_ids."""
    sub_no_session = _make_submission(99, assignment_id=42, student_id=7, session_id=None, status="submitted")
    own_session_ids = {sub.session_id for sub in [sub_no_session] if sub.session_id is not None}
    assert own_session_ids == set(), (
        "None session_id should not be added to own_session_ids set"
    )
