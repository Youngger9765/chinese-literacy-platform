"""
Text Cleanup Service — soft-delete expired ClassroomText rows.

A ClassroomText is considered "expired" when:
  - expires_at is set (not NULL)
  - expires_at < now()
  - deleted_at is NULL (not yet soft-deleted)

The cleanup job marks expired rows by setting deleted_at = now().
Hard deletes are never performed.
"""

import logging
from dataclasses import dataclass
from datetime import datetime, timezone

from sqlalchemy.orm import Session

from ..models.school import ClassroomText

logger = logging.getLogger(__name__)


@dataclass
class CleanupPreview:
    """Result returned by preview_expired_texts()."""

    count: int
    items: list[dict]


@dataclass
class CleanupResult:
    """Result returned by run_cleanup()."""

    deleted_count: int
    items: list[dict]


def _expired_query(db: Session):
    """Return a SQLAlchemy query for all expired, not-yet-deleted ClassroomText rows."""
    now = datetime.now(timezone.utc)
    return (
        db.query(ClassroomText)
        .filter(
            ClassroomText.expires_at.isnot(None),
            ClassroomText.expires_at < now,
            ClassroomText.deleted_at.is_(None),
        )
    )


def preview_expired_texts(db: Session) -> CleanupPreview:
    """
    Return a preview of ClassroomText rows that would be soft-deleted.

    Does NOT modify any data.
    """
    rows = _expired_query(db).all()
    items = [
        {
            "id": ct.id,
            "classroom_id": ct.classroom_id,
            "text_id": ct.text_id,
            "assigned_at": ct.assigned_at.isoformat(),
            "expires_at": ct.expires_at.isoformat() if ct.expires_at else None,
        }
        for ct in rows
    ]
    logger.info("Text cleanup preview: %d rows would be soft-deleted", len(items))
    return CleanupPreview(count=len(items), items=items)


def run_cleanup(db: Session) -> CleanupResult:
    """
    Soft-delete all expired ClassroomText rows by setting deleted_at = now().

    Returns a CleanupResult with the count and details of affected rows.
    Commits the transaction before returning.
    """
    now = datetime.now(timezone.utc)
    rows = _expired_query(db).all()

    items = []
    for ct in rows:
        items.append(
            {
                "id": ct.id,
                "classroom_id": ct.classroom_id,
                "text_id": ct.text_id,
                "assigned_at": ct.assigned_at.isoformat(),
                "expires_at": ct.expires_at.isoformat() if ct.expires_at else None,
            }
        )
        ct.deleted_at = now

    db.commit()
    logger.info(
        "Text cleanup completed: %d rows soft-deleted",
        len(items),
        extra={"deleted_ids": [i["id"] for i in items]},
    )
    return CleanupResult(deleted_count=len(items), items=items)
