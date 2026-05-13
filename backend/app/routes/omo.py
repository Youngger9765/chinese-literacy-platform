"""OMO (Online-Merge-Offline) API routes — Phase 1: upload + AI lesson identification.

Endpoints:
    POST /api/omo/upload          — upload worksheet images, trigger AI identification
    GET  /api/omo/{upload_id}     — poll status and get identification result
    POST /api/omo/{upload_id}/confirm  — student confirms lesson (stub for Phase 2)
    DELETE /api/omo/{upload_id}   — student privacy delete

llm-endpoint-hardening checklist:
- Rate-limit: global middleware (300 read / 90 write per IP/min) ✅
- Auth Depends: get_current_user on all write endpoints ✅
- Input size cap: 10MB per file, max 5 files ✅
- Output token cap: enforced in omo_identifier service (max_output_tokens=512) ✅
- Fail-closed: returns error status, never auto-identifies on AI failure ✅
- Reasoning field: each candidate has reasoning string ✅
"""

import logging
import os
import uuid
from typing import Literal, Optional

from fastapi import APIRouter, BackgroundTasks, Depends, File, HTTPException, UploadFile, status
from pydantic import BaseModel
from sqlalchemy.orm import Session

from ..auth.dependencies import get_current_user
from ..config import settings
from ..database import get_db
from ..models.omo_upload import OmoUpload
from ..models.user import User

logger = logging.getLogger(__name__)

router = APIRouter(tags=["omo"])

# ── Constants ──────────────────────────────────────────────────────────────────
_MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024   # 10MB per image
_MAX_FILES = 5                             # max images per upload
_OMO_GCS_BUCKET = os.environ.get("GCS_OMO_BUCKET", "lingoleap-omo-uploads")
_ALLOWED_MIME_TYPES = {"image/jpeg", "image/jpg", "image/png", "image/webp"}


# ── Pydantic schemas ───────────────────────────────────────────────────────────

class LessonCandidateResponse(BaseModel):
    lesson_id: int
    grade_code: str
    title: str
    confidence: float
    reasoning: str


class OmoUploadResponse(BaseModel):
    upload_id: int
    status: Literal["pending", "identifying", "identified", "failed"]
    candidates: list[LessonCandidateResponse]
    error_message: Optional[str] = None


class OmoConfirmRequest(BaseModel):
    confirmed_lesson_id: int


class OmoConfirmResponse(BaseModel):
    upload_id: int
    lesson_id: int
    message: str


# ── GCS helper ────────────────────────────────────────────────────────────────

def _upload_to_gcs(user_id: int, upload_id: int, file_index: int, data: bytes, mime_type: str) -> str:
    """Upload image bytes to GCS. Returns the GCS object path (not a signed URL).

    Falls back gracefully if google-cloud-storage is not installed (local dev).
    """
    object_path = f"{user_id}/{upload_id}/{file_index}.jpg"
    try:
        from google.cloud import storage  # type: ignore[import]
        client = storage.Client()
        bucket = client.bucket(_OMO_GCS_BUCKET)
        blob = bucket.blob(object_path)
        blob.upload_from_string(data, content_type=mime_type)
        logger.info("OMO: uploaded image to gs://%s/%s", _OMO_GCS_BUCKET, object_path)
    except ImportError:
        logger.warning("google-cloud-storage not available — skipping GCS upload (local dev)")
    except Exception as exc:
        logger.warning("OMO GCS upload failed for %s: %s — continuing without GCS", object_path, exc)
    return object_path


def _get_signed_url(object_path: str) -> Optional[str]:
    """Generate a 1-hour signed URL for a GCS object. Returns None if unavailable."""
    try:
        import datetime
        from google.cloud import storage  # type: ignore[import]
        client = storage.Client()
        bucket = client.bucket(_OMO_GCS_BUCKET)
        blob = bucket.blob(object_path)
        url = blob.generate_signed_url(
            version="v4",
            expiration=datetime.timedelta(hours=1),
            method="GET",
        )
        return url
    except Exception as exc:
        logger.debug("OMO signed URL generation failed for %s: %s", object_path, exc)
        return None


# ── Background task: AI identification ───────────────────────────────────────

