"""Audit logging service for sensitive student PII access (Issue #522).

Emits structured JSON log records to the "audit" logger.
Cloud Run forwards stdout/stderr to Cloud Logging automatically, so these logs
will appear as structured log entries when the JSON is parsed by Cloud Logging.

Usage:
    # Direct call:
    audit_log(
        action=AuditAction.VIEW_STUDENT,
        user_id=current_user.id,
        target_student_id=student_id,
        ip_address=request.client.host,
        endpoint=str(request.url.path),
        method=request.method,
    )

    # Inside a FastAPI route with a Request object:
    audit_log_endpoint(
        request=request,
        action=AuditAction.VIEW_STUDENT,
        user_id=current_user.id,
        target_student_id=student_id,
    )
"""

import json
import logging
from datetime import datetime, timezone
from enum import Enum
from typing import Optional

from fastapi import Request

_audit_logger = logging.getLogger("audit")


class AuditAction(str, Enum):
    """Enumeration of auditable actions on student PII."""

    VIEW_STUDENT = "view_student"
    LIST_STUDENTS = "list_students"
    VIEW_SESSION = "view_session"
    EXPORT_REPORT = "export_report"
    DELETE_STUDENT = "delete_student"


def audit_log(
    *,
    action: AuditAction,
    user_id: int,
    target_student_id: Optional[int],
    ip_address: str,
    endpoint: str,
    method: str,
) -> None:
    """Emit a structured JSON audit log record.

    The "audit" logger uses the standard Python logging infrastructure.
    Cloud Run captures stdout/stderr and Cloud Logging parses JSON lines
    automatically, making these searchable in the Cloud Logging console.

    Args:
        action: The AuditAction describing what was done.
        user_id: The authenticated user performing the action.
        target_student_id: The student whose data was accessed (None for
            classroom-level actions that don't target a single student).
        ip_address: Client IP address from request.client.host.
        endpoint: URL path (e.g. "/api/teacher/students/42").
        method: HTTP method (e.g. "GET").
    """
    payload = {
        "audit": True,
        "user_id": user_id,
        "action": action.value if isinstance(action, AuditAction) else str(action),
        "target_student_id": target_student_id,
        "timestamp": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        "ip_address": ip_address,
        "endpoint": endpoint,
        "method": method,
    }
    _audit_logger.info(json.dumps(payload, ensure_ascii=False))


def audit_log_endpoint(
    *,
    request: Request,
    action: AuditAction,
    user_id: int,
    target_student_id: Optional[int] = None,
) -> None:
    """Convenience wrapper that extracts IP, endpoint, and method from a Request.

    Args:
        request: The FastAPI Request object from the route handler.
        action: The AuditAction describing what was done.
        user_id: The authenticated user performing the action.
        target_student_id: The student whose data was accessed (optional).
    """
    ip_address = "unknown"
    if request.client:
        ip_address = request.client.host

    audit_log(
        action=action,
        user_id=user_id,
        target_student_id=target_student_id,
        ip_address=ip_address,
        endpoint=str(request.url.path),
        method=request.method,
    )
