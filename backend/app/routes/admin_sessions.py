"""
Admin Session Listing API — list and inspect LearningSession records for debugging.

All endpoints require system_admin role.
"""

from collections import Counter

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from ..auth.dependencies import require_role
from ..database import get_db
from ..models.session import LearningSession

router = APIRouter(tags=["admin-sessions"])


# ── GET /api/admin/sessions ──────────────────────────────────────────────────

@router.get(
    "/admin/sessions",
    dependencies=[require_role("system_admin")],
)
def list_sessions(
    student_id: int | None = None,
    story_slug: str | None = None,
    status: str | None = None,
    limit: int = 100,
    db: Session = Depends(get_db),
):
    """List LearningSession records with optional filters.

    Supports filtering by student_id, story_slug, and status.
    Returns aggregate counts alongside individual session rows.
    Intended for admin debugging — not for student-facing use.
    """
    query = db.query(LearningSession)
    if student_id is not None:
        query = query.filter(LearningSession.student_id == student_id)
    if story_slug is not None:
        query = query.filter(LearningSession.story_slug == story_slug)
    if status is not None:
        query = query.filter(LearningSession.status == status)

    sessions = (
        query.order_by(LearningSession.started_at.desc()).limit(limit).all()
    )

    by_status = Counter(s.status for s in sessions)
    by_slug = Counter(s.story_slug for s in sessions)

    return {
        "total": len(sessions),
        "by_status": dict(by_status),
        "by_slug": dict(by_slug),
        "sessions": [
            {
                "id": s.id,
                "student_id": s.student_id,
                "story_slug": s.story_slug,
                "status": s.status,
                "current_step": s.current_step_derived,  # derived from step_progress (#1182)
                "started_at": s.started_at.isoformat(),
                "completed_at": s.completed_at.isoformat() if s.completed_at else None,
            }
            for s in sessions
        ],
    }
