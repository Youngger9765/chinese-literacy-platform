"""OMO lifecycle sub-module — flag, signed-url, delete, crops, by-lesson, history endpoints.

Endpoints:
    PATCH  /omo/{upload_id}/answers/{question_id}/flag — student flags a question
    GET    /omo/{upload_id}/images/{attempt_id}/{n}    — signed GCS URL (1-hr TTL)
    DELETE /omo/{upload_id}                            — privacy delete
    GET    /omo/{upload_id}/crops/{question_id}        — signed crop image URL
    GET    /omo/by-lesson/{lesson_id}                  — check prior upload for lesson
    GET    /omo/history                                — paginated list of user's uploads (#1975)

Note: /omo/by-lesson/{lesson_id} and /omo/history are static-prefix paths
registered first in __init__.py to prevent shadowing by /omo/{upload_id}.
"""

import asyncio
import logging
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Path, Query
from sqlalchemy.orm import Session

from ...auth.dependencies import get_current_user
from ...database import get_db
from ...models.omo_upload import OmoUpload, OmoUploadAttempt
from ...models.user import User
from ...services.omo_responses import (
    CropSignedUrlResponse,
    FlagRequest,
    OmoByLessonResponse,
    OmoHistoryItem,
    OmoHistoryResponse,
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


# #1975 — Statuses considered "user-visible history". Pending / identifying
# are still in-flight; error uploads have no useful result. Same filter as
# the by-lesson lookup above, kept in sync intentionally.
_HISTORY_STATUSES = ("identified", "grading", "graded")


def _resolve_lesson_meta(
    upload: OmoUpload,
    lesson_map: dict[int, dict],
) -> tuple[Optional[int], Optional[str], Optional[str]]:
    """Pick (lesson_id, lesson_title, grade_code) for one upload.

    Prefers the user-confirmed ``lesson_id`` when set; otherwise falls back to
    the top AI identification candidate (which is the state for
    ``status == 'identified'`` rows the student hasn't confirmed yet).
    """
    lid = upload.lesson_id
    if lid is not None:
        meta = lesson_map.get(int(lid))
        if meta:
            return int(lid), meta.get("title"), meta.get("grade_code")
        return int(lid), None, None
    # Fallback: top AI candidate
    if upload.identification and isinstance(upload.identification, list) and upload.identification:
        top = upload.identification[0]
        return top.get("lesson_id"), top.get("title"), top.get("grade_code")
    return None, None, None


def _pick_thumbnail_path(upload: OmoUpload) -> Optional[str]:
    """Return the GCS path of the first image of the first active attempt."""
    # Prefer active attempts; fall back to any attempt with images.
    candidates = [
        a for a in (upload.attempts or [])
        if a.is_active and a.image_paths
    ] or [
        a for a in (upload.attempts or []) if a.image_paths
    ]
    if not candidates:
        return None
    first = candidates[0]
    if not first.image_paths:
        return None
    return first.image_paths[0]


@router.get("/omo/history", response_model=OmoHistoryResponse)
async def list_omo_history(
    limit: int = Query(20, ge=1, le=50, description="Max items returned per page"),
    offset: int = Query(0, ge=0, description="0-based offset for pagination"),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """#1975 — List the current user's OMO uploads, newest first.

    Returns a compact view suitable for a history list page: lesson title,
    score, status, created timestamp, and a signed thumbnail URL. Heavy
    fields (per-question ``answers``, ``identification`` list) are NOT
    included — clients should call ``GET /omo/{upload_id}`` for the full
    result page.

    Filtering: only ``identified`` / ``grading`` / ``graded`` rows that
    have not been superseded by a newer upload for the same lesson.

    Signed-URL strategy (#1975 review-1): IAM signing is one HTTP call per
    URL, so N items would otherwise wall-clock as N × ~100ms. We fan the
    signing out to a thread pool via ``asyncio.gather`` so a page of 20 only
    takes the cost of the slowest single signing call.
    """
    # Lazy import to keep the module import-time light (lesson_loader reads YAML).
    from ...services.lesson_loader import get_all_lessons

    base_q = (
        db.query(OmoUpload)
        .filter(
            OmoUpload.student_id == current_user.id,
            OmoUpload.superseded_at.is_(None),
            OmoUpload.status.in_(_HISTORY_STATUSES),
        )
    )
    total = base_q.count()
    rows: list[OmoUpload] = (
        base_q.order_by(OmoUpload.created_at.desc())
        .offset(offset)
        .limit(limit)
        .all()
    )

    # Build lesson_id → meta dict once (avoid N+1 yaml loads).
    lesson_map: dict[int, dict] = {}
    for lesson in get_all_lessons():
        # Explicit `is not None` (not `or`) so a legitimate `id == 0` would
        # not silently fall through to `lesson_number` — defensive even
        # though current YAML IDs start at 1.
        raw_lid = lesson.get("id")
        if raw_lid is None:
            raw_lid = lesson.get("lesson_number")
        if raw_lid is None:
            continue
        lesson_map[int(raw_lid)] = {
            "title": lesson.get("title"),
            "grade_code": lesson.get("lesson_code") or lesson.get("grade_code"),
        }

    # Resolve lesson meta + thumbnail path (sync, in-memory) first.
    resolved: list[tuple[OmoUpload, Optional[int], Optional[str], Optional[str], Optional[str]]] = []
    for upload in rows:
        lid, title, grade_code = _resolve_lesson_meta(upload, lesson_map)
        thumb_path = _pick_thumbnail_path(upload)
        resolved.append((upload, lid, title, grade_code, thumb_path))

    # Sign all thumbnail URLs in parallel via a worker pool. Each signing
    # call is a sync HTTP request (IAM SignBlob); we wrap with
    # asyncio.to_thread so they overlap instead of running serially.
    thumb_paths = [r[4] for r in resolved]
    signed_results: list[Optional[str]] = await asyncio.gather(
        *[
            asyncio.to_thread(_get_signed_url, path) if path else asyncio.sleep(0, result=None)
            for path in thumb_paths
        ]
    )

    items: list[OmoHistoryItem] = []
    for (upload, lid, title, grade_code, _thumb_path), thumb_url in zip(resolved, signed_results):
        items.append(OmoHistoryItem(
            upload_id=upload.id,
            lesson_id=lid,
            lesson_title=title,
            grade_code=grade_code,
            status=upload.status,
            overall_score=upload.overall_score,
            answers_count=len(upload.answers or []),
            created_at=upload.created_at.isoformat(),
            thumbnail_url=thumb_url,
        ))

    return OmoHistoryResponse(
        total=total,
        limit=limit,
        offset=offset,
        items=items,
    )
