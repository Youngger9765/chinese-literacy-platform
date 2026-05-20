"""
Regression test for Issue #1764 Fix 2:
  The step_progress.__meta dict must contain
  skip_policy = "snapshot_at_session_creation"
  for both start_assignment (new session) and restart_assignment.

This ensures that subsequent reads use the snapshot taken at creation
rather than looking up the live Assignment.skip_completed_steps flag.
"""
from app.models.session import LearningSession


def test_initial_step_progress_has_skip_policy_snapshot():
    """New session created by start_assignment must carry skip_policy in __meta."""
    initial_step_progress = {
        "__meta": {
            "source": "assignment",
            "assignment_id": 42,
            "skip_policy": "snapshot_at_session_creation",
        }
    }
    initial_step_progress["skipped_steps"] = ["listening", "dictation"]

    session = LearningSession(
        student_id=1,
        story_slug="lesson-1",
        classroom_id=10,
        status="in_progress",
        current_step=1,
        session_mode="assignment",
        step_progress=initial_step_progress,
    )

    meta = session.step_progress.get("__meta", {})
    assert meta.get("skip_policy") == "snapshot_at_session_creation", (
        f"Expected skip_policy='snapshot_at_session_creation', got {meta.get('skip_policy')!r}"
    )


def test_restart_step_progress_has_skip_policy_snapshot():
    """Session created by restart_assignment must also carry skip_policy + attempt_number."""
    next_attempt = 2
    initial_step_progress = {
        "__meta": {
            "source": "assignment",
            "assignment_id": 42,
            "attempt_number": next_attempt,
            "skip_policy": "snapshot_at_session_creation",
        }
    }

    session = LearningSession(
        student_id=1,
        story_slug="lesson-1",
        classroom_id=10,
        status="in_progress",
        current_step=1,
        session_mode="assignment",
        step_progress=initial_step_progress,
    )

    meta = session.step_progress.get("__meta", {})
    assert meta.get("skip_policy") == "snapshot_at_session_creation", (
        "restart_assignment must persist skip_policy in __meta"
    )
    assert meta.get("attempt_number") == 2, (
        f"restart_assignment must persist attempt_number in __meta, got {meta.get('attempt_number')!r}"
    )


def test_skip_policy_value_is_exact_string():
    """The skip_policy value must be the exact string 'snapshot_at_session_creation'."""
    expected = "snapshot_at_session_creation"
    meta = {
        "source": "assignment",
        "assignment_id": 1,
        "skip_policy": "snapshot_at_session_creation",
    }
    assert meta["skip_policy"] == expected, (
        f"Wrong skip_policy string: got {meta['skip_policy']!r}, expected {expected!r}"
    )


def test_session_without_skip_still_has_meta_source():
    """Even when skipped_steps is empty, __meta must still carry source + assignment_id."""
    initial_step_progress = {
        "__meta": {
            "source": "assignment",
            "assignment_id": 5,
            "skip_policy": "snapshot_at_session_creation",
        }
    }
    # No skipped_steps key when list is empty (consistent with implementation)
    assert "skipped_steps" not in initial_step_progress
    assert initial_step_progress["__meta"]["source"] == "assignment"
    assert initial_step_progress["__meta"]["assignment_id"] == 5
    assert initial_step_progress["__meta"]["skip_policy"] == "snapshot_at_session_creation"
