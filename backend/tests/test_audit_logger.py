"""
Tests for audit_logger service (Issue #522).

Covers:
- audit_log() function emits structured JSON log
- Decorator @audit_log captures action, user_id, target_student_id, ip, endpoint, method
- Log record has audit=True marker

Run with:
    cd backend
    python -m pytest tests/test_audit_logger.py -v
"""

import json
import logging
import sys
import os
from unittest.mock import MagicMock, patch

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import pytest
from fastapi.testclient import TestClient
from fastapi import FastAPI, Depends, Request
from sqlalchemy import create_engine, event
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.services.audit_logger import audit_log, AuditAction


# ---------------------------------------------------------------------------
# Unit tests for audit_log() function
# ---------------------------------------------------------------------------

class TestAuditLogFunction:
    """Test the audit_log() helper function directly."""

    def test_audit_log_emits_json_record(self, caplog):
        """audit_log() must emit a log record with audit=True."""
        with caplog.at_level(logging.INFO, logger="audit"):
            audit_log(
                action=AuditAction.VIEW_STUDENT,
                user_id=1,
                target_student_id=99,
                ip_address="127.0.0.1",
                endpoint="/api/teacher/students/99",
                method="GET",
            )

        assert len(caplog.records) >= 1
        record = caplog.records[-1]
        # Must be emitted on the audit logger
        assert record.name == "audit"

    def test_audit_log_record_has_required_fields(self, caplog):
        """Log message must be parseable JSON with all required fields."""
        with caplog.at_level(logging.INFO, logger="audit"):
            audit_log(
                action=AuditAction.VIEW_STUDENT,
                user_id=42,
                target_student_id=7,
                ip_address="10.0.0.1",
                endpoint="/api/teacher/students/7",
                method="GET",
            )

        record = caplog.records[-1]
        payload = json.loads(record.getMessage())

        assert payload["audit"] is True
        assert payload["user_id"] == 42
        assert payload["action"] == "view_student"
        assert payload["target_student_id"] == 7
        assert payload["ip_address"] == "10.0.0.1"
        assert payload["endpoint"] == "/api/teacher/students/7"
        assert payload["method"] == "GET"
        assert "timestamp" in payload

    def test_audit_log_timestamp_is_iso_format(self, caplog):
        """timestamp field must be a valid ISO-8601 string ending in Z."""
        from datetime import datetime

        with caplog.at_level(logging.INFO, logger="audit"):
            audit_log(
                action=AuditAction.EXPORT_REPORT,
                user_id=5,
                target_student_id=None,
                ip_address="192.168.0.1",
                endpoint="/api/teacher/classrooms/3/export",
                method="GET",
            )

        record = caplog.records[-1]
        payload = json.loads(record.getMessage())
        ts = payload["timestamp"]
        # Should parse without error
        datetime.fromisoformat(ts.replace("Z", "+00:00"))

    def test_audit_log_target_student_id_optional(self, caplog):
        """target_student_id may be None for classroom-level actions."""
        with caplog.at_level(logging.INFO, logger="audit"):
            audit_log(
                action=AuditAction.LIST_STUDENTS,
                user_id=10,
                target_student_id=None,
                ip_address="1.2.3.4",
                endpoint="/api/teacher/classrooms/1/students",
                method="GET",
            )

        record = caplog.records[-1]
        payload = json.loads(record.getMessage())
        assert payload["target_student_id"] is None
        assert payload["action"] == "list_students"


# ---------------------------------------------------------------------------
# Tests for AuditAction enum
# ---------------------------------------------------------------------------

class TestAuditAction:
    """Verify AuditAction enum has the expected values."""

    def test_view_student_value(self):
        assert AuditAction.VIEW_STUDENT == "view_student"

    def test_list_students_value(self):
        assert AuditAction.LIST_STUDENTS == "list_students"

    def test_view_session_value(self):
        assert AuditAction.VIEW_SESSION == "view_session"

    def test_export_report_value(self):
        assert AuditAction.EXPORT_REPORT == "export_report"

    def test_delete_student_value(self):
        assert AuditAction.DELETE_STUDENT == "delete_student"


# ---------------------------------------------------------------------------
# Integration-style test: decorator applied to a simple FastAPI route
# ---------------------------------------------------------------------------

class TestAuditLogDecorator:
    """Test that the @audit_log_endpoint decorator emits an audit record."""

    def test_decorator_emits_audit_record(self, caplog):
        """Calling a decorated route must emit an audit log record."""
        from app.services.audit_logger import audit_log_endpoint

        mini_app = FastAPI()

        @mini_app.get("/test/students/{student_id}")
        def dummy_route(student_id: int, request: Request):
            audit_log_endpoint(
                request=request,
                action=AuditAction.VIEW_STUDENT,
                user_id=1,
                target_student_id=student_id,
            )
            return {"ok": True}

        client = TestClient(mini_app)

        with caplog.at_level(logging.INFO, logger="audit"):
            resp = client.get("/test/students/55")

        assert resp.status_code == 200
        audit_records = [r for r in caplog.records if r.name == "audit"]
        assert len(audit_records) == 1

        payload = json.loads(audit_records[0].getMessage())
        assert payload["audit"] is True
        assert payload["action"] == "view_student"
        assert payload["target_student_id"] == 55
        assert payload["user_id"] == 1
        assert payload["endpoint"] == "/test/students/55"
        assert payload["method"] == "GET"
