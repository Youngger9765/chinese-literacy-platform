"""Session completion routes — GET /sessions/{id}/report alias.

Extracted from learning_sessions.py (Issue #1955).
The report endpoint is a semantic alias for the detail endpoint.
"""
import logging
from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from ...auth.dependencies import get_current_user
from ...database import get_db
from ...models.user import User
from ...schemas.session import SessionDetailResponse
from .sessions_progress import get_session_detail

router = APIRouter()
logger = logging.getLogger(__name__)


@router.get("/learning/sessions/{session_id}/report", response_model=SessionDetailResponse)
def get_session_report(
    session_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Get session report (semantic alias for session detail)."""
    return get_session_detail(session_id, current_user, db)
