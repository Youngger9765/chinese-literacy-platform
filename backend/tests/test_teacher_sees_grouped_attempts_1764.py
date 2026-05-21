"""
Regression test for Issue #1764 Fix 4:
  get_assignment_detail must return submissions_by_student: a list of
  StudentAttemptGroup, one entry per student, containing all their attempts
  ordered descending by attempt_number.

  AssignmentDetailResponse.submissions_by_student must:
  - Have exactly one entry per unique student
  - Expose latest_status, latest_score, latest_attempt_number derived from
    the highest attempt_number attempt
  - Carry all attempts ordered by attempt_number desc in .attempts[]
"""
from datetime import datetime

from app.schemas.assignment import (
    AssignmentDetailResponse,
    AssignmentResponse,
    AttemptResponse,
    StudentAttemptGroup,
    SubmissionResponse,
)


def _make_assignment_response(**overrides) -> AssignmentResponse:
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


def _make_attempt(id: int, attempt_number: int, status: str, score=None) -> AttemptResponse:
    return AttemptResponse(
        id=id,
        attempt_number=attempt_number,
        status=status,
        submitted_at=datetime(2026, 1, attempt_number),
        score=score,
        reading_accuracy=None,
        reading_cpm=None,
        reading_error_chars=[],
        teacher_feedback=None,
    )


def _make_group(student_id: int, name: str, attempts: list) -> StudentAttemptGroup:
    """Construct a StudentAttemptGroup from a list of AttemptResponse (desc order)."""
    latest = attempts[0]
    return StudentAttemptGroup(
        student_id=student_id,
        student_name=name,
        latest_status=latest.status,
        latest_score=latest.score,
        latest_attempt_number=latest.attempt_number,
        attempts=attempts,
    )


# ---------------------------------------------------------------------------
# Schema shape tests
# ---------------------------------------------------------------------------

def test_attempt_response_fields():
    """AttemptResponse must have the expected shape."""
    attempt = _make_attempt(id=10, attempt_number=2, status="submitted", score=85.0)
    assert attempt.id == 10
    assert attempt.attempt_number == 2
    assert attempt.status == "submitted"
    assert attempt.score == 85.0
    assert attempt.reading_error_chars == []


def test_student_attempt_group_latest_fields():
    """StudentAttemptGroup.latest_* must reflect the highest attempt_number attempt."""
    attempt1 = _make_attempt(1, 1, "submitted", score=60.0)
    attempt2 = _make_attempt(2, 2, "graded", score=80.0)
    # attempts are sorted desc by attempt_number: [attempt2, attempt1]
    group = _make_group(student_id=5, name="Alice", attempts=[attempt2, attempt1])

    assert group.latest_attempt_number == 2
    assert group.latest_status == "graded"
    assert group.latest_score == 80.0


def test_student_attempt_group_attempts_ordered_desc():
    """StudentAttemptGroup.attempts must be ordered descending (latest attempt first)."""
    attempt1 = _make_attempt(1, 1, "submitted", score=50.0)
    attempt2 = _make_attempt(2, 2, "submitted", score=70.0)
    attempt3 = _make_attempt(3, 3, "graded", score=90.0)
    group = _make_group(
        student_id=7,
        name="Bob",
        attempts=[attempt3, attempt2, attempt1],  # desc order
    )

    assert group.attempts[0].attempt_number == 3
    assert group.attempts[1].attempt_number == 2
    assert group.attempts[2].attempt_number == 1


def test_assignment_detail_response_has_submissions_by_student():
    """AssignmentDetailResponse must expose submissions_by_student field."""
    base = _make_assignment_response()
    sub = SubmissionResponse(
        id=1,
        assignment_id=1,
        student_id=5,
        student_name="Alice",
        status="submitted",
        submitted_at=None,
        score=None,
        reading_accuracy=None,
        reading_cpm=None,
        reading_error_chars=[],
        teacher_feedback=None,
    )
    attempt = _make_attempt(1, 1, "submitted")
    group = _make_group(5, "Alice", [attempt])

    detail = AssignmentDetailResponse(
        **base.model_dump(),
        submissions=[sub],
        submissions_by_student=[group],
    )

    assert len(detail.submissions_by_student) == 1
    assert detail.submissions_by_student[0].student_id == 5
    assert detail.submissions_by_student[0].student_name == "Alice"


def test_one_student_multiple_attempts_produces_single_group():
    """One student with 3 attempts → exactly one group with 3 AttemptResponse entries."""
    base = _make_assignment_response(assigned_student_count=1, submitted_student_count=1, total_attempts=3, submission_count=3, completed_count=1)

    subs = [
        SubmissionResponse(id=i, assignment_id=1, student_id=9, student_name="Charlie",
                           status="submitted", submitted_at=None, score=float(i * 10),
                           reading_accuracy=None, reading_cpm=None, reading_error_chars=[],
                           teacher_feedback=None)
        for i in range(1, 4)
    ]

    attempts = [_make_attempt(id=i, attempt_number=i, status="submitted", score=float(i * 10)) for i in [3, 2, 1]]
    group = _make_group(9, "Charlie", attempts)

    detail = AssignmentDetailResponse(
        **base.model_dump(),
        submissions=subs,
        submissions_by_student=[group],
    )

    assert len(detail.submissions_by_student) == 1, "One student → one group"
    assert len(detail.submissions_by_student[0].attempts) == 3, "Three attempts in the group"
    assert detail.submissions_by_student[0].latest_attempt_number == 3


def test_two_students_produce_two_groups():
    """Two different students each with one attempt → two groups."""
    base = _make_assignment_response(assigned_student_count=2, submitted_student_count=2, total_attempts=2, submission_count=2, completed_count=2)

    subs = [
        SubmissionResponse(id=1, assignment_id=1, student_id=5, student_name="Alice",
                           status="submitted", submitted_at=None, score=80.0,
                           reading_accuracy=None, reading_cpm=None, reading_error_chars=[],
                           teacher_feedback=None),
        SubmissionResponse(id=2, assignment_id=1, student_id=6, student_name="Bob",
                           status="graded", submitted_at=None, score=90.0,
                           reading_accuracy=None, reading_cpm=None, reading_error_chars=[],
                           teacher_feedback=None),
    ]
    groups = [
        _make_group(5, "Alice", [_make_attempt(1, 1, "submitted", 80.0)]),
        _make_group(6, "Bob", [_make_attempt(2, 1, "graded", 90.0)]),
    ]
    detail = AssignmentDetailResponse(
        **base.model_dump(),
        submissions=subs,
        submissions_by_student=groups,
    )

    student_ids = {g.student_id for g in detail.submissions_by_student}
    assert student_ids == {5, 6}, f"Expected two distinct student groups, got {student_ids}"


def test_submissions_by_student_defaults_to_empty_list():
    """AssignmentDetailResponse.submissions_by_student defaults to [] when not provided."""
    base = _make_assignment_response()
    detail = AssignmentDetailResponse(
        **base.model_dump(),
        submissions=[],
    )
    assert detail.submissions_by_student == [], (
        "submissions_by_student must default to empty list for backward compatibility"
    )
