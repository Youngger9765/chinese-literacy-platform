"""Teacher-side audio replay endpoints (Issue #2266 PR2).

Allows teachers to listen to their students' reading recordings.

Security model (IDOR parity with student endpoint in learning_audio_replay.py):
- Every endpoint first resolves the Assignment → verifies teacher ownership via
  _require_assignment_owner_or_admin (reuses the existing classroom-ownership
  helper, same pattern as delete / grade / update endpoints).
- Submission is then verified to belong to that assignment.
- ReadingAttemptHistory is verified to belong to that submission's session.
- Signed URL (10-min v4) is generated ONLY after all ownership checks pass.
- 404 is returned for non-existent resources; 403 for ownership violations.

⚠️ This file does NOT implement any scheduler or cron.
    Orphan reconciliation lives in: scripts/reconcile_reading_audio_orphans.py
"""

from __future__ import annotations

import logging

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from ...database import get_db
from ...models.assignment import Assignment, AssignmentSubmission
from ...models.session import LearningSession, ReadingAttemptHistory
from ...models.user import User
from ...routes.auth import get_current_user
from ...routes.assignments import _require_assignment_owner_or_admin
from ...services.audio_upload_service import generate_audio_signed_url

logger = logging.getLogger(__name__)

router = APIRouter(tags=["teacher-audio-replay"])


# ── Teacher: get signed URL for a student's assignment submission audio ────────


