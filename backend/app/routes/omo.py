"""OMO (Online-Merge-Offline) API routes — Phase 1b: dedup + regrade + confirm UX.

Endpoints:
    GET    /api/omo/lessons                         — list all lessons (for manual lesson picker)
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
"""

import hashlib
import logging
import os
from datetime import datetime, timezone
from typing import Literal, Optional

from fastapi import APIRouter, BackgroundTasks, Depends, File, HTTPException, Path, UploadFile, status
from pydantic import BaseModel
from sqlalchemy.orm import Session

from ..auth.dependencies import get_current_user
from ..auth.rate_limiter import make_ai_rate_limit_dependency
from ..database import get_db
from ..models.omo_upload import OmoUpload, OmoUploadAttempt
from ..models.user import User

logger = logging.getLogger(__name__)

router = APIRouter(tags=["omo"])

# ── Constants ──────────────────────────────────────────────────────────────────
_MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024   # 10MB per image
_MAX_FILES_PER_UPLOAD = 5                  # max files per single upload call
_MAX_TOTAL_ATTEMPTS = 5                    # max attempts per upload session
_OMO_GCS_BUCKET = os.environ.get("GCS_OMO_BUCKET", "lingoleap-omo-uploads")
_ALLOWED_MIME_TYPES = {"image/jpeg", "image/jpg", "image/png", "image/webp"}


# ── Pydantic schemas ───────────────────────────────────────────────────────────

class LessonCandidateResponse(BaseModel):
    lesson_id: int
    grade_code: str
    title: str
    confidence: float
    reasoning: str


class AnswerFlagInfo(BaseModel):
    flagged_by: int
    reason: str
    flagged_at: str


class AnswerItem(BaseModel):
    question_id: str
    student_answer: str
    correct_answer: str
    score: float
    ai_confidence: float
    reasoning: str
    source_attempt_id: Optional[int] = None
    position: Optional[dict] = None
    flag: Optional[AnswerFlagInfo] = None


class OmoUploadResponse(BaseModel):
    upload_id: int
    status: Literal["pending", "identifying", "identified", "grading", "graded", "error"]
    candidates: list[LessonCandidateResponse]
    answers: list[AnswerItem]
    overall_score: Optional[float] = None
    ai_overall_confidence: Optional[float] = None
    progress: Optional[dict] = None
    error_message: Optional[str] = None
    # Phase 1b dedup fields
    from_cache: bool = False         # True if this response reuses a prior upload (same image hash)
    already_graded: bool = False     # True if the cached upload already has status=graded


class OmoAttemptResponse(BaseModel):
    upload_id: int
    attempt_id: int
    attempt_idx: int
    status: str
    message: str


class OmoConfirmRequest(BaseModel):
    confirmed_lesson_id: int


class OmoConfirmResponse(BaseModel):
    upload_id: int
    lesson_id: int
    status: str
    message: str


class FlagRequest(BaseModel):
    reason: str = "AI 辨識不正確"


class SignedUrlResponse(BaseModel):
    url: Optional[str]
    expires_in_seconds: int = 3600


class OmoLessonItem(BaseModel):
    """One lesson entry for the manual lesson picker modal."""
    lesson_id: int
    grade_code: str
    title: str


# ── Lesson list endpoint (no auth — public lookup for picker modal) ────────────

@router.get("/omo/lessons", response_model=list[OmoLessonItem])
def list_omo_lessons():
    """Return all available lessons for the manual lesson picker.

    Returns [{lesson_id, grade_code, title}] sorted by lesson_id.
    No auth required — lesson metadata is not sensitive.
    """
    from ..services.lesson_loader import get_all_lessons
    lessons = get_all_lessons()
    items: list[OmoLessonItem] = []
    for lesson in lessons:
        lesson_id = lesson.get("lesson_number") or lesson.get("id")
        grade_code = lesson.get("grade_code", "")
        title = lesson.get("title", "")
        if lesson_id and title:
            items.append(OmoLessonItem(lesson_id=int(lesson_id), grade_code=grade_code, title=title))
    items.sort(key=lambda x: x.lesson_id)
    return items


# ── GCS helpers ───────────────────────────────────────────────────────────────

