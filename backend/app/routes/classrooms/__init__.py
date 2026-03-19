"""Classrooms route package.

Sub-modules:
- helpers          — shared helpers, constants, permission checks
- classroom_crud   — CRUD: create, list, get, update classroom
- classroom_join   — join code: regenerate, join by code
- classroom_students — student management: add, remove, list, search
- classroom_batch  — batch student creation (JSON payload)
- classroom_csv    — CSV upload for batch student import

All sub-routers are merged into a single ``router`` exported from this package
so that ``main.py`` can continue to use ``classrooms.router`` without changes.
"""

from fastapi import APIRouter

from .classroom_batch import router as _batch_router
from .classroom_crud import router as _crud_router
from .classroom_csv import router as _csv_router
from .classroom_join import router as _join_router
from .classroom_students import router as _students_router

router = APIRouter(tags=["classrooms"])

# IMPORTANT: route registration order matters for FastAPI path matching.
# Static path segments (csv-template, my-enrollments, join) must be included
# BEFORE the parameterised /classrooms/{classroom_id} routes so that FastAPI
# does not attempt to coerce the literal segment into an integer.
#
# Within classroom_crud.py the static routes are already declared first, but
# we include all sub-routers here with no additional prefix so the ordering
# within each sub-module is preserved.

router.include_router(_crud_router)
router.include_router(_join_router)
router.include_router(_students_router)
router.include_router(_batch_router)
router.include_router(_csv_router)
