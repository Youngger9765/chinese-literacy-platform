"""
Feedback System API — users submit in-app feedback, admins manage it.

Endpoints:
  POST  /api/feedback          — Submit feedback (any authenticated user)
  GET   /api/feedback          — List all feedback (admin only, paginated)
  PATCH /api/feedback/{id}     — Update feedback status (admin only)
"""
import logging

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session, joinedload

from ..auth.dependencies import get_current_user, get_user_org_ids, require_role
from ..database import get_db
from ..dependencies.tenant import is_system_admin
from ..models.feedback import Feedback
from ..models.user import User, UserRole
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


def _get_feedback_org_scope_filter(current_user: User, db: Session):
    """Return a SQLAlchemy filter to scope feedback to the caller's org(s).

    system_admin: no filter (sees all feedback).
    org_admin / org_owner: sees only feedback submitted by users who belong
      to one of the caller's org scope(s).

    Feedback has no direct org FK, so we join via the submitter's UserRole.
    """
    if is_system_admin(current_user):
        return None  # no restriction

    caller_org_ids = get_user_org_ids(current_user) or []
    if not caller_org_ids:
        # org_admin with no org scope → sees nothing
        return Feedback.id.in_([])

    # Subquery: user_ids whose org scope overlaps with caller's orgs.
    # Use .scalar_subquery() to avoid SAWarning when used inside .in_().
    submitter_ids_subq = (
        db.query(UserRole.user_id)
        .filter(
            UserRole.is_active == True,
            UserRole.scope_type == "organization",
            UserRole.scope_id.in_(caller_org_ids),
        )
        .scalar_subquery()
    )
    return Feedback.user_id.in_(submitter_ids_subq)


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
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> FeedbackListResponse:
    """List feedback entries. Admin only, paginated.

    system_admin sees all feedback on the platform.
    org_admin / org_owner see only feedback from users within their org(s) —
    enforcing 個資法 §20.
    """
    query = db.query(Feedback)

    # Org scope restriction
    org_filter = _get_feedback_org_scope_filter(current_user, db)
    if org_filter is not None:
        query = query.filter(org_filter)

    if category:
        query = query.filter(Feedback.category == category)
    if status_filter:
        query = query.filter(Feedback.status == status_filter)

    total = query.count()
    # Issue #1768: joinedload(Feedback.user) avoids per-row lazy User query in
    # _feedback_to_response, which accesses feedback.user.name.
    items = (
        query.options(joinedload(Feedback.user))
        .order_by(Feedback.created_at.desc())
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
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> FeedbackResponse:
    """Update the status of a feedback entry. Admin only.

    system_admin may update any feedback.
    org_admin / org_owner may only update feedback from users in their org(s) —
    enforcing 個資法 §20.
    """
    feedback = db.query(Feedback).filter(Feedback.id == feedback_id).first()
    if not feedback:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Feedback #{feedback_id} not found",
        )

    # Scope check: org_admin may only modify feedback from their org's users
    if not is_system_admin(current_user):
        caller_org_ids = set(get_user_org_ids(current_user) or [])
        if caller_org_ids:
            # Check if the feedback submitter belongs to any of caller's orgs
            submitter_in_org = (
                db.query(UserRole)
                .filter(
                    UserRole.user_id == feedback.user_id,
                    UserRole.is_active == True,
                    UserRole.scope_type == "organization",
                    UserRole.scope_id.in_(caller_org_ids),
                )
                .first()
            )
            if not submitter_in_org:
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail="Not authorized to modify this feedback",
                )
        else:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Not authorized to modify this feedback",
            )

    feedback.status = body.status  # type: ignore[assignment]
    db.commit()
    db.refresh(feedback)
    logger.info("Feedback #%d status updated to '%s'", feedback_id, body.status)
    return _feedback_to_response(feedback)
