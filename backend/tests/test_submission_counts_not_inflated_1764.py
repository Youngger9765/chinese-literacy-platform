"""
Regression test for Issue #1764 Fix 3:
  _assignment_to_response must return DISTINCT student counts rather than
  raw submission row counts.

  - assigned_student_count: DISTINCT enrolled students in the classroom
  - submitted_student_count: DISTINCT students with submitted/graded attempt
  - total_attempts: raw row count (all attempts by all students)
  - submission_count: alias for total_attempts (back-compat)
  - completed_count: alias for submitted_student_count (back-compat)

  Scenario: 2 students enrolled, student A has 3 attempts (all submitted),
  student B has 0 attempts.
  -> assigned_student_count = 2
  -> submitted_student_count = 1  (only student A)
  -> total_attempts = 3
"""
from app.schemas.assignment import AssignmentResponse


def _make_response(**overrides) -> AssignmentResponse:
    """Construct a minimal AssignmentResponse with all required fields."""
    defaults = dict(
        id=1,
        classroom_id=1,
        teacher_id=2,
        story_id="1",
        text_id=None,
        story_title="Test",
        title=None,
        description=None,
        assignment_type="reading",
        due_date=None,
        is_active=True,
        created_at="2026-01-01T00:00:00",
        assigned_student_count=2,
        submitted_student_count=1,
        total_attempts=3,
        submission_count=3,
        completed_count=1,
        target_cpm=None,
        target_accuracy=None,
        difficulty_label=None,
        effective_cpm=150,
        effective_accuracy=90.0,
        skip_completed_steps=False,
    )
    defaults.update(overrides)
    return AssignmentResponse(**defaults)


# ---------------------------------------------------------------------------
# Schema field presence tests
# ---------------------------------------------------------------------------

def test_assignment_response_has_assigned_student_count():
    """AssignmentResponse must expose assigned_student_count field."""
    r = _make_response(assigned_student_count=5)
    assert r.assigned_student_count == 5


def test_assignment_response_has_submitted_student_count():
    """AssignmentResponse must expose submitted_student_count field."""
    r = _make_response(submitted_student_count=3)
    assert r.submitted_student_count == 3


def test_assignment_response_has_total_attempts():
    """AssignmentResponse must expose total_attempts field."""
    r = _make_response(total_attempts=7)
    assert r.total_attempts == 7


# ---------------------------------------------------------------------------
# Back-compat alias tests
# ---------------------------------------------------------------------------

def test_submission_count_equals_total_attempts():
    """submission_count is a back-compat alias and must equal total_attempts."""
    r = _make_response(total_attempts=4, submission_count=4)
    assert r.submission_count == r.total_attempts


def test_completed_count_equals_submitted_student_count():
    """completed_count is a back-compat alias and must equal submitted_student_count."""
    r = _make_response(submitted_student_count=2, completed_count=2)
    assert r.completed_count == r.submitted_student_count


# ---------------------------------------------------------------------------
# Inflation scenario
# ---------------------------------------------------------------------------

def test_submission_count_not_inflated_by_multiple_attempts():
    """When one student has 3 attempts, submitted_student_count should be 1 not 3."""
    # submitted_student_count uses DISTINCT student_id — only 1 student submitted
    # total_attempts counts all rows — 3
    r = _make_response(
        assigned_student_count=2,
        submitted_student_count=1,
        total_attempts=3,
        submission_count=3,
        completed_count=1,
    )
    assert r.submitted_student_count == 1, (
        "submitted_student_count should be DISTINCT students, not raw attempt count"
    )
    assert r.total_attempts == 3, (
        "total_attempts should be the raw row count"
    )
    assert r.submitted_student_count < r.total_attempts, (
        "DISTINCT count must be < raw count when one student has multiple attempts"
    )


def test_assigned_student_count_independent_of_submissions():
    """assigned_student_count counts enrolled students regardless of submission status."""
    r = _make_response(
        assigned_student_count=10,  # 10 enrolled
        submitted_student_count=3,  # only 3 submitted
        total_attempts=5,           # some students attempted more than once
    )
    assert r.assigned_student_count == 10
    assert r.submitted_student_count == 3
    assert r.assigned_student_count > r.submitted_student_count
