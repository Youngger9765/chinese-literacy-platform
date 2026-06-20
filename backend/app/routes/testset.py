"""Testset collection API — Issue #2287.

Two endpoints (public, no auth):
  POST /api/testset/upload  — upload one audio recording
  GET  /api/testset/list    — list all recordings (owner view)

Security posture (public endpoint, no login):
  - Rate-limit: 10 uploads / min per IP (InMemoryRateLimiter reuse)
  - Size cap: 15 MB audio max
  - Content-type allowlist: audio/* only
  - Fail-closed: any GCS / DB error → 503, never silently accept
  - No PII beyond self-reported name/grade
  - GCS bucket: controlled by READING_AUDIO_GCS_BUCKET env var (same bucket,
    separate prefix test-dataset/ so student audio is never mixed)
"""
from __future__ import annotations

import logging
import re
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, File, Form, HTTPException, Request, UploadFile
from pydantic import BaseModel
from sqlalchemy.orm import Session

from ..auth.rate_limiter import InMemoryRateLimiter
from ..database import get_db
from ..models.testset_recording import TestsetRecording
from ..services.audio_upload_service import upload_reading_audio_to_gcs_sync

logger = logging.getLogger(__name__)

router = APIRouter()

# ── Rate limiter (per-IP, 10 uploads / min) ──────────────────────────────────
_upload_rate_limiter = InMemoryRateLimiter()
_UPLOAD_MAX = 10
_UPLOAD_WINDOW = 60  # seconds

# ── Constants ─────────────────────────────────────────────────────────────────
MAX_AUDIO_BYTES = 15 * 1024 * 1024  # 15 MB
ALLOWED_VERSIONS = {"correct", "error"}

# ── Helpers ───────────────────────────────────────────────────────────────────

def _get_client_ip(request: Request) -> str:
    forwarded = request.headers.get("X-Forwarded-For")
    if forwarded:
        return forwarded.split(",")[0].strip()
    return (request.client.host if request.client else "unknown")


def _slug(text: str) -> str:
    """Simple slug for GCS path: lowercase, only alphanum + dash."""
    return re.sub(r"[^a-z0-9\-]", "-", text.lower().strip())[:50]


def _check_rate_limit(request: Request) -> None:
    ip = _get_client_ip(request)
    if not _upload_rate_limiter.check(f"testset:upload:{ip}", _UPLOAD_MAX, _UPLOAD_WINDOW):
        raise HTTPException(
            status_code=429,
            detail="上傳太頻繁，請稍後再試（每分鐘最多 10 次）",
        )


# ── Response schemas ──────────────────────────────────────────────────────────

class UploadResponse(BaseModel):
    id: int
    message: str
    gcs_path: str


class RecordingItem(BaseModel):
    id: int
    contributor_name: str
    grade: str
    lesson_id: str
    version: str
    audio_gcs_path: str
    created_at: datetime

    model_config = {"from_attributes": True}


class ListResponse(BaseModel):
    total: int
    recordings: list[RecordingItem]


# ── Routes ────────────────────────────────────────────────────────────────────

