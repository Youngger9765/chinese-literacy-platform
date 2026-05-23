"""Learning Session routes — thin facade re-exporting the composed router.

Split from the original 515-line monolith (Issue #1955) into:
  sessions_bootstrap.py  — POST /sessions create, list, reading-history
  sessions_progress.py   — GET detail, GET status, PATCH progress
  sessions_complete.py   — GET /sessions/{id}/report (alias)

Callers that import `router` from this module continue to work unchanged.
"""
from fastapi import APIRouter

from .sessions_bootstrap import router as _bootstrap_router
from .sessions_progress import router as _progress_router
from .sessions_complete import router as _complete_router

# Re-export helper and constant for any callers that import them directly
from .sessions_bootstrap import _is_assignment_session, MAX_READING_HISTORY_FETCH  # noqa: F401

router = APIRouter()
router.include_router(_bootstrap_router)
router.include_router(_progress_router)
router.include_router(_complete_router)
