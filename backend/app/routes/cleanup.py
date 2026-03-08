"""
Admin Text Cleanup API — preview and run the soft-delete cleanup job.

Endpoints:
  GET  /api/admin/cleanup/preview  — Show texts that would be soft-deleted
  POST /api/admin/cleanup/run      — Manually trigger the cleanup job
"""

import logging

from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy.orm import Session

from ..auth.dependencies import get_current_user, require_role
from ..database import get_db
from ..models.user import User
from ..services.text_cleanup_service import preview_expired_texts, run_cleanup

router = APIRouter(tags=["admin-cleanup"])
logger = logging.getLogger(__name__)


# ── Schemas ───────────────────────────────────────────────────────────────────


class ExpiredTextItem(BaseModel):
    id: int
    classroom_id: int
    text_id: str
    assigned_at: str
    expires_at: str | None


class CleanupPreviewResponse(BaseModel):
    count: int
    items: list[ExpiredTextItem]


class CleanupRunResponse(BaseModel):
    deleted_count: int
    items: list[ExpiredTextItem]


# ── Endpoints ─────────────────────────────────────────────────────────────────


@router.get(
    "/admin/cleanup/preview",
    response_model=CleanupPreviewResponse,
    summary="Preview expired classroom texts",
    dependencies=[require_role("system_admin")],
)
def cleanup_preview(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """
    Return classroom texts whose expires_at is in the past and have not yet
    been soft-deleted. No data is modified.

    Admin only.
    """
    result = preview_expired_texts(db)
    logger.info(
        "Cleanup preview requested by user %d: %d items",
        current_user.id,
        result.count,
    )
    return CleanupPreviewResponse(count=result.count, items=result.items)


@router.post(
    "/admin/cleanup/run",
    response_model=CleanupRunResponse,
    summary="Soft-delete expired classroom texts",
    dependencies=[require_role("system_admin")],
)
def cleanup_run(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """
    Soft-delete all classroom texts whose expires_at < now() by setting
    deleted_at = now().

    This is idempotent — running it multiple times is safe.
    Admin only.
    """
    result = run_cleanup(db)
    logger.info(
        "Cleanup run by user %d: %d rows soft-deleted",
        current_user.id,
        result.deleted_count,
    )
    return CleanupRunResponse(deleted_count=result.deleted_count, items=result.items)
