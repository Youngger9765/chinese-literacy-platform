"""Teacher live classroom monitor endpoint — Issue #3025.

GET /api/teacher/classrooms/{classroom_id}/live-monitor

Polled by the frontend every 5-10s while the teacher has the monitor tab
open (issue #3025 decision: plain polling, not SSE/WebSocket — see the
service module docstring for the full "why"). Read-only, no side effects,
safe to call repeatedly.
"""
import logging
from datetime import datetime, timezone

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from ...auth.dependencies import get_current_user
from ...database import get_db
from ...dependencies.tenant import _check_classroom_access
from ...models.user import User
from ...services.live_monitor_service import (
    TRACKED_EXERCISE_TYPES,
    get_classroom_live_monitor,
)
from .teacher_schemas import LiveMonitorResponse, LiveMonitorStudentEntry

router = APIRouter(tags=["teacher"])
logger = logging.getLogger(__name__)


@router.get(
    "/teacher/classrooms/{classroom_id}/live-monitor",
    response_model=LiveMonitorResponse,
)
def get_classroom_live_monitor_endpoint(
    classroom_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Per-student snapshot: current 大題 + 「卡在這題」flag.

    Only a teacher with access to the classroom may call this (same
    `_check_classroom_access` rule as at-risk-students / stuck-overview:
    system_admin, the classroom's own teacher, a co-teacher on the
    classroom, or an org_admin of the same org). Raises 404 if the
    classroom does not exist, 403 otherwise.
    """
    _check_classroom_access(current_user, classroom_id, db)

    students = get_classroom_live_monitor(classroom_id, db)

    return LiveMonitorResponse(
        classroom_id=classroom_id,
        generated_at=datetime.now(timezone.utc),
        tracked_exercise_types=TRACKED_EXERCISE_TYPES,
        students=[LiveMonitorStudentEntry.model_validate(s) for s in students],
    )
