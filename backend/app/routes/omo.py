"""OMO (Online-Merge-Offline) API routes — Phase 1b: dedup + regrade + 3-tier UX.

Endpoints:
    GET    /api/omo/lessons                         — list of OMO-eligible lessons (for manual picker)
    POST   /api/omo/upload                          — upload images, trigger AI identification
                                                       (Phase 1b: SHA-256 dedup → skip Gemini if cached)
    POST   /api/omo/{upload_id}/attempt             — add another image to existing upload
    POST   /api/omo/{upload_id}/confirm             — confirm lesson + kick off grading
    GET    /api/omo/{upload_id}                     — poll status + get result
    POST   /api/omo/{upload_id}/regrade             — re-trigger grading for an already-graded upload
    PATCH  /api/omo/{upload_id}/answers/{q_id}/flag — student flags a question
    GET    /api/omo/{upload_id}/images/{attempt_id}/{n} — signed GCS URL (1-hr TTL)
    DELETE /api/omo/{upload_id}                     — privacy delete

llm-endpoint-hardening checklist:
- Rate-limit: 10/minute on AI-triggering endpoints (upload, attempt, confirm, regrade) ✅
- Auth Depends: get_current_user on all write endpoints ✅
- Input size cap: 10MB per file, max 5 files total ✅
- Output token cap: enforced in omo_identifier (512) + omo_grader (2048) ✅
- Fail-closed: status=error on AI failure, never auto-passes ✅
- Reasoning field: every candidate and every answer has reasoning ✅

AnalysisBy: issue #1770 — split from 1197-line monolith into 4 focused modules:
  - routes/omo.py       (this file) — FastAPI router + thin handler bodies
  - services/omo_storage.py        — GCS upload, signing, bucket constant
  - services/omo_responses.py      — Pydantic schemas + response builders
  - services/omo_jobs.py           — background tasks, _update_upload helper

AnalysisBy: issue #1857 — second-pass split into 3 more focused modules:
  - services/omo_upload_validator.py — file-count/size/MIME guards (sync, no DB/GCS)
  - services/omo_upload_service.py   — dedup/create/supersede DB helpers
  - services/omo_state_service.py    — confirm/regrade/flag/lesson-id mapping
"""

import hashlib
import logging
from typing import Optional

from fastapi import APIRouter, BackgroundTasks, Depends, File, Form, HTTPException, Path, UploadFile
from sqlalchemy.orm import Session

from ..auth.dependencies import get_current_user
from ..auth.rate_limiter import make_ai_rate_limit_dependency
from ..database import get_db
from ..models.omo_upload import OmoUpload, OmoUploadAttempt
from ..models.user import User

# Delegated to focused service modules (issue #1770 split)
from ..services.omo_storage import _OMO_GCS_BUCKET, _get_signed_url, _upload_to_gcs
from ..services.omo_responses import (
    AnswerFlagInfo,
    AnswerItem,
    CropSignedUrlResponse,
    FlagRequest,
    LessonCandidateResponse,
    LessonSummaryResponse,
    OmoAttemptResponse,
    OmoByLessonResponse,
    OmoConfirmRequest,
    OmoConfirmResponse,
    OmoRegradeResponse,
    OmoSignedImageInfo,
    OmoUploadResponse,
    SignedUrlResponse,
    _build_upload_response,
)
from ..services.omo_jobs import _run_grading, _run_identification, _update_upload

# Delegated to focused service modules (issue #1857 split)
from ..services.omo_upload_validator import (
    _MAX_FILES_PER_UPLOAD,
    _MAX_TOTAL_ATTEMPTS,
    validate_attempt_files,
    validate_upload_files,
)
from ..services.omo_upload_service import (
    check_dedup,
    create_attempt_record,
    create_upload_record,
    supersede_existing_uploads,
)
from ..services.omo_state_service import (
    apply_confirm,
    apply_flag,
    apply_regrade,
    resolve_lesson_id,
)

logger = logging.getLogger(__name__)

router = APIRouter(tags=["omo"])


# ── Internal route helpers ─────────────────────────────────────────────────────

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

