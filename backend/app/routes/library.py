"""
Library status API — returns per-text student status labels (Issue #1249).

GET /api/library/status
  Returns a dict mapping story_slug (lesson_number string) to one of:
    "assigned"    — active assignment exists, submission not yet completed
    "in_progress" — has a LearningSession with status=in_progress (no active assignment)
    "completed"   — has a LearningSession with status=completed (no active assignment)
  Keys are absent when no session or assignment exists for that text.

Priority (when multiple conditions are true for same story):
  1. assigned      (has deadline pressure)
  2. in_progress   (actively working)
  3. completed     (finished)

Bounded queries — exactly 3 DB round-trips regardless of library size:
  Q1: SELECT story_slug, status FROM learning_sessions WHERE student_id=X
  Q2: SELECT assignment.story_id, submission.status
        FROM assignment_submissions
        JOIN assignments ON ...
        WHERE submission.student_id=X AND assignment.is_active=True
"""

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from ..database import get_db
from ..models.user import User
from ..models.session import LearningSession
from ..models.assignment import Assignment, AssignmentSubmission
from ..auth.dependencies import get_current_user

router = APIRouter(tags=["library"])

# Submission statuses that mean "assignment work is not yet done"
_INCOMPLETE_SUBMISSION_STATUSES = {"pending", "in_progress"}


@router.get("/library/status", response_model=dict[str, str])
def get_library_status(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict[str, str]:
    """Return per-text status label map for the authenticated student.

    Bounded queries: 2 DB queries total regardless of library size.
    Keys are story_slug strings (= lesson_number, e.g. "6", "10").
    """
    student_id = current_user.id

    # Q1: latest session per story_slug (most recent session wins)
    # We fetch all sessions and deduplicate in Python — avoids a subquery
    # on SQLite which lacks DISTINCT ON.  On Postgres this would be a
    # DISTINCT ON (story_slug) ORDER BY started_at DESC — same 1 query.
    sessions = (
        db.query(LearningSession.story_slug, LearningSession.status)
        .filter(
            LearningSession.student_id == student_id,
            LearningSession.story_slug.isnot(None),
        )
        .order_by(LearningSession.id.desc())   # newest first
        .all()
    )

    # Deduplicate: keep first occurrence (= latest session) per slug
    session_status: dict[str, str] = {}
    for slug, status in sessions:
        if slug and slug not in session_status:
            session_status[slug] = status

    # Q2: active assignments with incomplete submissions for this student
    # Join AssignmentSubmission ↔ Assignment in a single query
    rows = (
        db.query(Assignment.story_id, AssignmentSubmission.status)
        .join(AssignmentSubmission, AssignmentSubmission.assignment_id == Assignment.id)
        .filter(
            AssignmentSubmission.student_id == student_id,
            Assignment.is_active.is_(True),
            Assignment.story_id.isnot(None),     # platform-text assignments only
        )
        .all()
    )

    # Build set of story slugs with incomplete submissions
    assigned_slugs: set[str] = set()
    for story_id, sub_status in rows:
        if story_id and sub_status in _INCOMPLETE_SUBMISSION_STATUSES:
            assigned_slugs.add(story_id)

    # Merge with priority: assigned > in_progress > completed
    result: dict[str, str] = {}

    # Start with session data
    for slug, status in session_status.items():
        if status in ("in_progress", "completed"):
            result[slug] = status

    # Overlay assigned (highest priority) — overwrites any session status
    for slug in assigned_slugs:
        result[slug] = "assigned"

    return result
