"""
Background Job Runner — asyncio-based in-process job queue.

P0 implementation: simple asyncio tasks within the FastAPI process.
No external dependencies required.

Future migration path: replace submit() internals with Cloud Tasks
while keeping the same interface for callers.
"""

import asyncio
import logging
import uuid
from datetime import datetime, timedelta, timezone
from enum import Enum
from typing import Any, Callable, Coroutine

logger = logging.getLogger(__name__)


class JobStatus(str, Enum):
    PENDING = "pending"
    RUNNING = "running"
    COMPLETED = "completed"
    FAILED = "failed"


class JobRecord:
    """In-memory record of a background job."""

    def __init__(self, job_id: str, name: str):
        self.job_id = job_id
        self.name = name
        self.status: JobStatus = JobStatus.PENDING
        self.created_at: datetime = datetime.now(timezone.utc)
        self.started_at: datetime | None = None
        self.completed_at: datetime | None = None
        self.error: str | None = None
        self.result: Any = None

    def to_dict(self) -> dict:
        return {
            "job_id": self.job_id,
            "name": self.name,
            "status": self.status,
            "created_at": self.created_at.isoformat(),
            "started_at": self.started_at.isoformat() if self.started_at else None,
            "completed_at": self.completed_at.isoformat() if self.completed_at else None,
            "error": self.error,
        }


class BackgroundJobRunner:
    """
    Simple asyncio-based background job runner.

    Tracks job state in memory. Suitable for single-instance deployments.
    Each job is an async coroutine submitted via submit().

    Thread-safety: relies on the GIL and asyncio event loop; concurrent
    writes to _jobs are safe within a single asyncio loop.
    """

    # Keep completed jobs for at most this long before auto-cleanup
    CLEANUP_AFTER_HOURS = 1

    def __init__(self):
        self._jobs: dict[str, JobRecord] = {}

    def submit(
        self,
        job_fn: Callable[..., Coroutine],
        *args: Any,
        job_name: str | None = None,
        **kwargs: Any,
    ) -> str:
        """
        Submit an async function to run as a background task.

        Args:
            job_fn: An async callable (coroutine function).
            *args:  Positional arguments forwarded to job_fn.
            job_name: Human-readable label. Defaults to function name.
            **kwargs: Keyword arguments forwarded to job_fn.

        Returns:
            job_id: UUID string that can be used with get_status().
        """
        job_id = str(uuid.uuid4())
        name = job_name or getattr(job_fn, "__name__", "unknown")
        record = JobRecord(job_id=job_id, name=name)
        self._jobs[job_id] = record

        # Schedule the wrapped coroutine on the running event loop.
        # create_task() is safe to call from within an async context (request handler).
        asyncio.create_task(self._run(record, job_fn, args, kwargs))

        logger.info("Background job submitted: %s (%s)", name, job_id)
        return job_id

    async def _run(
        self,
        record: JobRecord,
        job_fn: Callable[..., Coroutine],
        args: tuple,
        kwargs: dict,
    ) -> None:
        """Execute the job and update its record."""
        record.status = JobStatus.RUNNING
        record.started_at = datetime.now(timezone.utc)
        try:
            result = await job_fn(*args, **kwargs)
            record.result = result
            record.status = JobStatus.COMPLETED
            logger.info("Background job completed: %s (%s)", record.name, record.job_id)
        except Exception as exc:
            record.status = JobStatus.FAILED
            record.error = str(exc)
            logger.error(
                "Background job failed: %s (%s) — %s",
                record.name,
                record.job_id,
                exc,
                exc_info=True,
            )
        finally:
            record.completed_at = datetime.now(timezone.utc)
            self._cleanup_old_jobs()

    def get_status(self, job_id: str) -> dict | None:
        """
        Return job status dict, or None if job_id is unknown.

        Returns:
            dict with keys: job_id, name, status, created_at,
            started_at, completed_at, error.
        """
        record = self._jobs.get(job_id)
        if record is None:
            return None
        return record.to_dict()

    def list_jobs(self) -> list[dict]:
        """
        Return all tracked jobs sorted by created_at descending (newest first).
        """
        records = sorted(
            self._jobs.values(),
            key=lambda r: r.created_at,
            reverse=True,
        )
        return [r.to_dict() for r in records]

    def _cleanup_old_jobs(self) -> None:
        """Remove completed/failed jobs older than CLEANUP_AFTER_HOURS."""
        cutoff = datetime.now(timezone.utc) - timedelta(hours=self.CLEANUP_AFTER_HOURS)
        to_delete = [
            job_id
            for job_id, record in self._jobs.items()
            if record.status in (JobStatus.COMPLETED, JobStatus.FAILED)
            and record.completed_at is not None
            and record.completed_at < cutoff
        ]
        for job_id in to_delete:
            del self._jobs[job_id]
        if to_delete:
            logger.debug("Cleaned up %d old background jobs", len(to_delete))


# Module-level singleton — shared across all request handlers within a process.
job_runner = BackgroundJobRunner()
