"""OMO lifecycle sub-module — flag, signed-url, delete, crops, by-lesson endpoints.

Endpoints:
    PATCH  /omo/{upload_id}/answers/{question_id}/flag — student flags a question
    GET    /omo/{upload_id}/images/{attempt_id}/{n}    — signed GCS URL (1-hr TTL)
    DELETE /omo/{upload_id}                            — privacy delete
    GET    /omo/{upload_id}/crops/{question_id}        — signed crop image URL
    GET    /omo/by-lesson/{lesson_id}                  — check prior upload for lesson

Note: /omo/by-lesson/{lesson_id} is a static-prefix path registered first in __init__.py
to prevent shadowing by /omo/{upload_id} parameterized routes.
"""

import logging

from fastapi import APIRouter, Depends, HTTPException, Path
from sqlalchemy.orm import Session

from ...auth.dependencies import get_current_user
from ...database import get_db
from ...models.omo_upload import OmoUpload, OmoUploadAttempt
from ...models.user import User
from ...services.omo_responses import (
    CropSignedUrlResponse,
    FlagRequest,
    OmoByLessonResponse,
    OmoSignedImageInfo,
    SignedUrlResponse,
)
from ...services.omo_state_service import apply_flag
from ...services.omo_storage import _OMO_GCS_BUCKET, _get_signed_url

logger = logging.getLogger(__name__)

router = APIRouter()


# ── Internal route helper ──────────────────────────────────────────────────────

def _get_upload_or_404(upload_id: int, user: User, db: Session) -> OmoUpload:
    """Fetch OmoUpload by id + student_id, raise 404 if missing."""
    upload = db.query(OmoUpload).filter(
        OmoUpload.id == upload_id,
        OmoUpload.student_id == user.id,
    ).first()
    if not upload:
        raise HTTPException(status_code=404, detail="找不到此上傳記錄")
    return upload


# ── Routes ────────────────────────────────────────────────────────────────────

@router.patch("/omo/{upload_id}/answers/{question_id}/flag", status_code=200)
def flag_answer(
    upload_id: int,
    question_id: str = Path(..., description="question_id from answers array"),
    payload: FlagRequest = FlagRequest(),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Student flags a question as incorrectly graded by AI.

    Sets flag = {flagged_by, reason, flagged_at} on the answer item.
    Logged server-side for prompt improvement. Does not change the score.
    """
    upload = _get_upload_or_404(upload_id, current_user, db)

    if upload.status != "graded":
        raise HTTPException(
            status_code=409,
            detail="批改尚未完成，無法標記問題",
        )

    apply_flag(db, upload, question_id, current_user.id, payload.reason)

    return {"upload_id": upload_id, "question_id": question_id, "flagged": True}


@router.get(
    "/omo/{upload_id}/images/{attempt_id}/{n}",
    response_model=SignedUrlResponse,
)
def get_image_signed_url(
    upload_id: int,
    attempt_id: int,
    n: int = Path(..., ge=0, le=9, description="Image index within the attempt (0-based)"),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Get a 1-hour signed GCS URL for a specific attempt image.

    Returns url=null if GCS auth is unavailable (local dev / CI).
    """
    # Verify ownership
    upload = _get_upload_or_404(upload_id, current_user, db)

    attempt = db.query(OmoUploadAttempt).filter(
        OmoUploadAttempt.id == attempt_id,
        OmoUploadAttempt.omo_upload_id == upload_id,
    ).first()
    if not attempt:
        raise HTTPException(status_code=404, detail="找不到此拍攝記錄")

    paths = attempt.image_paths or []
    if n >= len(paths):
        raise HTTPException(status_code=404, detail=f"此次拍攝只有 {len(paths)} 張照片")

    object_path = paths[n]
    signed_url = _get_signed_url(object_path)

    return SignedUrlResponse(url=signed_url, expires_in_seconds=3600)


@router.delete("/omo/{upload_id}", status_code=204)
def delete_upload(
    upload_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Student privacy delete — removes DB record and best-effort GCS cleanup.

    All attempts and their images are deleted. GCS deletion failures are
    logged but do not prevent the DB record from being removed.
    """
    upload = _get_upload_or_404(upload_id, current_user, db)

    # Best-effort GCS cleanup for all attempts
    all_attempts = db.query(OmoUploadAttempt).filter(
        OmoUploadAttempt.omo_upload_id == upload_id
    ).all()

    for attempt in all_attempts:
        for path in (attempt.image_paths or []):
            try:
                from google.cloud import storage  # type: ignore[import]
                client = storage.Client()
                client.bucket(_OMO_GCS_BUCKET).blob(path).delete()
            except Exception as exc:
                logger.warning("OMO GCS delete failed for %s: %s", path, exc)

    db.delete(upload)
    db.commit()
    logger.info("OMO upload %d deleted by student %d", upload_id, current_user.id)


@router.get("/omo/{upload_id}/crops/{question_id}", response_model=CropSignedUrlResponse)
def get_crop_signed_url(
    upload_id: int,
    question_id: str = Path(..., description="question_id from answers (e.g. fb_1, mc_2)"),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Get a 1-hour signed GCS URL for a question crop image.

    Returns url=null if crop not available (legacy upload or crop upload failed).
    """
    upload = _get_upload_or_404(upload_id, current_user, db)

    # Find crop_image_url in answers JSONB
    gs_uri = None
    for a in (upload.answers or []):
        if a.get("question_id") == question_id:
            gs_uri = a.get("crop_image_url")
            break

    if not gs_uri:
        return CropSignedUrlResponse(url=None)

    # gs://bucket/path -> extract object path
    # Format: gs://lingoleap-omo-uploads/crops/{upload_id}/{question_id}.jpg
    try:
        object_path = gs_uri.split("/", 3)[-1]  # strip gs://bucket/
    except Exception:
        return CropSignedUrlResponse(url=None)

    signed_url = _get_signed_url(object_path)
    return CropSignedUrlResponse(url=signed_url)


@router.get("/omo/by-lesson/{lesson_id}", response_model=OmoByLessonResponse)
def get_upload_by_lesson(
    lesson_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Check if the current student has a non-superseded upload for this lesson.

    Used by the Intro page upload-replace UX to detect prior uploads.
    Returns has_prior_upload=False if no upload exists or all are superseded.
    """
    upload = (
        db.query(OmoUpload)
        .filter(
            OmoUpload.student_id == current_user.id,
            OmoUpload.lesson_id == lesson_id,
            OmoUpload.superseded_at.is_(None),
            OmoUpload.status.in_(["identified", "grading", "graded"]),
        )
        .order_by(OmoUpload.created_at.desc())
        .first()
    )

    if not upload:
        return OmoByLessonResponse(has_prior_upload=False)

    images: list[OmoSignedImageInfo] = []
    active_attempts = [
        attempt
        for attempt in (upload.attempts or [])
        if attempt.is_active and attempt.image_paths
    ]
    attempts = active_attempts or [
        attempt for attempt in (upload.attempts or []) if attempt.image_paths
    ]
    for attempt in attempts:
        for idx, object_path in enumerate(attempt.image_paths or []):
            images.append(OmoSignedImageInfo(
                attempt_id=attempt.id,
                index=idx,
                url=_get_signed_url(object_path),
            ))

    return OmoByLessonResponse(
        upload_id=upload.id,
        status=upload.status,
        has_prior_upload=True,
        images=images,
    )
