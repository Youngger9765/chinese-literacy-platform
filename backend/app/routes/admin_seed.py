"""Admin demo-seed route (Issue #989 minimal version).

Single endpoint: POST /api/admin/seed/demo-students
Gated by require_role("system_admin") and settings.enable_test_seed flag.

Production note: set ENABLE_TEST_SEED=false in Cloud Run env vars to disable.
Dev/staging default: True.
"""
import logging

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from ..auth.dependencies import require_role
from ..config import settings
from ..database import get_db
from ..schemas.admin_seed import DemoStudentSeedRequest, DemoStudentSeedResponse
from ..services.test_seed_service import seed_demo_students

logger = logging.getLogger(__name__)

router = APIRouter(tags=["admin-seed"])


@router.post(
    "/admin/seed/demo-students",
    response_model=DemoStudentSeedResponse,
    dependencies=[require_role("system_admin")],
    summary="Seed demo student accounts with completed sessions",
    description=(
        "Creates N demo student accounts, enrols them in the given classroom, "
        "and creates a completed LearningSession for each. "
        "Intended for demo preparation only. "
        "Disable in production by setting ENABLE_TEST_SEED=false."
    ),
)
def seed_demo_students_endpoint(
    req: DemoStudentSeedRequest,
    db: Session = Depends(get_db),
):
    if not settings.enable_test_seed:
        raise HTTPException(
            status_code=403,
            detail="Demo seed is disabled in this environment (ENABLE_TEST_SEED=false).",
        )

    try:
        result = seed_demo_students(db, req)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc

    return result