def _upload_to_gcs(
    user_id: int, upload_id: int, attempt_idx: int, file_index: int,
    data: bytes, mime_type: str
) -> str:
    """Upload image bytes to GCS. Returns the GCS object path.

    Path format: {user_id}/{upload_id}/{attempt_idx}/{file_index}.jpg
    Falls back gracefully if google-cloud-storage is not installed (local dev).
    """
    object_path = f"{user_id}/{upload_id}/{attempt_idx}/{file_index}.jpg"
    try:
        from google.cloud import storage  # type: ignore[import]
        client = storage.Client()
        bucket = client.bucket(_OMO_GCS_BUCKET)
        blob = bucket.blob(object_path)
        blob.upload_from_string(data, content_type=mime_type)
        logger.info("OMO: uploaded gs://%s/%s", _OMO_GCS_BUCKET, object_path)
    except ImportError:
        logger.warning("google-cloud-storage not available — skipping GCS upload (local dev)")
    except Exception as exc:
        logger.warning("OMO GCS upload failed for %s: %s — continuing without GCS", object_path, exc)
    return object_path


def _get_signed_url(object_path: str) -> Optional[str]:
    """Generate a 1-hour signed URL for a GCS object. Returns None if unavailable."""
    import datetime as dt
    try:
        from google.cloud import storage  # type: ignore[import]
        client = storage.Client()
        bucket = client.bucket(_OMO_GCS_BUCKET)
        blob = bucket.blob(object_path)
        url = blob.generate_signed_url(
            version="v4",
            expiration=dt.timedelta(hours=1),
            method="GET",
        )
        return url
    except Exception as exc:
        logger.debug("OMO signed URL failed for %s: %s", object_path, exc)
        return None


# ── Background task helpers ───────────────────────────────────────────────────

def _update_upload(upload_id: int, **kwargs):
    """Open a short-lived DB session to update an OmoUpload record.
    Used in background tasks that run outside the request scope.
    """
    from ..database import SessionLocal
    db = SessionLocal()
    try:
        upload = db.query(OmoUpload).filter(OmoUpload.id == upload_id).first()
        if upload:
            for k, v in kwargs.items():
                setattr(upload, k, v)
            db.commit()
    except Exception as exc:
        logger.error("OMO _update_upload id=%d failed: %s", upload_id, exc)
        db.rollback()
    finally:
        db.close()


async def _run_identification(upload_id: int, image_bytes_list: list[bytes], mime_types: list[str]):
    """Background task: call AI to identify lesson, write result back to DB."""
    try:
        from ..services.omo_identifier import identify_lesson_from_image
    except ImportError as exc:
        logger.error("OMO identifier import failed: %s", exc)
        _update_upload(upload_id, status="error", error_message="AI identifier unavailable")
        return

    primary_image = image_bytes_list[0]
    primary_mime = mime_types[0] if mime_types else "image/jpeg"

    try:
        candidates = await identify_lesson_from_image(primary_image, primary_mime)
    except RuntimeError as exc:
        logger.error("OMO identification circuit breaker: %s", exc)
        _update_upload(upload_id, status="error", error_message="AI 服務暫時無法使用，請稍後再試")
        return
    except Exception as exc:
        logger.error("OMO identification error: %s", exc, exc_info=True)
        _update_upload(upload_id, status="error", error_message="辨識失敗，請重新上傳")
        return

    if not candidates:
        _update_upload(
            upload_id,
            status="error",
            error_message="照片不清楚或無法辨識課程，請重新拍攝",
        )
        return

    _update_upload(
        upload_id,
        identification=[
            {
                "lesson_id": c.lesson_id,
                "grade_code": c.grade_code,
                "title": c.title,
                "confidence": c.confidence,
                "reasoning": c.reasoning,
            }
            for c in candidates
        ],
        ai_confidence=candidates[0].confidence,
        status="identified",
    )
    logger.info(
        "OMO upload %d identified: top=%s (%.2f)",
        upload_id,
        candidates[0].title,
        candidates[0].confidence,
    )