async def _run_identification(upload_id: int, image_bytes_list: list[bytes], mime_types: list[str]):
    """Background task: call AI to identify lesson and write result back to DB.

    Uses the first image for identification (worksheet cover page).
    """
    from ..database import SessionLocal  # type: ignore[import]
    from .omo import router as _  # noqa: avoid circular at module level

    try:
        from ..services.omo_identifier import identify_lesson_from_image
    except ImportError as exc:
        logger.error("OMO identifier import failed: %s", exc)
        _update_status(upload_id, "failed", "AI identifier unavailable")
        return

    # Use the first image (most likely to have the title)
    primary_image = image_bytes_list[0]
    primary_mime = mime_types[0] if mime_types else "image/jpeg"

    try:
        candidates = await identify_lesson_from_image(primary_image, primary_mime)
    except RuntimeError as exc:
        logger.error("OMO identification circuit breaker: %s", exc)
        _update_status(upload_id, "failed", "AI 服務暫時無法使用，請稍後再試")
        return
    except Exception as exc:
        logger.error("OMO identification unexpected error: %s", exc, exc_info=True)
        _update_status(upload_id, "failed", "辨識失敗，請重新上傳")
        return

    _update_with_candidates(upload_id, candidates)


def _update_status(upload_id: int, status: str, error_message: str):
    """Helper: open a new DB session to update status. Used in background tasks."""
    from ..database import SessionLocal
    db = SessionLocal()
    try:
        upload = db.query(OmoUpload).filter(OmoUpload.id == upload_id).first()
        if upload:
            upload.status = status
            upload.error_message = error_message
            db.commit()
    except Exception as exc:
        logger.error("OMO _update_status failed for %d: %s", upload_id, exc)
        db.rollback()
    finally:
        db.close()


def _update_with_candidates(upload_id: int, candidates):
    """Helper: write identification result back to DB."""
    from ..database import SessionLocal
    db = SessionLocal()
    try:
        upload = db.query(OmoUpload).filter(OmoUpload.id == upload_id).first()
        if not upload:
            return

        if not candidates:
            upload.status = "failed"
            upload.error_message = "照片不清楚或無法辨識課程，請重新拍攝"
        else:
            upload.identification = [
                {
                    "lesson_id": c.lesson_id,
                    "grade_code": c.grade_code,
                    "title": c.title,
                    "confidence": c.confidence,
                    "reasoning": c.reasoning,
                }
                for c in candidates
            ]
            upload.ai_confidence = candidates[0].confidence
            upload.status = "identified"

        db.commit()
        logger.info(
            "OMO upload %d: status=%s, top_candidate=%s",
            upload_id,
            upload.status,
            candidates[0].title if candidates else "none",
        )
    except Exception as exc:
        logger.error("OMO _update_with_candidates failed for %d: %s", upload_id, exc)
        db.rollback()
    finally:
        db.close()


# ── Routes ────────────────────────────────────────────────────────────────────

