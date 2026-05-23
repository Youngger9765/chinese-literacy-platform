"""OMO upload sub-module — list-lessons, upload, attempt endpoints.

Endpoints:
    GET  /omo/lessons               — list OMO-eligible lessons for manual picker
    POST /omo/upload                — upload worksheet images, kick off identification
    POST /omo/{upload_id}/attempt   — add another image capture to existing upload

llm-endpoint-hardening checklist (inherited from omo.py):
- Rate-limit: 10/min on AI-triggering endpoints ✅
- Auth Depends: get_current_user on all endpoints ✅
- Input size cap: 10MB per file, max 5 files ✅
- Fail-closed: status=error on AI failure ✅
"""

import hashlib
import logging
from typing import Optional

from fastapi import APIRouter, BackgroundTasks, Depends, File, Form, HTTPException, UploadFile
from sqlalchemy.orm import Session

from ...auth.dependencies import get_current_user
from ...auth.rate_limiter import make_ai_rate_limit_dependency
from ...database import get_db
from ...models.omo_upload import OmoUpload, OmoUploadAttempt
from ...models.user import User
from ...services.omo_jobs import _run_identification
from ...services.omo_responses import (
    LessonSummaryResponse,
    OmoAttemptResponse,
    OmoUploadResponse,
    _build_upload_response,
)
from ...services.omo_storage import _upload_to_gcs
from ...services.omo_upload_service import (
    check_dedup,
    create_attempt_record,
    create_upload_record,
    supersede_existing_uploads,
)
from ...services.omo_upload_validator import validate_attempt_files, validate_upload_files

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
    from ...services.lesson_loader import get_all_lessons
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
        from ...services.omo_identifier import identify_lesson_from_hint
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