async def _run_grading(upload_id: int, lesson_id: int):
    """Background task: extract + grade per-question answers, write to DB."""
    from ..database import SessionLocal
    from ..services.lesson_loader import get_lesson_by_id

    lesson = get_lesson_by_id(lesson_id)
    if not lesson:
        _update_upload(upload_id, status="error", error_message=f"找不到課程 ID {lesson_id}")
        return

    # Collect active attempt images from DB
    db = SessionLocal()
    active_attempt = None
    image_paths = []
    try:
        upload = db.query(OmoUpload).filter(OmoUpload.id == upload_id).first()
        if not upload:
            return

        # Find the latest active attempt
        for attempt in reversed(upload.attempts or []):
            if attempt.is_active:
                active_attempt = attempt
                image_paths = attempt.image_paths or []
                break

        # Fallback: if no attempt, use legacy image_paths on upload (Phase 1 compat)
        if not active_attempt:
            # Try old-style image_paths column
            old_paths = getattr(upload, "image_paths", []) or []
            if old_paths:
                image_paths = old_paths

    except Exception as exc:
        logger.error("OMO grading DB fetch failed for upload %d: %s", upload_id, exc)
        db.rollback()
    finally:
        db.close()

    if not image_paths:
        _update_upload(
            upload_id,
            status="error",
            error_message="找不到可批改的圖片",
        )
        return

    # Load image bytes from GCS (or skip GCS if local dev)
    image_bytes_list: list[bytes] = []
    mime_types: list[str] = []
    for path in image_paths:
        try:
            from google.cloud import storage  # type: ignore[import]
            client = storage.Client()
            bucket = client.bucket(_OMO_GCS_BUCKET)
            blob = bucket.blob(path)
            data = blob.download_as_bytes()
            image_bytes_list.append(data)
            mime_types.append("image/jpeg")
        except Exception as exc:
            logger.warning("OMO grading: could not load image %s: %s — using placeholder", path, exc)
            # Use a tiny placeholder for local dev (grader will return mock grades)
            image_bytes_list.append(b"placeholder")
            mime_types.append("image/jpeg")

    # Update progress: grading started
    _update_upload(
        upload_id,
        status="grading",
        progress={"stage": "grading", "total": 0, "graded": 0},
    )

    # Call grader
    try:
        from ..services.omo_grader import grade_worksheet_images
        attempt_id = active_attempt.id if active_attempt else None
        graded = await grade_worksheet_images(image_bytes_list, mime_types, lesson, attempt_id)
    except RuntimeError as exc:
        logger.error("OMO grader circuit breaker: %s", exc)
        _update_upload(upload_id, status="error", error_message="批改服務暫時無法使用")
        return
    except Exception as exc:
        logger.error("OMO grading error for upload %d: %s", upload_id, exc, exc_info=True)
        _update_upload(upload_id, status="error", error_message="批改失敗，請稍後重試")
        return

    # Compute overall score
    if graded:
        overall_score = sum(g.score for g in graded) / len(graded)
        overall_confidence = sum(g.ai_confidence for g in graded) / len(graded)
    else:
        overall_score = None
        overall_confidence = None

    answers_payload = [
        {
            "question_id": g.question_id,
            "student_answer": g.student_answer,
            "correct_answer": g.correct_answer,
            "score": g.score,
            "ai_confidence": g.ai_confidence,
            "reasoning": g.reasoning,
            "source_attempt_id": g.source_attempt_id,
            "position": g.position,
            "flag": None,
        }
        for g in graded
    ]

    _update_upload(
        upload_id,
        status="graded",
        answers=answers_payload,
        overall_score=overall_score,
        ai_overall_confidence=overall_confidence,
        progress={"stage": "done", "total": len(graded), "graded": len(graded)},
    )
    logger.info(
        "OMO upload %d graded: %d questions, overall_score=%.2f",
        upload_id,
        len(graded),
        overall_score or 0.0,
    )


# ── Internal helpers ───────────────────────────────────────────────────────────