@router.get(
    "/teacher/assignments/{assignment_id}/submissions/{submission_id}/reading-audio",
    summary="Teacher: signed URL for a student's submitted recording",
)
def get_submission_audio_signed_url(
    assignment_id: int,
    submission_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Return a 10-minute signed URL so the teacher can replay a student's recording.

    Ownership checks (in order):
    1. Assignment must exist → 404 otherwise.
    2. Caller must be the classroom owner or admin → 403 otherwise.
       (delegates to _require_assignment_owner_or_admin — same guard used by
       DELETE /assignments/{id} and PATCH /assignments/{id}.)
    3. Submission must belong to this assignment → 404 otherwise.
    4. Submission must have an audio_gcs_path recorded → 404 otherwise.

    Returns:
        { "signed_url": "...", "expires_in": 600 }
    """
    # ── 1. Resolve assignment + ownership ─────────────────────────────────────
    assignment = db.query(Assignment).filter(Assignment.id == assignment_id).first()
    if assignment is None:
        raise HTTPException(status_code=404, detail="Assignment not found")

    # Raises 403 if caller is not the classroom owner/co-teacher or admin.
    _require_assignment_owner_or_admin(assignment, current_user, db)

    # ── 2. Resolve submission → assert belongs to this assignment ─────────────
    submission = (
        db.query(AssignmentSubmission)
        .filter(
            AssignmentSubmission.id == submission_id,
            AssignmentSubmission.assignment_id == assignment_id,  # IDOR guard
        )
        .first()
    )
    if submission is None:
        raise HTTPException(status_code=404, detail="Submission not found")

    # ── 3. Check audio path on submission ─────────────────────────────────────
    if submission.audio_gcs_path:
        audio_path = submission.audio_gcs_path
    else:
        raise HTTPException(
            status_code=404, detail="No recording available for this submission"
        )

    # ── 4. Generate signed URL ────────────────────────────────────────────────
    signed_url = generate_audio_signed_url(audio_path, expiration_seconds=600)
    if signed_url is None:
        logger.warning(
            "teacher_audio_replay: GCS signed URL generation failed for "
            "submission %d (assignment %d, teacher %d)",
            submission_id,
            assignment_id,
            current_user.id,
        )
        raise HTTPException(
            status_code=503, detail="Audio service temporarily unavailable"
        )

    logger.info(
        "teacher_audio_replay: signed URL issued for submission %d "
        "(assignment %d, teacher %d)",
        submission_id,
        assignment_id,
        current_user.id,
    )
    return {"signed_url": signed_url, "expires_in": 600}


# ── Teacher: list all attempts for a submission (with audio availability) ────


@router.get(
    "/teacher/assignments/{assignment_id}/submissions/{submission_id}/reading-attempts",
    summary="Teacher: list reading attempts for a submission",
)
def list_submission_attempts(
    assignment_id: int,
    submission_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """List all reading attempt rows linked to a submission's session.

    Returns attempt metadata and whether audio is available for each.
    Useful for the teacher's ▶ 聽錄音 UI table.

    Ownership checks: same as get_submission_audio_signed_url.
    """
    # ── 1. Assignment + teacher ownership ────────────────────────────────────
    assignment = db.query(Assignment).filter(Assignment.id == assignment_id).first()
    if assignment is None:
        raise HTTPException(status_code=404, detail="Assignment not found")

    _require_assignment_owner_or_admin(assignment, current_user, db)

    # ── 2. Submission → assert belongs to this assignment ───────────────────
    submission = (
        db.query(AssignmentSubmission)
        .filter(
            AssignmentSubmission.id == submission_id,
            AssignmentSubmission.assignment_id == assignment_id,
        )
        .first()
    )
    if submission is None:
        raise HTTPException(status_code=404, detail="Submission not found")

    # ── 3. Fetch attempt rows via linked session ─────────────────────────────
    if submission.session_id is None:
        return {"attempts": []}

    attempts = (
        db.query(ReadingAttemptHistory)
        .filter(ReadingAttemptHistory.session_id == submission.session_id)
        .order_by(ReadingAttemptHistory.attempt_no)
        .all()
    )

    return {
        "attempts": [
            {
                "attempt_id": a.id,
                "attempt_no": a.attempt_no,
                "created_at": a.created_at.isoformat(),
                "has_audio": a.audio_gcs_path is not None,
            }
            for a in attempts
        ]
    }


# ── Teacher: get signed URL for a specific attempt ───────────────────────────


@router.get(
    "/teacher/assignments/{assignment_id}/submissions/{submission_id}/reading-attempts/{attempt_id}/audio",
    summary="Teacher: signed URL for a specific attempt's recording",
)
def get_attempt_audio_signed_url(
    assignment_id: int,
    submission_id: int,
    attempt_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Return a 10-minute signed URL for a specific reading attempt recording.

    Ownership checks (layered, same IDOR depth as student endpoint):
    1. Assignment exists + teacher owns it → else 404/403.
    2. Submission belongs to this assignment → else 404.
    3. Attempt belongs to submission's linked session → else 404 (IDOR: cannot
       fetch attempt from another submission's session via this endpoint).
    4. Attempt has audio_gcs_path → else 404.
    """
    # ── 1. Assignment + teacher ownership ────────────────────────────────────
    assignment = db.query(Assignment).filter(Assignment.id == assignment_id).first()
    if assignment is None:
        raise HTTPException(status_code=404, detail="Assignment not found")

    _require_assignment_owner_or_admin(assignment, current_user, db)

    # ── 2. Submission → assert belongs to this assignment ───────────────────
    submission = (
        db.query(AssignmentSubmission)
        .filter(
            AssignmentSubmission.id == submission_id,
            AssignmentSubmission.assignment_id == assignment_id,
        )
        .first()
    )
    if submission is None:
        raise HTTPException(status_code=404, detail="Submission not found")

    # ── 3. Attempt → assert belongs to submission's session (IDOR guard) ─────
    if submission.session_id is None:
        raise HTTPException(
            status_code=404, detail="No recording available for this attempt"
        )

    attempt = (
        db.query(ReadingAttemptHistory)
        .filter(
            ReadingAttemptHistory.id == attempt_id,
            ReadingAttemptHistory.session_id == submission.session_id,  # IDOR guard
        )
        .first()
    )
    if attempt is None:
        raise HTTPException(status_code=404, detail="Attempt not found")

    if attempt.audio_gcs_path is None:
        raise HTTPException(
            status_code=404, detail="No recording available for this attempt"
        )

    # ── 4. Generate signed URL ────────────────────────────────────────────────
    signed_url = generate_audio_signed_url(attempt.audio_gcs_path, expiration_seconds=600)
    if signed_url is None:
        logger.warning(
            "teacher_audio_replay: GCS signed URL generation failed for "
            "attempt %d (submission %d, assignment %d, teacher %d)",
            attempt_id,
            submission_id,
            assignment_id,
            current_user.id,
        )
        raise HTTPException(
            status_code=503, detail="Audio service temporarily unavailable"
        )

    logger.info(
        "teacher_audio_replay: signed URL issued for attempt %d "
        "(submission %d, assignment %d, teacher %d)",
        attempt_id,
        submission_id,
        assignment_id,
        current_user.id,
    )
    return {"signed_url": signed_url, "expires_in": 600}
