"""OMO state-transition service — confirm, regrade, flag, lesson-id mapping.

Extracted from backend/app/routes/omo.py as part of the 3-module split.
AnalysisBy: issue #1857 — routes/omo.py second-pass refactor.

Contains:
- resolve_lesson_id(): #1740 fix — maps synthetic lesson_id → canonical Story.id
- apply_confirm(): set upload to grading state after student confirmation
- apply_regrade(): reset upload to grading for a student-initiated retry
- apply_flag(): mark a specific answer as flagged by student
"""

from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Optional

from fastapi import HTTPException
from sqlalchemy.orm import Session
from sqlalchemy.orm.attributes import flag_modified

from ..models.omo_upload import OmoUpload

logger = logging.getLogger(__name__)


def resolve_lesson_id(
    confirmed_lesson_id: int,
    identification: Optional[list],
) -> int:
    """Map a synthetic lesson_id (YAML display_order) to a canonical Story.id.

    Issue #1740 fix: the AI identifier returns a synthetic lesson_id derived
    from the YAML catalog's display_order integer, which does NOT match the
    Story.id used by the frontend /api/stories endpoints and by _run_grading
    to look up the question schema.

    Resolution strategy:
    1. Find the candidate in ``identification`` whose lesson_id matches
       ``confirmed_lesson_id``.
    2. Extract its ``grade_code`` (e.g. "G5-L25").
    3. Call ``get_lesson_by_code(grade_code)`` to fetch the DB-loaded lesson.
    4. Return that lesson's ``id`` as the canonical Story.id.

    Falls through unchanged if any step fails (no candidates, no grade_code,
    no matching DB row).

    Parameters
    ----------
    confirmed_lesson_id:
        The synthetic lesson_id the student confirmed.
    identification:
        The JSON array stored in OmoUpload.identification (list of candidate dicts).

    Returns
    -------
    int
        Canonical Story.id if resolved, else ``confirmed_lesson_id`` unchanged.
    """
    if not identification or not isinstance(identification, list):
        return confirmed_lesson_id

    matched = next(
        (c for c in identification if c.get("lesson_id") == confirmed_lesson_id),
        None,
    )
    if not matched:
        return confirmed_lesson_id

    grade_code = matched.get("grade_code")
    if not grade_code:
        return confirmed_lesson_id

    try:
        from .lesson_loader import get_lesson_by_code
        story = get_lesson_by_code(grade_code)
        if story and story.get("id"):
            real_id = story["id"]
            logger.info(
                "OMO #1740 lesson_id mapping: synthetic %d → Story.id %d via grade_code %s",
                confirmed_lesson_id, real_id, grade_code,
            )
            return real_id
    except Exception as exc:  # pragma: no cover
        logger.warning("resolve_lesson_id: grade_code=%r lookup failed: %s", grade_code, exc)

    return confirmed_lesson_id


def apply_confirm(db: Session, upload: OmoUpload, real_lesson_id: int) -> None:
    """Transition upload to grading state after student lesson confirmation.

    Sets:
    - ``upload.lesson_id`` = real_lesson_id (canonical Story.id)
    - ``upload.status``    = "grading"
    - ``upload.progress``  = {"stage": "queued", "total": 0, "graded": 0}

    Commits the session.

    Parameters
    ----------
    db:
        Active SQLAlchemy session.
    upload:
        The OmoUpload being confirmed.
    real_lesson_id:
        Canonical Story.id (after #1740 mapping).
    """
    upload.lesson_id = real_lesson_id
    upload.status = "grading"
    upload.progress = {"stage": "queued", "total": 0, "graded": 0}
    db.commit()


def apply_regrade(db: Session, upload: OmoUpload) -> None:
    """Reset upload to grading state for a student-initiated re-grade.

    Sets:
    - ``upload.status``        = "grading"
    - ``upload.progress``      = {"stage": "queued", "total": 0, "graded": 0}
    - ``upload.error_message`` = None

    Commits the session.

    Parameters
    ----------
    db:
        Active SQLAlchemy session.
    upload:
        The OmoUpload to re-grade.
    """
    upload.status = "grading"
    upload.progress = {"stage": "queued", "total": 0, "graded": 0}
    upload.error_message = None
    db.commit()


def apply_flag(
    db: Session,
    upload: OmoUpload,
    question_id: str,
    flagged_by: int,
    reason: str,
) -> None:
    """Set the flag dict on the answer item matching question_id.

    The flag structure is::

        {
            "flagged_by":  <int: student user id>,
            "reason":      <str>,
            "flagged_at":  <ISO-8601 UTC timestamp>,
        }

    Uses ``flag_modified`` so SQLAlchemy detects the JSON mutation on both
    PostgreSQL JSONB and SQLite JSON columns.

    Raises HTTPException 404 if no answer with the given question_id is found.
    Commits the session on success.

    Parameters
    ----------
    db:
        Active SQLAlchemy session.
    upload:
        The graded OmoUpload whose answers should be flagged.
    question_id:
        Identifier of the answer (e.g. "fb_1", "mc_2").
    flagged_by:
        User.id of the student flagging the answer.
    reason:
        Student-supplied reason for the flag.
    """
    answers = list(upload.answers or [])
    found = False
    for a in answers:
        if a.get("question_id") == question_id:
            a["flag"] = {
                "flagged_by": flagged_by,
                "reason": reason,
                "flagged_at": datetime.now(timezone.utc).isoformat(),
            }
            found = True
            logger.info(
                "OMO answer flagged: upload_id=%d question_id=%s student=%d reason=%s",
                upload.id, question_id, flagged_by, reason,
            )
            break

    if not found:
        raise HTTPException(status_code=404, detail=f"找不到題目 {question_id}")

    # SQLAlchemy needs explicit reassignment + flag_modified to detect JSON mutation
    upload.answers = answers
    flag_modified(upload, "answers")
    db.commit()
