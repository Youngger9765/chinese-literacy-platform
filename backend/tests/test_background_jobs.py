"""
Tests for background job infrastructure.

Covers:
- BackgroundJobRunner.submit() — returns job_id, job is tracked
- BackgroundJobRunner.get_status() — returns correct status dict
- BackgroundJobRunner.list_jobs() — returns all jobs newest-first
- Job lifecycle: PENDING → RUNNING → COMPLETED
- Failed job: PENDING → RUNNING → FAILED with error message
- Auto-cleanup of old completed jobs
- GET /api/admin/jobs — list jobs (admin only)
- GET /api/admin/jobs/{id} — get job status (admin only)
- POST /api/admin/jobs/test — submit test job (admin only)
- Non-admin users receive 403

Run with:
    cd /Users/young/project/chinese-literacy-platform-issue-266/backend
    python -m pytest tests/test_background_jobs.py -v
"""

import asyncio
import sys
import os
import uuid
from datetime import datetime, timedelta, timezone

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import pytest
import pytest_asyncio
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, event
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.main import app
from app.database import get_db
from app.models import Base
from app.models.user import Role, UserRole
from app.models.school import School
from app.services.background_jobs import BackgroundJobRunner, JobStatus


# ---------------------------------------------------------------------------
# In-memory SQLite test database
# ---------------------------------------------------------------------------

engine = create_engine(
    "sqlite://",
    connect_args={"check_same_thread": False},
    poolclass=StaticPool,
)


@event.listens_for(engine, "connect")
def _set_sqlite_pragma(dbapi_connection, connection_record):
    cursor = dbapi_connection.cursor()
    cursor.execute("PRAGMA foreign_keys=ON")
    cursor.close()


TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

SEED_ROLES = [
    {"name": "system_admin", "display_name": "System Admin", "scope_level": "platform"},
    {"name": "org_admin", "display_name": "Organization Admin", "scope_level": "organization"},
    {"name": "principal", "display_name": "Principal", "scope_level": "school"},
    {"name": "director", "display_name": "Director", "scope_level": "school"},
    {"name": "teacher", "display_name": "Teacher", "scope_level": "school"},
    {"name": "homeroom_teacher", "display_name": "Homeroom Teacher", "scope_level": "school"},
    {"name": "student", "display_name": "Student", "scope_level": "school"},
    {"name": "parent", "display_name": "Parent", "scope_level": "school"},
]


def _seed_roles(session):
    for role_data in SEED_ROLES:
        session.add(Role(**role_data))
    session.commit()


def _override_get_db():
    db = TestingSessionLocal()
    try:
        yield db
    finally:
        db.close()


def _make_admin(user_id: int, role_name: str = "system_admin"):
    db = TestingSessionLocal()
    role = db.query(Role).filter(Role.name == role_name).first()
    if role:
        db.add(UserRole(user_id=user_id, role_id=role.id, scope_type="platform", is_active=True))
        db.commit()
    db.close()