@router.post("/omo/upload", response_model=OmoUploadResponse, status_code=201)
async def upload_worksheet(
    background_tasks: BackgroundTasks,
    files: list[UploadFile] = File(..., description="Worksheet photos (JPEG/PNG, max 10MB each, max 5 files)"),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Upload worksheet photos and kick off AI lesson identification.

    Returns immediately with status=identifying. Poll GET /api/omo/{id} for result.

    Input constraints:
    - Max 5 files per upload
    - Max 10MB per file
    - JPEG/PNG/WebP only
    """
    # Validate file count
    if not files:
        raise HTTPException(status_code=400, detail="最少需要上傳 1 張照片")
    if len(files) > _MAX_FILES:
        raise HTTPException(status_code=400, detail=f"最多只能上傳 {_MAX_FILES} 張照片")

    # Read and validate each file
    image_bytes_list: list[bytes] = []
    mime_types: list[str] = []

    for file in files:
        content_type = file.content_type or "image/jpeg"
        if content_type not in _ALLOWED_MIME_TYPES:
            raise HTTPException(
                status_code=400,
                detail=f"不支援的圖片格式 {content_type}，請上傳 JPEG 或 PNG",
            )

        data = await file.read()
        if len(data) > _MAX_FILE_SIZE_BYTES:
            raise HTTPException(
                status_code=413,
                detail=f"圖片太大（{len(data) // (1024*1024)}MB），最大允許 10MB",
            )
        if len(data) == 0:
            raise HTTPException(status_code=400, detail="上傳的圖片是空的")

        image_bytes_list.append(data)
        mime_types.append(content_type)

    # Create DB record (status=identifying)
    upload = OmoUpload(
        student_id=current_user.id,
        status="identifying",
        image_paths=[],  # will be updated after GCS upload
    )
    db.add(upload)
    db.flush()  # get upload.id before commit
    upload_id = upload.id

    # Upload images to GCS
    image_paths = []
    for i, (data, mime) in enumerate(zip(image_bytes_list, mime_types)):
        path = _upload_to_gcs(current_user.id, upload_id, i, data, mime)
        image_paths.append(path)

    upload.image_paths = image_paths
    db.commit()

    # Kick off AI identification in background
    background_tasks.add_task(
        _run_identification, upload_id, image_bytes_list, mime_types
    )

    logger.info(
        "OMO upload created: id=%d student=%d files=%d",
        upload_id, current_user.id, len(files),
    )

    return OmoUploadResponse(
        upload_id=upload_id,
        status="identifying",
        candidates=[],
    )


@router.get("/omo/{upload_id}", response_model=OmoUploadResponse)
def get_upload_status(
    upload_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Poll for AI identification result.

    Returns status=identifying while AI is running, status=identified with
    up to 3 candidates when done, or status=failed with an error message.
    """
    upload = db.query(OmoUpload).filter(
        OmoUpload.id == upload_id,
        OmoUpload.student_id == current_user.id,
    ).first()

    if not upload:
        raise HTTPException(status_code=404, detail="找不到此上傳記錄")

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

    return OmoUploadResponse(
        upload_id=upload.id,
        status=upload.status,  # type: ignore[arg-type]
        candidates=candidates,
        error_message=upload.error_message,
    )


@router.post("/omo/{upload_id}/confirm", response_model=OmoConfirmResponse)
def confirm_lesson(
    upload_id: int,
    payload: OmoConfirmRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Student confirms the AI's lesson identification.

    Phase 1: stores the confirmed lesson_id on the upload record.
    Phase 2: will trigger answer extraction + grading job.
    """
    upload = db.query(OmoUpload).filter(
        OmoUpload.id == upload_id,
        OmoUpload.student_id == current_user.id,
    ).first()

    if not upload:
        raise HTTPException(status_code=404, detail="找不到此上傳記錄")

    if upload.status not in ("identified", "failed"):
        raise HTTPException(
            status_code=409,
            detail=f"尚未完成辨識（目前狀態：{upload.status}），請稍後再確認",
        )

    # Validate the confirmed_lesson_id is among the candidates (or allow override)
    candidate_ids = []
    if upload.identification and isinstance(upload.identification, list):
        candidate_ids = [c["lesson_id"] for c in upload.identification]

    if candidate_ids and payload.confirmed_lesson_id not in candidate_ids:
        # Allow override (student manually selects) but log it
        logger.info(
            "OMO upload %d: student overrode AI — confirmed lesson_id=%d (candidates=%s)",
            upload_id,
            payload.confirmed_lesson_id,
            candidate_ids,
        )

    upload.lesson_id = payload.confirmed_lesson_id
    upload.status = "identified"  # Keep as identified after confirm
    db.commit()

    logger.info(
        "OMO upload %d confirmed: student=%d lesson_id=%d",
        upload_id,
        current_user.id,
        payload.confirmed_lesson_id,
    )

    return OmoConfirmResponse(
        upload_id=upload_id,
        lesson_id=payload.confirmed_lesson_id,
        message="確認成功！Phase 2 批改功能即將推出",  # Phase 2 stub message
    )


@router.delete("/omo/{upload_id}", status_code=204)
def delete_upload(
    upload_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Student privacy delete — removes DB record and schedules GCS cleanup.

    GCS object deletion is best-effort (logged on failure, not fatal).
    """
    upload = db.query(OmoUpload).filter(
        OmoUpload.id == upload_id,
        OmoUpload.student_id == current_user.id,
    ).first()

    if not upload:
        raise HTTPException(status_code=404, detail="找不到此上傳記錄")

    # Best-effort GCS cleanup
    for path in (upload.image_paths or []):
        try:
            from google.cloud import storage  # type: ignore[import]
            client = storage.Client()
            bucket = client.bucket(_OMO_GCS_BUCKET)
            bucket.blob(path).delete()
        except Exception as exc:
            logger.warning("OMO GCS delete failed for %s: %s", path, exc)

    db.delete(upload)
    db.commit()
    logger.info("OMO upload %d deleted by student %d", upload_id, current_user.id)
