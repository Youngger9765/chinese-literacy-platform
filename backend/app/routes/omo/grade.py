"""OMO grade sub-module — confirm, status-poll, regrade endpoints.

Endpoints:
    POST /omo/{upload_id}/confirm  — confirm lesson + kick off grading job
    GET  /omo/{upload_id}          — poll status + get result
    POST /omo/{upload_id}/regrade  — re-trigger grading for already-graded upload

llm-endpoint-hardening checklist (inherited from omo.py):
- Rate-limit: 10/min on AI-triggering endpoints ✅
- Auth Depends: get_current_user on all endpoints ✅
- Fail-closed: status=error on AI failure ✅
- Reasoning field: every answer has reasoning ✅
"""

import logging

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException
from sqlalchemy.orm import Session

from ...auth.dependencies import get_current_user
from ...auth.rate_limiter import make_ai_rate_limit_dependency
from ...database import get_db
from ...models.omo_upload import OmoUpload
from ...models.user import User
from ...services.omo_jobs import _run_grading
from ...services.omo_responses import (
    OmoConfirmRequest,
    OmoConfirmResponse,
    OmoRegradeResponse,
    OmoUploadResponse,
    _build_upload_response,
)
from ...services.omo_state_service import apply_confirm, apply_regrade, resolve_lesson_id

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
