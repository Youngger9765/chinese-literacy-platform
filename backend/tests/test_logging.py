"""
Tests for the request logging middleware and structured logging config.

TDD: Red -> Green -> Refactor

These tests verify:
1. Every HTTP request emits a structured log record.
2. The log record contains required fields: request_id, method, path,
   status_code, duration_ms.
3. Unhandled exceptions are caught by the middleware and return HTTP 500
   with a request_id in the response body.
4. The logging_config module sets up the root logger correctly.
"""

import logging
import uuid
from unittest.mock import patch, MagicMock

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.utils.logging_config import setup_logging, get_logger
from app.main import RequestLoggingMiddleware


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _make_test_app() -> tuple[FastAPI, TestClient]:
    """Return a minimal FastAPI app with the logging middleware attached."""
    app = FastAPI()
    app.add_middleware(RequestLoggingMiddleware)

    @app.get("/ok")
    def ok_route():
        return {"status": "ok"}

    @app.get("/error")
    def error_route():
        raise RuntimeError("boom")

    return app, TestClient(app, raise_server_exceptions=False)


# ---------------------------------------------------------------------------
# 1. Middleware — happy path
# ---------------------------------------------------------------------------

class TestRequestLoggingMiddlewareHappyPath:
    """Middleware logs structured fields on successful requests."""

    def test_successful_request_is_logged(self):
        """A 200 response triggers an INFO log with required structured fields."""
        _, client = _make_test_app()
        captured: list[logging.LogRecord] = []

        class CapturingHandler(logging.Handler):
            def emit(self, record: logging.LogRecord) -> None:
                captured.append(record)

        handler = CapturingHandler()
        # Attach to root logger AND set its level to INFO so records propagate.
        root = logging.getLogger()
        original_level = root.level
        root.setLevel(logging.DEBUG)
        root.addHandler(handler)
        try:
            response = client.get("/ok")
        finally:
            root.removeHandler(handler)
            root.setLevel(original_level)

        assert response.status_code == 200

        # At least one log record for the request
        assert captured, "Expected at least one log record"

        # Find the request log (has 'path' in extra)
        request_logs = [r for r in captured if hasattr(r, "path")]
        assert request_logs, "No log record with 'path' field found"

        record = request_logs[0]
        assert record.path == "/ok"
        assert record.method == "GET"
        assert record.status_code == 200
        assert isinstance(record.duration_ms, float)
        assert record.duration_ms >= 0

        # request_id must be a valid UUID
        request_id = record.request_id
        try:
            uuid.UUID(request_id)
        except ValueError:
            pytest.fail(f"request_id is not a valid UUID: {request_id!r}")

    def test_response_includes_no_request_id_header(self):
        """We don't leak the internal request_id in response headers."""
        _, client = _make_test_app()
        response = client.get("/ok")
        assert "x-request-id" not in response.headers


# ---------------------------------------------------------------------------
# 2. Middleware — error handling
# ---------------------------------------------------------------------------

class TestRequestLoggingMiddlewareErrors:
    """Middleware catches unhandled exceptions and returns 500."""

    def test_unhandled_exception_returns_500(self):
        """Middleware converts unhandled RuntimeError into HTTP 500."""
        _, client = _make_test_app()
        response = client.get("/error")
        assert response.status_code == 500

    def test_500_response_contains_request_id(self):
        """The 500 JSON body contains a request_id for correlation."""
        _, client = _make_test_app()
        response = client.get("/error")
        body = response.json()
        assert "request_id" in body
        try:
            uuid.UUID(body["request_id"])
        except ValueError:
            pytest.fail(f"request_id in 500 response is not a valid UUID: {body['request_id']!r}")

    def test_unhandled_exception_is_logged_as_error(self):
        """Unhandled exceptions are logged at ERROR level with 'path' field."""
        _, client = _make_test_app()
        captured: list[logging.LogRecord] = []

        class CapturingHandler(logging.Handler):
            def emit(self, record: logging.LogRecord) -> None:
                captured.append(record)

        handler = CapturingHandler()
        root = logging.getLogger()
        root.addHandler(handler)
        try:
            client.get("/error")
        finally:
            root.removeHandler(handler)

        error_logs = [
            r for r in captured
            if r.levelno == logging.ERROR and hasattr(r, "path")
        ]
        assert error_logs, "Expected an ERROR-level log record with 'path' field"
        record = error_logs[0]
        assert record.path == "/error"


# ---------------------------------------------------------------------------
# 3. Middleware — 4xx responses logged at WARNING
# ---------------------------------------------------------------------------

class TestRequestLoggingMiddleware4xx:
    """4xx responses are logged at WARNING level."""

    def test_404_is_logged_at_warning(self):
        """A 404 response is logged at WARNING (not INFO)."""
        _, client = _make_test_app()
        captured: list[logging.LogRecord] = []

        class CapturingHandler(logging.Handler):
            def emit(self, record: logging.LogRecord) -> None:
                captured.append(record)

        handler = CapturingHandler()
        root = logging.getLogger()
        root.addHandler(handler)
        try:
            client.get("/nonexistent")
        finally:
            root.removeHandler(handler)

        warning_logs = [
            r for r in captured
            if r.levelno >= logging.WARNING and hasattr(r, "status_code") and r.status_code == 404
        ]
        assert warning_logs, "Expected a WARNING log for 404 response"


# ---------------------------------------------------------------------------
# 4. logging_config module
# ---------------------------------------------------------------------------

class TestLoggingConfig:
    """setup_logging() configures the root logger correctly."""

    def test_get_logger_returns_logger(self):
        """get_logger returns a proper logging.Logger instance."""
        logger = get_logger("test_module")
        assert isinstance(logger, logging.Logger)
        assert logger.name == "test_module"

    def test_setup_logging_development_does_not_raise(self):
        """setup_logging() in development environment does not raise."""
        with patch.dict("os.environ", {"ENVIRONMENT": "development"}):
            # Should not raise
            setup_logging()

    def test_setup_logging_production_installs_handler(self):
        """setup_logging() in production installs at least one StreamHandler."""
        root = logging.getLogger()
        original_handlers = root.handlers[:]
        try:
            with patch.dict("os.environ", {"ENVIRONMENT": "production"}):
                setup_logging()
            assert root.handlers, "Expected at least one handler after setup_logging()"
            assert any(isinstance(h, logging.StreamHandler) for h in root.handlers)
        finally:
            root.handlers = original_handlers
