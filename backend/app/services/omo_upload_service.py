"""OMO upload DB service — dedup, record creation, supersede logic.

Extracted from backend/app/routes/omo.py as part of the 3-module split.
AnalysisBy: issue #1857 — routes/omo.py second-pass refactor.

Contains:
- check_dedup(): SHA-256 duplicate detection scoped per student
- create_upload_record(): insert OmoUpload row with status=identifying
- create_attempt_record(): insert OmoUploadAttempt row
- supersede_existing_uploads(): mark prior uploads for same lesson as superseded
"""

from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Optional

from sqlalchemy.orm import Session

from ..models.omo_upload import OmoUpload, OmoUploadAttempt

logger = logging.getLogger(__name__)


def check_dedup(db: Session, student_id: int, primary_hash: str) -> Optional[OmoUpload]:
    """Return the existing OmoUpload if a duplicate image hash exists for this student.

    Dedup is student-scoped: same hash uploaded by a different student does NOT
    trigger a cache hit.

    Parameters
    ----------
    db:
        Active SQLAlchemy session.
    student_id:
        ID of the uploading student (current_user.id).
    primary_hash:
        SHA-256 hex digest of the first (primary) uploaded file.

    Returns
    -------
    OmoUpload | None
        The matching upload if found, else None.
    """
    existing_attempt = (
        db.query(OmoUploadAttempt)
        .join(OmoUpload, OmoUploadAttempt.omo_upload_id == OmoUpload.id)
        .filter(
            OmoUploadAttempt.image_hash == primary_hash,
            OmoUpload.student_id == student_id,
        )
        .first()
    )
    if not existing_attempt:
        return None

    return db.query(OmoUpload).filter(
        OmoUpload.id == existing_attempt.omo_upload_id
    ).first()


def create_upload_record(db: Session, student_id: int) -> OmoUpload:
    """Insert a new OmoUpload row with status=identifying.

    Flushes to obtain the auto-generated id before returning.  The caller
    is responsible for committing after subsequent operations (e.g. creating
    the first attempt record).

    Parameters
    ----------
    db:
        Active SQLAlchemy session.
    student_id:
        ID of the uploading student.

    Returns
    -------
    OmoUpload
        The newly created (flushed) upload instance with id populated.
    """
    upload = OmoUpload(
        student_id=student_id,
        status="identifying",
        answers=[],
        progress={},
    )
    db.add(upload)
    db.flush()   # get id before commit
    return upload


def create_attempt_record(
    db: Session,
    upload_id: int,
    attempt_idx: int,
    image_paths: list[str],
    image_hash: Optional[str] = None,
    is_active: bool = True,
) -> OmoUploadAttempt:
    """Insert a new OmoUploadAttempt and return it after commit + refresh.

    Parameters
    ----------
    db:
        Active SQLAlchemy session.
    upload_id:
        FK to OmoUpload.id.
    attempt_idx:
        0-based attempt index within the upload session.
    image_paths:
        List of GCS object paths (one per uploaded file).
    image_hash:
        SHA-256 digest of the primary image (optional; stored for dedup).
    is_active:
        Whether this attempt is the currently active one.

    Returns
    -------
    OmoUploadAttempt
        The persisted attempt instance (post-refresh).
    """
    attempt = OmoUploadAttempt(
        omo_upload_id=upload_id,
        attempt_idx=attempt_idx,
        image_paths=image_paths,
        image_hash=image_hash,
        is_active=is_active,
    )
    db.add(attempt)
    db.commit()
    db.refresh(attempt)
    return attempt


def supersede_existing_uploads(
    db: Session,
    student_id: int,
    lesson_id: int,
    current_upload_id: int,
) -> None:
    """Mark prior non-superseded uploads for this student+lesson as superseded.

    Used by the upload-replace UX (hint path) so the frontend's by-lesson
    query only surfaces the latest upload.

    Parameters
    ----------
    db:
        Active SQLAlchemy session.
    student_id:
        ID of the student whose prior uploads should be superseded.
    lesson_id:
        Canonical Story.id of the lesson.
    current_upload_id:
        The just-created upload that should NOT be superseded.
    """
    now_ts = datetime.now(timezone.utc)
    db.query(OmoUpload).filter(
        OmoUpload.student_id == student_id,
        OmoUpload.lesson_id == lesson_id,
        OmoUpload.superseded_at.is_(None),
        OmoUpload.id != current_upload_id,
    ).update({"superseded_at": now_ts})
    db.commit()
