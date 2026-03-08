"""
Background Jobs Admin API.

Endpoints:
  GET  /api/admin/jobs          — List all background jobs (admin only)
  GET  /api/admin/jobs/{id}     — Get job detail / status (admin only)
  POST /api/admin/jobs/test     — Submit a test job (admin only)
"""

import asyncio
import logging

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel

from ..auth.dependencies import get_current_user, require_role
from ..models.user import User
from ..services.background_jobs import job_runner

router = APIRouter(tags=["admin-jobs"])
logger = logging.getLogger(__name__)


# ── Schemas ───────────────────────────────────────────────────────────────────


class JobResponse(BaseModel):
    job_id: str
    name: str
    status: str
    created_at: str
    started_at: str | None
    completed_at: str | None
    error: str | None

    model_config = {"from_attributes": True}


class JobListResponse(BaseModel):
    jobs: list[JobResponse]
    total: int


class TestJobRequest(BaseModel):
    duration_seconds: int = 5
    should_fail: bool = False


# ── Helpers ───────────────────────────────────────────────────────────────────


async def _test_job(duration_seconds: int, should_fail: bool) -> str:
    """Dummy job used by the test endpoint. Sleeps then optionally fails."""
    logger.info("Test job started (duration=%ds, should_fail=%s)", duration_seconds, should_fail)
    await asyncio.sleep(duration_seconds)
    if should_fail:
        raise ValueError("Test job was instructed to fail")
    return f"Test job completed after {duration_seconds}s"


# ── Endpoints ─────────────────────────────────────────────────────────────────


@router.get(
    "/admin/jobs",
    response_model=JobListResponse,
    summary="List background jobs",
    dependencies=[require_role("system_admin")],
)
async def list_jobs(
    current_user: User = Depends(get_current_user),
):
    """Return all tracked background jobs, newest first. Admin only."""
    jobs = job_runner.list_jobs()
    return JobListResponse(jobs=jobs, total=len(jobs))


@router.get(
    "/admin/jobs/{job_id}",
    response_model=JobResponse,
    summary="Get job status",
    dependencies=[require_role("system_admin")],
)
async def get_job(
    job_id: str,
    current_user: User = Depends(get_current_user),
):
    """Return status for a specific job. Admin only."""
    job = job_runner.get_status(job_id)
    if job is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Job {job_id!r} not found",
        )
    return job


@router.post(
    "/admin/jobs/test",
    response_model=dict,
    status_code=status.HTTP_202_ACCEPTED,
    summary="Submit a test background job",
    dependencies=[require_role("system_admin")],
)
async def submit_test_job(
    body: TestJobRequest,
    current_user: User = Depends(get_current_user),
):
    """
    Submit a test background job that sleeps for duration_seconds.
    Returns the job_id immediately; poll GET /admin/jobs/{id} for status.
    Admin only.
    """
    if body.duration_seconds < 1 or body.duration_seconds > 60:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="duration_seconds must be between 1 and 60",
        )

    job_id = job_runner.submit(
        _test_job,
        body.duration_seconds,
        body.should_fail,
        job_name="test_job",
    )

    logger.info("Test job submitted by %s: %s", current_user.email, job_id)
    return {
        "job_id": job_id,
        "status": "accepted",
        "message": f"Test job submitted. Poll GET /api/admin/jobs/{job_id} for status.",
    }
