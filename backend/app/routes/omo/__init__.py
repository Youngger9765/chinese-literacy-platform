"""OMO (Online-Merge-Offline) API routes — split into focused sub-modules.

AnalysisBy: issue #1949 — split residual omo.py (653L) into 3 focused modules:
  - routes/omo/upload.py    — list-lessons, upload, attempt endpoints
  - routes/omo/grade.py     — confirm, status-poll, regrade endpoints
  - routes/omo/lifecycle.py — flag, signed-url, delete, crops, by-lesson endpoints
  - routes/omo/__init__.py  — thin facade: compose sub-routers + re-export

Route registration order is critical for FastAPI path resolution:
  Static paths (/omo/lessons, /omo/by-lesson/{id}) must be registered BEFORE
  parameterized paths (/omo/{upload_id}) to avoid shadowing.
"""

from fastapi import APIRouter

from .grade import router as _grade_router
from .lifecycle import router as _lifecycle_router
from .upload import router as _upload_router

router = APIRouter(tags=["omo"])

# Registration order: static-path routers first, then parameterized
# lifecycle includes /omo/by-lesson/{lesson_id} (static prefix)
# upload includes /omo/lessons (static) and /omo/{upload_id}/attempt (parameterized)
# grade includes /omo/{upload_id}/confirm, /omo/{upload_id}, /omo/{upload_id}/regrade
router.include_router(_upload_router)
router.include_router(_lifecycle_router)
router.include_router(_grade_router)

__all__ = ["router"]
