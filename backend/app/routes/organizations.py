"""
organizations.py — Thin facade that assembles the split organization routers.

Issue #1890: organizations.py (549L) was split into four focused modules:

  organizations_crud.py        — POST/GET/PATCH/DELETE /organizations
  organization_dashboard.py    — GET /organizations/{id}/dashboard
  admin_report_export.py       — GET /admin/reports/export
  organization_points.py       — GET /organizations/{id}/points/logs

This module re-exports a combined ``router`` so that ``app/main.py`` requires
no changes (it still does ``app.include_router(organizations.router, ...)``).

Shared helpers remain importable from here for backwards-compatibility:

    from ..routes.organizations import _get_org_or_404, _org_to_response
"""

from fastapi import APIRouter

from .organizations_crud import (
    router as _crud_router,
    _get_org_or_404,          # re-export for any code that imports from here
    _org_to_response,         # re-export for any code that imports from here
    _get_school_count,        # re-export for any code that imports from here
)
from .organization_dashboard import router as _dashboard_router
from .admin_report_export import router as _export_router
from .organization_points import router as _points_router

# Combined router — main.py uses this unchanged
router = APIRouter()
router.include_router(_crud_router)
router.include_router(_dashboard_router)
router.include_router(_export_router)
router.include_router(_points_router)

__all__ = [
    "router",
    "_get_org_or_404",
    "_org_to_response",
    "_get_school_count",
]