@router.get(
    "/omo/lessons",
    response_model=list[LessonSummaryResponse],
)
def list_omo_lessons(
    current_user: User = Depends(get_current_user),
):
    """Return all lessons available for the OMO manual picker.

    Called when AI identification returns low confidence and the student
    wants to pick the lesson manually.

    Returns grade_code + title for each lesson, sorted by grade then title.
    """
    from ..services.lesson_loader import get_all_lessons
    lessons = get_all_lessons()
    result = []
    for lesson in lessons:
        lesson_id = lesson.get("id") or lesson.get("lesson_number")
        grade_code = lesson.get("lesson_code") or lesson.get("grade_code", "")
        title = lesson.get("title", "")
        if lesson_id and title:
            result.append(LessonSummaryResponse(
                lesson_id=int(lesson_id),
                grade_code=str(grade_code),
                title=title,
            ))
    # Sort by grade_code then title for a predictable picker order
    result.sort(key=lambda x: (x.grade_code, x.title))
    return result


@router.post(
    "/omo/upload",
    response_model=OmoUploadResponse,
    status_code=201,
    dependencies=[Depends(make_ai_rate_limit_dependency(max_requests=10, window_seconds=60))],
)
async def upload_worksheet(
    background_tasks: BackgroundTasks,
    files: list[UploadFile] = File(
        ...,
        description="Worksheet photos (JPEG/PNG, max 10MB each, max 5 files)",
    ),
    lesson_code_hint: Optional[str] = Form(
        default=None,
        description=(
            "Optional lesson code hint (e.g. 'G5-L25'). "
            "When provided (student uploads from within a lesson page), "
            "skips AI fuzzy-match and resolves directly — faster + cheaper. "
            "Without hint, falls back to full Gemini identification."
        ),
    ),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Upload worksheet photos and kick off lesson identification.

    Returns immediately with status=identifying. Poll GET /api/omo/{id} for result.

    Constraints:
    - Max 5 files per call
    - Max 10MB per file
    - JPEG / PNG / WebP only

    Hint path (#1637): if ``lesson_code_hint`` is supplied, identification
    completes synchronously in the background task without any AI call
    (confidence=1.0, ~0 latency vs 6-24 s for Gemini).
    """
    # ── Read all file bytes (required for async UploadFile) ──────────────────
    files_data: list[tuple[bytes, str]] = []
    for f in files:
        content_type = f.content_type or "image/jpeg"
        data = await f.read()
        files_data.append((data, content_type))

    # ── Validate (raises 400/413 before any GCS work) ────────────────────────
    validate_upload_files(files_data)

    image_bytes_list = [d for d, _ in files_data]
    mime_types = [m for _, m in files_data]

    # ── Phase 1b: SHA-256 dedup check ────────────────────────────────────────
    # Hash the primary (first) image to detect duplicate uploads.
    primary_hash = hashlib.sha256(image_bytes_list[0]).hexdigest()

    existing_upload = check_dedup(db, current_user.id, primary_hash)
    if existing_upload:
        already_graded = existing_upload.status == "graded"
        logger.info(
            "OMO dedup hit: student=%d hash=%s existing_upload_id=%d already_graded=%s",
            current_user.id, primary_hash[:16], existing_upload.id, already_graded,
        )
        response = _build_upload_response(existing_upload)
        response.from_cache = True
        response.already_graded = already_graded
        return response

    # ── Create new upload record (status=identifying) ─────────────────────────
    upload = create_upload_record(db, current_user.id)
    upload_id = upload.id

    # Create first attempt (with hash stored for future dedup)
    image_paths = []
    for i, (data, mime) in enumerate(files_data):
        path = _upload_to_gcs(current_user.id, upload_id, 0, i, data, mime)
        image_paths.append(path)

    create_attempt_record(
        db,
        upload_id=upload_id,
        attempt_idx=0,
        image_paths=image_paths,
        image_hash=primary_hash,
        is_active=True,
    )

    # Upload-replace UX: supersede any existing active upload for this lesson+student
    # (only when we know the lesson upfront via hint — avoids superseding during identification)
    if lesson_code_hint:
        from ..services.omo_identifier import identify_lesson_from_hint
        hint_candidates = identify_lesson_from_hint(lesson_code_hint)
        if hint_candidates:
            hinted_lesson_id = hint_candidates[0].lesson_id
            supersede_existing_uploads(db, current_user.id, hinted_lesson_id, upload_id)

    background_tasks.add_task(
        _run_identification, upload_id, image_bytes_list, mime_types, lesson_code_hint
    )

    logger.info(
        "OMO upload created: id=%d student=%d files=%d hash=%s hint=%s",
        upload_id, current_user.id, len(files), primary_hash[:16],
        lesson_code_hint or "none",
    )

    return OmoUploadResponse(
        upload_id=upload_id,
        status="identifying",
        candidates=[],
        answers=[],
        from_cache=False,
        already_graded=False,
    )


@router.post(
    "/omo/{upload_id}/attempt",
    response_model=OmoAttemptResponse,
    status_code=201,
    dependencies=[Depends(make_ai_rate_limit_dependency(max_requests=10, window_seconds=60))],
)
async def add_attempt(
    upload_id: int,
    background_tasks: BackgroundTasks,
    files: list[UploadFile] = File(
        ...,
        description="Additional worksheet photos for this upload session",
    ),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Add another image capture attempt to an existing OMO upload session.

    Supports multi-page worksheets and retakes. Max 5 attempts total.
    Each new attempt is marked is_active=True; previous attempts set to False.
    Re-triggers AI identification using the new images.
    """
    upload = _get_upload_or_404(upload_id, current_user, db)

    # Count existing attempts
    existing_attempts = db.query(OmoUploadAttempt).filter(
        OmoUploadAttempt.omo_upload_id == upload_id
    ).count()

    # ── Read all file bytes ───────────────────────────────────────────────────
    files_data: list[tuple[bytes, str]] = []
    for f in files:
        content_type = f.content_type or "image/jpeg"
        data = await f.read()
        files_data.append((data, content_type))

    # ── Validate (attempt count + file constraints) ───────────────────────────
    validate_attempt_files(files_data, existing_attempts)

    image_bytes_list = [d for d, _ in files_data]
    mime_types = [m for _, m in files_data]

    attempt_idx = existing_attempts  # 0-based

    # Deactivate all previous attempts
    db.query(OmoUploadAttempt).filter(
        OmoUploadAttempt.omo_upload_id == upload_id
    ).update({"is_active": False})

    # Upload images
    image_paths = []
    for i, (data, mime) in enumerate(files_data):
        path = _upload_to_gcs(current_user.id, upload_id, attempt_idx, i, data, mime)
        image_paths.append(path)

    # Reset upload status for re-identification
    upload.status = "identifying"
    upload.error_message = None
    db.commit()

    new_attempt = create_attempt_record(
        db,
        upload_id=upload_id,
        attempt_idx=attempt_idx,
        image_paths=image_paths,
        is_active=True,
    )

    # Re-trigger identification
    background_tasks.add_task(_run_identification, upload_id, image_bytes_list, mime_types)

    logger.info(
        "OMO attempt added: upload_id=%d attempt_idx=%d student=%d",
        upload_id, attempt_idx, current_user.id,
    )

    return OmoAttemptResponse(
        upload_id=upload_id,
        attempt_id=new_attempt.id,
        attempt_idx=attempt_idx,
        status="identifying",
        message="重新辨識中，請稍候",
    )


@router.post(
    "/omo/{upload_id}/confirm",
    response_model=OmoConfirmResponse,
    dependencies=[Depends(make_ai_rate_limit_dependency(max_requests=10, window_seconds=60))],
)
async def confirm_lesson(
    upload_id: int,
    payload: OmoConfirmRequest,
    background_tasks: BackgroundTasks,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Student confirms the identified lesson, kicks off grading job.

    Returns status=grading immediately. Poll GET /api/omo/{id} until status=graded.
    """
    upload = _get_upload_or_404(upload_id, current_user, db)

    # Phase 1b: guard against re-confirming an already in-progress or graded upload
    if upload.status == "grading":
        raise HTTPException(
            status_code=409,
            detail="批改正在進行中，請稍候",
        )
    if upload.status == "graded":
        raise HTTPException(
            status_code=409,
            detail="此學習單已批改完成，如需重新批改請使用 /regrade",
        )

    if upload.status not in ("identified", "error"):
        raise HTTPException(
            status_code=409,
            detail=f"尚未完成辨識（目前狀態：{upload.status}），請稍後再確認",
        )

    # Log if student overrode AI candidates
    candidate_ids = []
    if upload.identification and isinstance(upload.identification, list):
        candidate_ids = [c["lesson_id"] for c in upload.identification]
    if candidate_ids and payload.confirmed_lesson_id not in candidate_ids:
        logger.info(
            "OMO upload %d: student override — confirmed lesson_id=%d (AI candidates=%s)",
            upload_id, payload.confirmed_lesson_id, candidate_ids,
        )

    # #1740 fix: translate synthetic lesson_id → canonical Story.id via grade_code
    real_lesson_id = resolve_lesson_id(
        payload.confirmed_lesson_id,
        upload.identification if isinstance(upload.identification, list) else None,
    )

    apply_confirm(db, upload, real_lesson_id)

    # Kick off grading in background — pass real Story.id so grader picks correct schema
    background_tasks.add_task(_run_grading, upload_id, real_lesson_id)

    logger.info(
        "OMO upload %d confirmed + grading queued: student=%d lesson_id=%d (was synthetic %d)",
        upload_id, current_user.id, real_lesson_id, payload.confirmed_lesson_id,
    )

    return OmoConfirmResponse(
        upload_id=upload_id,
        lesson_id=real_lesson_id,
        status="grading",
        message="確認成功！AI 正在批改中，請稍候（約 15-20 秒）",
    )


@router.get("/omo/{upload_id}", response_model=OmoUploadResponse)
def get_upload_status(
    upload_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Poll for identification + grading result.

    Frontend should poll every 2 seconds while status is identifying/grading.
    Status values: pending | identifying | identified | grading | graded | error
    """
    upload = _get_upload_or_404(upload_id, current_user, db)
    return _build_upload_response(upload)


@router.post(
    "/omo/{upload_id}/regrade",
    response_model=OmoRegradeResponse,
    dependencies=[Depends(make_ai_rate_limit_dependency(max_requests=10, window_seconds=60))],
)
async def regrade_upload(
    upload_id: int,
    background_tasks: BackgroundTasks,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Re-trigger grading for an already-graded upload.

    Student-initiated intentional re-grade (e.g. after flagging answers).
    Resets status to grading and kicks off a new grading job using the
    existing lesson_id and active attempt images.

    Returns 409 if the upload is still grading.
    """
    upload = _get_upload_or_404(upload_id, current_user, db)

    if upload.status == "grading":
        raise HTTPException(
            status_code=409,
            detail="批改正在進行中，請稍候",
        )
    if upload.status not in ("graded", "error", "identified"):
        raise HTTPException(
            status_code=409,
            detail=f"無法重新批改（目前狀態：{upload.status}）",
        )
    if not upload.lesson_id:
        raise HTTPException(
            status_code=409,
            detail="尚未確認課程，請先確認課程後再批改",
        )

    apply_regrade(db, upload)

    background_tasks.add_task(_run_grading, upload_id, upload.lesson_id)

    logger.info(
        "OMO regrade queued: upload_id=%d student=%d lesson_id=%d",
        upload_id, current_user.id, upload.lesson_id,
    )

    return OmoRegradeResponse(
        upload_id=upload_id,
        status="grading",
        message="重新批改中，請稍候（約 15-20 秒）",
    )


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


@router.get('/omo/{upload_id}/crops/{question_id}', response_model=CropSignedUrlResponse)
def get_crop_signed_url(
    upload_id: int,
    question_id: str = Path(..., description='question_id from answers (e.g. fb_1, mc_2)'),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    '''Get a 1-hour signed GCS URL for a question crop image.

    Returns url=null if crop not available (legacy upload or crop upload failed).
    '''
    upload = _get_upload_or_404(upload_id, current_user, db)

    # Find crop_image_url in answers JSONB
    gs_uri = None
    for a in (upload.answers or []):
        if a.get('question_id') == question_id:
            gs_uri = a.get('crop_image_url')
            break

    if not gs_uri:
        return CropSignedUrlResponse(url=None)

    # gs://bucket/path -> extract object path
    # Format: gs://lingoleap-omo-uploads/crops/{upload_id}/{question_id}.jpg
    try:
        object_path = gs_uri.split('/', 3)[-1]  # strip gs://bucket/
    except Exception:
        return CropSignedUrlResponse(url=None)

    signed_url = _get_signed_url(object_path)
    return CropSignedUrlResponse(url=signed_url)


@router.get('/omo/by-lesson/{lesson_id}', response_model=OmoByLessonResponse)
def get_upload_by_lesson(
    lesson_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    '''Check if the current student has a non-superseded upload for this lesson.

    Used by the Intro page upload-replace UX to detect prior uploads.
    Returns has_prior_upload=False if no upload exists or all are superseded.
    '''
    upload = (
        db.query(OmoUpload)
        .filter(
            OmoUpload.student_id == current_user.id,
            OmoUpload.lesson_id == lesson_id,
            OmoUpload.superseded_at.is_(None),
            OmoUpload.status.in_(['identified', 'grading', 'graded']),
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
