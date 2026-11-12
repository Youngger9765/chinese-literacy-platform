"""Admin demo-seed route (Issue #989 minimal version).

Endpoints:
  POST   /admin/seed/demo-students          — create/reuse demo students
  DELETE /admin/seed/demo-students           — #3750 cleanup counterpart

Both gated by require_role("system_admin") and settings.enable_test_seed.

Production note: set ENABLE_TEST_SEED=false in Cloud Run env vars to disable.
Dev/staging default: True.
"""
import logging

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from ..auth.dependencies import require_role
from ..config import settings
from ..database import get_db
from ..schemas.admin_seed import (
    DemoStudentCleanupResponse,
    DemoStudentSeedRequest,
    DemoStudentSeedResponse,
)
from ..services.test_seed_service import (
    DemoSeedCapExceeded,
    cleanup_demo_students,
    seed_demo_students,
)

logger = logging.getLogger(__name__)

router = APIRouter(tags=["admin-seed"])


def _require_test_seed_enabled() -> None:
    if not settings.enable_test_seed:
        raise HTTPException(
            status_code=403,
            detail="Demo seed is disabled in this environment (ENABLE_TEST_SEED=false).",
        )


@router.post(
    "/admin/seed/demo-students",
    response_model=DemoStudentSeedResponse,
    dependencies=[require_role("system_admin")],
    summary="Seed demo student accounts with completed sessions",
    description=(
        "Creates N demo student accounts, enrols them in the given classroom, "
        "and creates a completed LearningSession for each. "
        "Intended for demo preparation only. "
        "Disable in production by setting ENABLE_TEST_SEED=false. "
        "Capped per classroom (#3750) — callers MUST reuse a stable `prefix` "
        "across repeated calls (e.g. in automated tests) rather than minting "
        "a new one every run, or the cap will reject the call."
    ),
)
def seed_demo_students_endpoint(
    req: DemoStudentSeedRequest,
    db: Session = Depends(get_db),
):
    _require_test_seed_enabled()

    try:
        result = seed_demo_students(db, req)
    except DemoSeedCapExceeded as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc

    return result


@router.delete(
    "/admin/seed/demo-students",
    response_model=DemoStudentCleanupResponse,
    dependencies=[require_role("system_admin")],
    summary="Remove throwaway @testdata.lingoleap.dev enrollments from a classroom",
    description=(
        "#3750 — reverses classroom pollution caused by seed calls that defeated "
        "seed_demo_students's per-email idempotency (a unique prefix every call). "
        "Removes ClassroomStudent enrollments and any already-locked "
        "LeagueTeamRosterMember rows for @testdata.lingoleap.dev accounts in the "
        "given classroom. Does NOT delete the User or LearningSession rows those "
        "accounts created. Idempotent; disabled when ENABLE_TEST_SEED=false. "
        "SAFE BY DEFAULT: `dry_run` defaults to true and only counts what would "
        "be removed — pass `?dry_run=false` explicitly to actually delete."
    ),
)
def cleanup_demo_students_endpoint(
    classroom_id: int = Query(..., description="Classroom to clean up"),
    dry_run: bool = Query(
        True,
        description=(
            "true (default): preview counts only, nothing is deleted. "
            "false: actually delete."
        ),
    ),
    db: Session = Depends(get_db),
):
    _require_test_seed_enabled()

    try:
        result = cleanup_demo_students(db, classroom_id, dry_run=dry_run)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc

    return result
