"""
TenantMiddleware — enriches request.state with organization context.

This middleware does NOT block requests. It only extracts organization
context from the authenticated user and injects it into request.state
so that downstream dependencies and routes can use it without re-querying.

Usage in main.py:
    app.add_middleware(TenantMiddleware)

Then in any route you can access:
    request.state.organization_id  -> str | None
    request.state.user_role        -> str | None
"""
from __future__ import annotations

import logging

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import Response

from ..models.user import User

logger = logging.getLogger(__name__)


def _extract_org_context(user: User | None) -> dict:
    """Extract organization context from a user's active roles.

    Returns a dict with:
      - organization_id: str | None — the first org-scoped org ID, or None
      - user_role: str | None — the most significant role name

    system_admin is detected first and returns organization_id=None
    (they span all orgs). For all other users, the first active
    org-scoped UserRole's scope_id is returned.

    Args:
        user: The authenticated User ORM object, or None for anonymous.

    Returns:
        Dict with keys 'organization_id' and 'user_role'.
    """
    if user is None:
        return {"organization_id": None, "user_role": None}

    # system_admin takes precedence — no specific org binding
    for ur in user.user_roles:
        if ur.is_active and ur.role and ur.role.name == "system_admin":
            return {"organization_id": None, "user_role": "system_admin"}

    # Find first active organization-scoped role
    for ur in user.user_roles:
        if ur.is_active and ur.scope_type == "organization" and ur.scope_id:
            role_name = ur.role.name if ur.role else None
            return {"organization_id": ur.scope_id, "user_role": role_name}

    return {"organization_id": None, "user_role": None}


class TenantMiddleware(BaseHTTPMiddleware):
    """Starlette middleware that injects organization context into request.state.

    Must be registered AFTER authentication middleware so that the
    authenticated user is already available in request.state.user.

    This middleware is passive — it enriches context but never blocks.
    Authorization enforcement is handled by FastAPI dependencies in
    app/dependencies/tenant.py.

    Injected attributes:
        request.state.organization_id: str | None
        request.state.user_role: str | None
    """

    async def dispatch(self, request: Request, call_next) -> Response:
        # Try to read user from request.state if already set by auth middleware
        user: User | None = getattr(request.state, "user", None)
        ctx = _extract_org_context(user)

        request.state.organization_id = ctx["organization_id"]
        request.state.user_role = ctx["user_role"]

        response = await call_next(request)
        return response