def auth_header(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


def _register_user(client, suffix: str) -> dict:
    unique = uuid.uuid4().hex[:8]
    email = f"{suffix}_{unique}@example.com"
    password = "SecurePass123!"
    resp = client.post(
        "/api/auth/register",
        json={"email": email, "password": password, "name": f"{suffix.title()} {unique}"},
    )
    assert resp.status_code == 201
    verification_token = resp.json()["verification_token"]
    client.get(f"/api/auth/verify-email?token={verification_token}")
    login_resp = client.post("/api/auth/login", json={"email": email, "password": password})
    token = login_resp.json()["access_token"]
    me_resp = client.get("/api/users/me", headers=auth_header(token))
    return {"token": token, "user_id": me_resp.json()["id"], "email": email}


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


@pytest.fixture(scope="module", autouse=True)
def setup_db():
    Base.metadata.create_all(bind=engine)
    session = TestingSessionLocal()
    _seed_roles(session)
    session.close()
    app.dependency_overrides[get_db] = _override_get_db
    yield
    app.dependency_overrides.pop(get_db, None)
    Base.metadata.drop_all(bind=engine)


@pytest.fixture(scope="module")
def client():
    with TestClient(app) as c:
        yield c


@pytest.fixture(scope="module")
def admin_token(client):
    info = _register_user(client, "admin")
    _make_admin(info["user_id"])
    return info["token"]


@pytest.fixture(scope="module")
def regular_token(client):
    info = _register_user(client, "user")
    return info["token"]


# ---------------------------------------------------------------------------
# Unit tests: BackgroundJobRunner (pure asyncio, no HTTP)
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_submit_returns_job_id():
    """submit() returns a non-empty string job_id."""
    runner = BackgroundJobRunner()

    async def noop():
        pass

    job_id = runner.submit(noop, job_name="noop")
    assert isinstance(job_id, str) and len(job_id) > 0

    # Let the event loop process the task
    await asyncio.sleep(0.05)


@pytest.mark.asyncio
async def test_job_lifecycle_completed():
    """Job progresses from PENDING to COMPLETED."""
    runner = BackgroundJobRunner()
    completed_flag = []

    async def quick_job():
        await asyncio.sleep(0.01)
        completed_flag.append(True)
        return "done"

    job_id = runner.submit(quick_job, job_name="quick_job")

    # Immediately after submit: status should be PENDING or RUNNING
    status_before = runner.get_status(job_id)
    assert status_before is not None
    assert status_before["status"] in (JobStatus.PENDING, JobStatus.RUNNING)

    # Wait for completion
    await asyncio.sleep(0.1)

    status_after = runner.get_status(job_id)
    assert status_after is not None
    assert status_after["status"] == JobStatus.COMPLETED
    assert status_after["completed_at"] is not None
    assert completed_flag == [True]


@pytest.mark.asyncio
async def test_job_lifecycle_failed():
    """A job that raises an exception transitions to FAILED with error message."""
    runner = BackgroundJobRunner()

    async def failing_job():
        raise RuntimeError("something went wrong")

    job_id = runner.submit(failing_job, job_name="failing_job")
    await asyncio.sleep(0.1)

    status = runner.get_status(job_id)
    assert status is not None
    assert status["status"] == JobStatus.FAILED
    assert "something went wrong" in status["error"]
    assert status["completed_at"] is not None


@pytest.mark.asyncio
async def test_get_status_unknown_job():
    """get_status() returns None for an unknown job_id."""
    runner = BackgroundJobRunner()
    result = runner.get_status("non-existent-id")
    assert result is None


@pytest.mark.asyncio
async def test_list_jobs_newest_first():
    """list_jobs() returns jobs sorted by created_at descending."""
    runner = BackgroundJobRunner()

    async def noop():
        await asyncio.sleep(0.001)

    id1 = runner.submit(noop, job_name="first")
    await asyncio.sleep(0.01)  # small gap so timestamps differ
    id2 = runner.submit(noop, job_name="second")

    # Wait for both to finish
    await asyncio.sleep(0.1)

    jobs = runner.list_jobs()
    assert len(jobs) >= 2
    ids = [j["job_id"] for j in jobs]
    assert ids.index(id2) < ids.index(id1), "Newer job should appear first"


@pytest.mark.asyncio
async def test_list_jobs_contains_job_fields():
    """Each entry from list_jobs() contains required fields."""
    runner = BackgroundJobRunner()

    async def noop():
        pass

    runner.submit(noop, job_name="field_check")
    await asyncio.sleep(0.1)

    jobs = runner.list_jobs()
    assert len(jobs) >= 1
    job = jobs[0]
    for field in ("job_id", "name", "status", "created_at", "started_at", "completed_at", "error"):
        assert field in job, f"Missing field: {field}"


@pytest.mark.asyncio
async def test_cleanup_removes_old_jobs():
    """Completed jobs older than CLEANUP_AFTER_HOURS are removed during cleanup."""
    runner = BackgroundJobRunner()
    runner.CLEANUP_AFTER_HOURS = 0  # Immediate cleanup for testing

    async def noop():
        pass

    job_id = runner.submit(noop, job_name="old_job")
    await asyncio.sleep(0.1)

    # After cleanup triggered by a new job, old job should be gone
    runner.submit(noop, job_name="trigger_cleanup")
    await asyncio.sleep(0.1)

    # The old job should be cleaned up
    result = runner.get_status(job_id)
    assert result is None, "Old completed job should have been cleaned up"

    runner.CLEANUP_AFTER_HOURS = 1  # restore default


@pytest.mark.asyncio
async def test_multiple_concurrent_jobs():
    """Multiple jobs can run concurrently without interference."""
    runner = BackgroundJobRunner()
    results = []

    async def counting_job(n: int):
        await asyncio.sleep(0.02)
        results.append(n)

    ids = [runner.submit(counting_job, i, job_name=f"job_{i}") for i in range(5)]
    await asyncio.sleep(0.15)

    for job_id in ids:
        status = runner.get_status(job_id)
        assert status["status"] == JobStatus.COMPLETED

    assert sorted(results) == [0, 1, 2, 3, 4]


# ---------------------------------------------------------------------------
# Integration tests: HTTP endpoints
# ---------------------------------------------------------------------------


def test_list_jobs_requires_admin(client, regular_token):
    """GET /api/admin/jobs returns 403 for non-admin users."""
    resp = client.get("/api/admin/jobs", headers=auth_header(regular_token))
    assert resp.status_code == 403


def test_list_jobs_requires_auth(client):
    """GET /api/admin/jobs returns 401 for unauthenticated requests."""
    resp = client.get("/api/admin/jobs")
    assert resp.status_code == 401


def test_list_jobs_admin_success(client, admin_token):
    """GET /api/admin/jobs returns job list for admin users."""
    resp = client.get("/api/admin/jobs", headers=auth_header(admin_token))
    assert resp.status_code == 200
    body = resp.json()
    assert "jobs" in body
    assert "total" in body
    assert isinstance(body["jobs"], list)
    assert body["total"] == len(body["jobs"])


def test_get_job_not_found(client, admin_token):
    """GET /api/admin/jobs/{id} returns 404 for unknown job_id."""
    resp = client.get("/api/admin/jobs/non-existent-id", headers=auth_header(admin_token))
    assert resp.status_code == 404


def test_get_job_requires_admin(client, regular_token):
    """GET /api/admin/jobs/{id} returns 403 for non-admin users."""
    resp = client.get("/api/admin/jobs/some-id", headers=auth_header(regular_token))
    assert resp.status_code == 403


def test_submit_test_job_requires_admin(client, regular_token):
    """POST /api/admin/jobs/test returns 403 for non-admin users."""
    resp = client.post(
        "/api/admin/jobs/test",
        json={"duration_seconds": 1},
        headers=auth_header(regular_token),
    )
    assert resp.status_code == 403


def test_submit_test_job_success(client, admin_token):
    """POST /api/admin/jobs/test returns 202 with job_id for admin."""
    resp = client.post(
        "/api/admin/jobs/test",
        json={"duration_seconds": 1},
        headers=auth_header(admin_token),
    )
    assert resp.status_code == 202
    body = resp.json()
    assert "job_id" in body
    assert body["status"] == "accepted"
    assert body["job_id"] in body["message"]


def test_submit_test_job_invalid_duration(client, admin_token):
    """POST /api/admin/jobs/test returns 422 for out-of-range duration."""
    resp = client.post(
        "/api/admin/jobs/test",
        json={"duration_seconds": 0},
        headers=auth_header(admin_token),
    )
    assert resp.status_code == 422

    resp = client.post(
        "/api/admin/jobs/test",
        json={"duration_seconds": 999},
        headers=auth_header(admin_token),
    )
    assert resp.status_code == 422


def test_get_submitted_job_status(client, admin_token):
    """After submitting a test job, GET /api/admin/jobs/{id} returns its status."""
    # Submit a job
    submit_resp = client.post(
        "/api/admin/jobs/test",
        json={"duration_seconds": 1},
        headers=auth_header(admin_token),
    )
    assert submit_resp.status_code == 202
    job_id = submit_resp.json()["job_id"]

    # Poll the status endpoint
    status_resp = client.get(f"/api/admin/jobs/{job_id}", headers=auth_header(admin_token))
    assert status_resp.status_code == 200
    body = status_resp.json()
    assert body["job_id"] == job_id
    assert body["name"] == "test_job"
    assert body["status"] in ("pending", "running", "completed", "failed")


def test_submitted_job_appears_in_list(client, admin_token):
    """After submitting a test job, it appears in GET /api/admin/jobs."""
    submit_resp = client.post(
        "/api/admin/jobs/test",
        json={"duration_seconds": 1},
        headers=auth_header(admin_token),
    )
    assert submit_resp.status_code == 202
    job_id = submit_resp.json()["job_id"]

    list_resp = client.get("/api/admin/jobs", headers=auth_header(admin_token))
    assert list_resp.status_code == 200
    job_ids = [j["job_id"] for j in list_resp.json()["jobs"]]
    assert job_id in job_ids