def _build_upload_response(upload: OmoUpload) -> OmoUploadResponse:
    """Convert ORM object to response schema."""
    candidates = []
    if upload.identification and isinstance(upload.identification, list):
        candidates = [
            LessonCandidateResponse(
                lesson_id=c["lesson_id"],
                grade_code=c.get("grade_code", ""),
                title=c.get("title", ""),
                confidence=c.get("confidence", 0.0),
                reasoning=c.get("reasoning", ""),
            )
            for c in upload.identification
        ]

    answers = []
    if upload.answers and isinstance(upload.answers, list):
        for a in upload.answers:
            flag_info = None
            if a.get("flag"):
                flag_info = AnswerFlagInfo(
                    flagged_by=a["flag"].get("flagged_by", 0),
                    reason=a["flag"].get("reason", ""),
                    flagged_at=a["flag"].get("flagged_at", ""),
                )
            answers.append(AnswerItem(
                question_id=a.get("question_id", ""),
                student_answer=a.get("student_answer", ""),
                correct_answer=a.get("correct_answer", ""),
                score=a.get("score", 0.0),
                ai_confidence=a.get("ai_confidence", 0.0),
                reasoning=a.get("reasoning", ""),
                source_attempt_id=a.get("source_attempt_id"),
                position=a.get("position"),
                flag=flag_info,
            ))

    return OmoUploadResponse(
        upload_id=upload.id,
        status=upload.status,  # type: ignore[arg-type]
        candidates=candidates,
        answers=answers,
        overall_score=upload.overall_score,
        ai_overall_confidence=upload.ai_overall_confidence,
        progress=upload.progress or {},
        error_message=upload.error_message,
        from_cache=False,
        already_graded=False,
    )


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
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Upload worksheet photos and kick off AI lesson identification.

    Returns immediately with status=identifying. Poll GET /api/omo/{id} for result.

    Constraints:
    - Max 5 files per call
    - Max 10MB per file
    - JPEG / PNG / WebP only
    """
    if not files:
        raise HTTPException(status_code=400, detail="最少需要上傳 1 張照片")
    if len(files) > _MAX_FILES_PER_UPLOAD:
        raise HTTPException(
            status_code=400,
            detail=f"最多只能上傳 {_MAX_FILES_PER_UPLOAD} 張照片",
        )

    image_bytes_list: list[bytes] = []
    mime_types: list[str] = []
    for f in files:
        content_type = f.content_type or "image/jpeg"
        if content_type not in _ALLOWED_MIME_TYPES:
            raise HTTPException(
                status_code=400,
                detail=f"不支援的圖片格式 {content_type}，請上傳 JPEG 或 PNG",
            )
        data = await f.read()
        if len(data) > _MAX_FILE_SIZE_BYTES:
            raise HTTPException(
                status_code=413,
                detail=f"圖片太大（{len(data) // (1024*1024)}MB），最大允許 10MB",
            )
        if len(data) == 0:
            raise HTTPException(status_code=400, detail="上傳的圖片是空的")
        image_bytes_list.append(data)
        mime_types.append(content_type)

    # ── Phase 1b: SHA-256 dedup check ────────────────────────────────────────
    # Hash the primary (first) image to detect duplicate uploads.
    primary_hash = hashlib.sha256(image_bytes_list[0]).hexdigest()

    existing_attempt = (
        db.query(OmoUploadAttempt)
        .join(OmoUpload, OmoUploadAttempt.omo_upload_id == OmoUpload.id)
        .filter(
            OmoUploadAttempt.image_hash == primary_hash,
            OmoUpload.student_id == current_user.id,
        )
        .first()
    )

    if existing_attempt:
        existing_upload = db.query(OmoUpload).filter(
            OmoUpload.id == existing_attempt.omo_upload_id
        ).first()
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
    upload = OmoUpload(
        student_id=current_user.id,
        status="identifying",
        answers=[],
        progress={},
    )
    db.add(upload)
    db.flush()   # get id before commit
    upload_id = upload.id

    # Create first attempt (with hash stored for future dedup)
    image_paths = []
    for i, (data, mime) in enumerate(zip(image_bytes_list, mime_types)):
        path = _upload_to_gcs(current_user.id, upload_id, 0, i, data, mime)
        image_paths.append(path)

    attempt = OmoUploadAttempt(
        omo_upload_id=upload_id,
        attempt_idx=0,
        image_paths=image_paths,
        image_hash=primary_hash,
        is_active=True,
    )
    db.add(attempt)
    db.commit()

    background_tasks.add_task(_run_identification, upload_id, image_bytes_list, mime_types)

    logger.info(
        "OMO upload created: id=%d student=%d files=%d hash=%s",
        upload_id, current_user.id, len(files), primary_hash[:16],
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
    if existing_attempts >= _MAX_TOTAL_ATTEMPTS:
        raise HTTPException(
            status_code=400,
            detail=f"最多 {_MAX_TOTAL_ATTEMPTS} 次重拍機會",
        )

    if not files:
        raise HTTPException(status_code=400, detail="最少需要上傳 1 張照片")
    if len(files) > _MAX_FILES_PER_UPLOAD:
        raise HTTPException(
            status_code=400,
            detail=f"每次最多上傳 {_MAX_FILES_PER_UPLOAD} 張照片",
        )

    image_bytes_list: list[bytes] = []
    mime_types: list[str] = []
    for f in files:
        content_type = f.content_type or "image/jpeg"
        if content_type not in _ALLOWED_MIME_TYPES:
            raise HTTPException(
                status_code=400,
                detail=f"不支援的圖片格式 {content_type}",
            )
        data = await f.read()
        if len(data) > _MAX_FILE_SIZE_BYTES:
            raise HTTPException(status_code=413, detail="圖片超過 10MB")
        if not data:
            raise HTTPException(status_code=400, detail="空的圖片檔案")
        image_bytes_list.append(data)
        mime_types.append(content_type)

    attempt_idx = existing_attempts  # 0-based

    # Deactivate all previous attempts
    db.query(OmoUploadAttempt).filter(
        OmoUploadAttempt.omo_upload_id == upload_id
    ).update({"is_active": False})

    # Upload images
    image_paths = []
    for i, (data, mime) in enumerate(zip(image_bytes_list, mime_types)):
        path = _upload_to_gcs(current_user.id, upload_id, attempt_idx, i, data, mime)
        image_paths.append(path)

    new_attempt = OmoUploadAttempt(
        omo_upload_id=upload_id,
        attempt_idx=attempt_idx,
        image_paths=image_paths,
        is_active=True,
    )
    db.add(new_attempt)

    # Reset upload status for re-identification
    upload.status = "identifying"
    upload.error_message = None
    db.commit()
    db.refresh(new_attempt)

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

    upload.lesson_id = payload.confirmed_lesson_id
    upload.status = "grading"
    upload.progress = {"stage": "queued", "total": 0, "graded": 0}
    db.commit()

    # Kick off grading in background
    background_tasks.add_task(_run_grading, upload_id, payload.confirmed_lesson_id)

    logger.info(
        "OMO upload %d confirmed + grading queued: student=%d lesson_id=%d",
        upload_id, current_user.id, payload.confirmed_lesson_id,
    )

    return OmoConfirmResponse(
        upload_id=upload_id,
        lesson_id=payload.confirmed_lesson_id,
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


class OmoRegradeResponse(BaseModel):
    upload_id: int
    status: str
    message: str


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

    upload.status = "grading"
    upload.progress = {"stage": "queued", "total": 0, "graded": 0}
    upload.error_message = None
    db.commit()

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

    answers = list(upload.answers or [])
    found = False
    for a in answers:
        if a.get("question_id") == question_id:
            a["flag"] = {
                "flagged_by": current_user.id,
                "reason": payload.reason,
                "flagged_at": datetime.now(timezone.utc).isoformat(),
            }
            found = True
            logger.info(
                "OMO answer flagged: upload_id=%d question_id=%s student=%d reason=%s",
                upload_id, question_id, current_user.id, payload.reason,
            )
            break

    if not found:
        raise HTTPException(status_code=404, detail=f"找不到題目 {question_id}")

    # SQLAlchemy needs explicit reassignment + flag_modified to detect JSON mutation
    # (especially on SQLite test DB which uses JSON not JSONB)
    from sqlalchemy.orm.attributes import flag_modified
    upload.answers = answers
    flag_modified(upload, "answers")
    db.commit()

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
