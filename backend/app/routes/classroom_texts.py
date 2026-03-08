"""
Classroom Texts API — assign / list / unassign platform stories for a classroom.
"""
import logging
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from ..auth.dependencies import get_current_user
from ..database import get_db
from ..models.school import Classroom, ClassroomText
from ..models.user import User
from ..services.lesson_loader import get_lesson_by_id
from .classrooms import _get_classroom_or_404, _require_owner_or_admin

router = APIRouter(tags=["classroom-texts"])
logger = logging.getLogger(__name__)


# ── Schemas ──────────────────────────────────────────────────────────────────


class ClassroomTextAssignRequest(BaseModel):
    text_id: str
    # Optional expiry: ISO-8601 datetime string, e.g. "2025-07-31T23:59:59+08:00".
    # Defaults to None (no automatic cleanup for this assignment).
    expires_at: datetime | None = None
    copyright_confirmed: bool = False


class ClassroomTextResponse(BaseModel):
    id: int
    text_id: str
    title: str
    assigned_at: datetime
    expires_at: datetime | None = None

    model_config = {"from_attributes": True}


# ── Endpoints ────────────────────────────────────────────────────────────────


@router.post(
    "/classrooms/{classroom_id}/texts",
    status_code=201,
    response_model=ClassroomTextResponse,
)
def assign_text_to_classroom(
    classroom_id: int,
    payload: ClassroomTextAssignRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Assign a platform story (text) to a classroom."""
    classroom = _get_classroom_or_404(classroom_id, db)
    _require_owner_or_admin(classroom, current_user, db)

    # Require copyright confirmation
    if not payload.copyright_confirmed:
        raise HTTPException(status_code=422, detail="copyright_confirmed must be true")

    # Validate that the story exists
    try:
        story = get_lesson_by_id(int(payload.text_id))
    except (ValueError, TypeError):
        raise HTTPException(status_code=422, detail="Invalid text_id format")
    if not story:
        raise HTTPException(status_code=404, detail="Story not found")

    # Check for duplicate assignment (including previously soft-deleted rows)
    existing = (
        db.query(ClassroomText)
        .filter(
            ClassroomText.classroom_id == classroom_id,
            ClassroomText.text_id == payload.text_id,
            ClassroomText.deleted_at.is_(None),
        )
        .first()
    )
    if existing:
        raise HTTPException(status_code=409, detail="Text already assigned to classroom")

    ct = ClassroomText(
        classroom_id=classroom_id,
        text_id=payload.text_id,
        assigned_by=current_user.id,
        expires_at=payload.expires_at,
    )
    db.add(ct)
    db.commit()
    db.refresh(ct)

    logger.info(
        "Assigned text %s to classroom %d (by user %d, expires_at=%s)",
        payload.text_id, classroom_id, current_user.id, payload.expires_at,
    )
    return ClassroomTextResponse(
        id=ct.id,
        text_id=ct.text_id,
        title=story["title"],
        assigned_at=ct.assigned_at,
        expires_at=ct.expires_at,
    )


@router.get(
    "/classrooms/{classroom_id}/texts",
    response_model=list[ClassroomTextResponse],
)
def list_classroom_texts(
    classroom_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """List all active (not soft-deleted) texts assigned to a classroom."""
    classroom = _get_classroom_or_404(classroom_id, db)
    _require_owner_or_admin(classroom, current_user, db)

    assignments = (
        db.query(ClassroomText)
        .filter(
            ClassroomText.classroom_id == classroom_id,
            ClassroomText.deleted_at.is_(None),
        )
        .order_by(ClassroomText.assigned_at.desc())
        .all()
    )

    results = []
    for ct in assignments:
        story = get_lesson_by_id(int(ct.text_id))
        title = story["title"] if story else f"Unknown ({ct.text_id})"
        results.append(
            ClassroomTextResponse(
                id=ct.id,
                text_id=ct.text_id,
                title=title,
                assigned_at=ct.assigned_at,
                expires_at=ct.expires_at,
            )
        )
    return results


@router.delete(
    "/classrooms/{classroom_id}/texts/{text_id}",
    status_code=204,
    response_model=None,
)
def unassign_text_from_classroom(
    classroom_id: int,
    text_id: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Remove a text assignment from a classroom."""
    classroom = _get_classroom_or_404(classroom_id, db)
    _require_owner_or_admin(classroom, current_user, db)

    ct = (
        db.query(ClassroomText)
        .filter(
            ClassroomText.classroom_id == classroom_id,
            ClassroomText.text_id == text_id,
            ClassroomText.deleted_at.is_(None),
        )
        .first()
    )
    if ct is None:
        raise HTTPException(status_code=404, detail="Text not assigned to classroom")

    db.delete(ct)
    db.commit()
    logger.info(
        "Unassigned text %s from classroom %d (by user %d)",
        text_id, classroom_id, current_user.id,
    )
    return None
