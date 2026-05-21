"""OMO background task functions — AI identification, grading, and DB update helpers.

Extracted from backend/app/routes/omo.py as part of the 4-module split.
AnalysisBy: issue #1770 — routes/omo.py 1197-line refactor.

Contains:
- _update_upload(): short-lived DB session helper for background tasks
- _run_identification(): background task — lesson identification via hint or Gemini AI
- _run_grading(): background task — per-question answer extraction + grading
"""

import logging
from typing import Optional

from ..models.omo_upload import OmoUpload
from .omo_storage import _OMO_GCS_BUCKET

logger = logging.getLogger(__name__)


# ── DB update helper ──────────────────────────────────────────────────────────

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


# ── Background task: lesson identification ────────────────────────────────────

async def _run_identification(
    upload_id: int,
    image_bytes_list: list[bytes],
    mime_types: list[str],
    lesson_code_hint: Optional[str] = None,
):
    """Background task: identify lesson and write result back to DB.

    If ``lesson_code_hint`` is provided (student uploaded from within a lesson
    page), use the fast hint path (no AI call, conf=1.0).  Otherwise fall back
    to the Gemini-powered fuzzy-match path.
    """
    # ── Hint path: lesson is already known, skip AI identification ────────────
    if lesson_code_hint:
        try:
            from ..services.omo_identifier import identify_lesson_from_hint
            candidates = identify_lesson_from_hint(lesson_code_hint)
        except ImportError as exc:
            logger.error("OMO identifier import failed: %s", exc)
            candidates = []

        if not candidates:
            logger.warning(
                "OMO hint path: lesson_code=%r not found — falling back to AI",
                lesson_code_hint,
            )
            # Fall through to AI path below
        else:
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
                "OMO upload %d hint-identified: lesson_code=%r title=%s conf=%.2f",
                upload_id,
                lesson_code_hint,
                candidates[0].title,
                candidates[0].confidence,
            )
            return

    # ── AI path: fuzzy match via Gemini ──────────────────────────────────────
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


# ── Background task: grading ─────────────────────────────────────────────────

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
        graded = await grade_worksheet_images(image_bytes_list, mime_types, lesson, attempt_id, upload_id=upload_id)
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
            "crop_image_url": g.crop_image_url,
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
