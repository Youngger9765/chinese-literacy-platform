"""
Feedback System API — users submit in-app feedback, admins manage it.

Endpoints:
  POST  /api/feedback          — Submit feedback (any authenticated user)
  GET   /api/feedback          — List all feedback (admin only, paginated)
  PATCH /api/feedback/{id}     — Update feedback status (admin only)
"""
import logging

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from ..auth.dependencies import get_current_user, require_role
from ..database import get_db
from ..models.feedback import Feedback
from ..models.user import User
from ..schemas.feedback import (
    FeedbackCreateRequest,
    FeedbackListResponse,
    FeedbackResponse,
    FeedbackStatusUpdateRequest,
)
from ..services.input_sanitizer import sanitize_ai_input

router = APIRouter(tags=["feedback"])
logger = logging.getLogger(__name__)


def _feedback_to_response(feedback: Feedback) -> FeedbackResponse:
    return FeedbackResponse(
        id=feedback.id,
        user_id=feedback.user_id,
        user_name=feedback.user.name if feedback.user else "Unknown",
        category=feedback.category,
        title=feedback.title,
        description=feedback.description,
        page_url=feedback.page_url,
        status=feedback.status,
        created_at=feedback.created_at,
    )


@router.post("/feedback", response_model=FeedbackResponse, status_code=status.HTTP_201_CREATED)
def submit_feedback(
    body: FeedbackCreateRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> FeedbackResponse:
    """Submit feedback from any authenticated user."""
    # Sanitize user-provided text fields
    safe_title, _ = sanitize_ai_input(body.title, user_id=str(current_user.id))
    safe_description = body.description
    if safe_description:
        safe_description, _ = sanitize_ai_input(safe_description, user_id=str(current_user.id))

    feedback = Feedback(
        user_id=current_user.id,
        category=body.category,
        title=safe_title,
        description=safe_description,
        page_url=body.page_url,
        status="open",
    )
    db.add(feedback)
    db.commit()
    db.refresh(feedback)
    logger.info("Feedback #%d submitted by user %d", feedback.id, current_user.id)
    return _feedback_to_response(feedback)


@router.get(
    "/feedback",
    response_model=FeedbackListResponse,
    dependencies=[require_role("system_admin", "org_admin", "org_owner")],
)
def list_feedback(
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    category: str | None = Query(None),
    status_filter: str | None = Query(None, alias="status"),
    db: Session = Depends(get_db),
) -> FeedbackListResponse:
    """List all feedback entries. Admin only, with optional filters and pagination."""
    query = db.query(Feedback)

    if category:
        query = query.filter(Feedback.category == category)
    if status_filter:
        query = query.filter(Feedback.status == status_filter)

    total = query.count()
    items = (
        query.order_by(Feedback.created_at.desc())
        .offset((page - 1) * page_size)
        .limit(page_size)
        .all()
    )

    return FeedbackListResponse(
        items=[_feedback_to_response(f) for f in items],
        total=total,
        page=page,
        page_size=page_size,
    )


@router.patch(
    "/feedback/{feedback_id}",
    response_model=FeedbackResponse,
    dependencies=[require_role("system_admin", "org_admin", "org_owner")],
)
def update_feedback_status(
    feedback_id: int,
    body: FeedbackStatusUpdateRequest,
    db: Session = Depends(get_db),
) -> FeedbackResponse:
    """Update the status of a feedback entry. Admin only."""
    feedback = db.query(Feedback).filter(Feedback.id == feedback_id).first()
    if not feedback:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Feedback #{feedback_id} not found",
        )

    feedback.status = body.status  # type: ignore[assignment]
    db.commit()
    db.refresh(feedback)
    logger.info("Feedback #%d status updated to '%s'", feedback_id, body.status)
    return _feedback_to_response(feedback)