@router.post(
    "/testset/upload",
    response_model=UploadResponse,
    summary="Upload one testset recording (public, no auth)",
    tags=["testset"],
)
async def upload_testset_recording(
    request: Request,
    contributor_name: str = Form(..., max_length=100),
    grade: str = Form(..., max_length=20),
    lesson_id: str = Form(..., max_length=50),
    version: str = Form(...),
    audio: UploadFile = File(...),
    db: Session = Depends(get_db),
) -> UploadResponse:
    """Upload one audio recording to the testset collection.

    Args:
        contributor_name: Self-reported name (no auth, max 100 chars).
        grade: Self-reported grade/role (e.g. "小四", "大人").
        lesson_id: Lesson identifier (e.g. "L01", "G6-L9").
        version: "correct" or "error".
        audio: Audio file (webm preferred; ≤15 MB).

    Returns:
        UploadResponse with DB id + GCS path on success.

    Raises:
        400 — invalid version / bad content-type.
        413 — audio > 15 MB.
        429 — rate limit exceeded.
        503 — GCS or DB failure (fail-closed).
    """
    # 1. Rate limit
    _check_rate_limit(request)

    # 2. Validate version
    if version not in ALLOWED_VERSIONS:
        raise HTTPException(
            status_code=400,
            detail=f"version 必須是 'correct' 或 'error'，收到: {version!r}",
        )

    # 3. Validate content-type
    raw_ct = (audio.content_type or "").split(";")[0].strip().lower()
    if not raw_ct.startswith("audio/"):
        raise HTTPException(
            status_code=400,
            detail=f"只接受 audio/* 格式，收到: {audio.content_type!r}",
        )

    # 4. Read + size cap
    try:
        audio_bytes = await audio.read()
    except Exception as exc:
        logger.error("testset upload: read failed: %s", exc)
        raise HTTPException(status_code=503, detail="讀取音檔失敗，請重試")

    if len(audio_bytes) > MAX_AUDIO_BYTES:
        raise HTTPException(
            status_code=413,
            detail=f"音檔過大（最大 15 MB），實際 {len(audio_bytes) // (1024*1024)} MB",
        )
    if len(audio_bytes) == 0:
        raise HTTPException(status_code=400, detail="音檔為空")

    # 5. Build GCS path — timestamp-based, collision-resistant
    contributor_slug = _slug(contributor_name)
    lesson_slug = _slug(lesson_id)
    ts = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    temp_path = f"test-dataset/{contributor_slug}/{lesson_slug}/{version}_{ts}.webm"

    # 6. Upload to GCS (fail-closed — if GCS not configured, 503)
    gcs_path = upload_reading_audio_to_gcs_sync(
        audio_bytes=audio_bytes,
        mime_type=raw_ct or "audio/webm",
        blob_path=temp_path,
    )
    if gcs_path is None:
        logger.error(
            "testset upload: GCS upload returned None for contributor=%s lesson=%s",
            contributor_name,
            lesson_id,
        )
        raise HTTPException(
            status_code=503,
            detail="GCS 儲存失敗，請聯絡管理員（READING_AUDIO_GCS_BUCKET 未設定或服務不可用）",
        )

    # 7. Persist to DB
    try:
        record = TestsetRecording(
            contributor_name=contributor_name,
            grade=grade,
            lesson_id=lesson_id,
            version=version,
            audio_gcs_path=gcs_path,
        )
        db.add(record)
        db.commit()
        db.refresh(record)
    except Exception as exc:
        db.rollback()
        logger.error("testset upload: DB insert failed: %s", exc)
        raise HTTPException(status_code=503, detail="資料庫寫入失敗，請重試")

    logger.info(
        "testset upload OK: id=%d contributor=%s grade=%s lesson=%s version=%s bytes=%d",
        record.id,
        contributor_name,
        grade,
        lesson_id,
        version,
        len(audio_bytes),
    )

    return UploadResponse(
        id=record.id,
        message="上傳成功！",
        gcs_path=gcs_path,
    )


@router.get(
    "/testset/list",
    response_model=ListResponse,
    summary="List all testset recordings (owner view)",
    tags=["testset"],
)
def list_testset_recordings(
    db: Session = Depends(get_db),
    limit: int = 500,
    offset: int = 0,
) -> ListResponse:
    """Return all testset recordings, newest first.

    This endpoint is intentionally public (no auth) for v1 — the list.html
    is only shared with Young/team. If the list grows, add a simple secret
    header check here.

    Args:
        limit:  Max rows to return (default 500).
        offset: Pagination offset (default 0).
    """
    try:
        total = db.query(TestsetRecording).count()
        rows = (
            db.query(TestsetRecording)
            .order_by(TestsetRecording.created_at.desc())
            .offset(offset)
            .limit(min(limit, 1000))
            .all()
        )
    except Exception as exc:
        logger.error("testset list: DB query failed: %s", exc)
        raise HTTPException(status_code=503, detail="資料庫查詢失敗")

    return ListResponse(
        total=total,
        recordings=[RecordingItem.model_validate(r) for r in rows],
    )
