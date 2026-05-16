"""
Structured JSON logging configuration for LingoLeap backend.

Configures Python logging with JSON formatter so that Cloud Logging
can parse structured fields (request_id, user_id, endpoint, duration, etc.)
as first-class log metadata.

Every structured log entry emits an ``env`` field sourced from the ENVIRONMENT
env var (values: production | staging | preview | development).  This lets
Cloud Logging filter queries distinguish noise from different environments:

    jsonPayload.env="staging"
    jsonPayload.env="production"

JSON logging is enabled for production, staging, and preview environments so
that Cloud Run log entries from all three are machine-parseable.  Local
development falls back to a human-readable format.
"""

import logging
import os

# pythonjsonlogger is available via python-json-logger package.
# The module was moved to pythonjsonlogger.json in newer releases; fall back
# to the legacy location for older installs.
try:
    from pythonjsonlogger import json as jsonlogger  # type: ignore[attr-defined]
except ImportError:
    from pythonjsonlogger import jsonlogger  # type: ignore[no-redef]

# ---------------------------------------------------------------------------
# EnvFilter — injects ``env`` into every LogRecord so the JSON formatter can
# emit it as a top-level field.  This is simpler than subclassing the formatter
# because it works transparently with any handler attached to the root logger.
# ---------------------------------------------------------------------------

class _EnvFilter(logging.Filter):
    """Attach the current ENVIRONMENT value to every log record."""

    def __init__(self, env: str) -> None:
        super().__init__()
        self._env = env

    def filter(self, record: logging.LogRecord) -> bool:  # noqa: A003
        record.env = self._env  # type: ignore[attr-defined]
        return True


def setup_logging() -> None:
    """Configure root logger with JSON formatter.

    JSON mode is used for production, staging, and preview so that Cloud Logging
    can parse structured fields.  Local development (ENVIRONMENT unset or
    'development') falls back to human-readable output.
    """
    environment = os.environ.get("ENVIRONMENT", "development")

    if environment in ("production", "staging", "preview"):
        _configure_json_logging(environment)
    else:
        _configure_development_logging()


def _configure_json_logging(environment: str) -> None:
    """Structured JSON output — used in Cloud Run (production / staging / preview)."""
    handler = logging.StreamHandler()

    # Cloud Logging picks up 'severity' as the log level field.
    # %(env)s is injected by _EnvFilter so it appears as a top-level JSON key.
    formatter = jsonlogger.JsonFormatter(
        fmt="%(asctime)s %(name)s %(levelname)s %(env)s %(message)s",
        rename_fields={"levelname": "severity", "asctime": "timestamp"},
        datefmt="%Y-%m-%dT%H:%M:%S",
    )
    handler.setFormatter(formatter)
    handler.addFilter(_EnvFilter(environment))

    root_logger = logging.getLogger()
    root_logger.setLevel(logging.INFO)
    # Remove any handlers that may have been added by uvicorn before setup_logging runs
    root_logger.handlers.clear()
    root_logger.addHandler(handler)

    # Silence noisy third-party libraries
    logging.getLogger("google.auth").setLevel(logging.WARNING)
    logging.getLogger("urllib3").setLevel(logging.WARNING)
    logging.getLogger("httpx").setLevel(logging.WARNING)


def _configure_development_logging() -> None:
    """Human-readable output for local development."""
    logging.basicConfig(
        level=logging.DEBUG,
        format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
        datefmt="%H:%M:%S",
    )
    # Silence noisy libraries in dev too
    logging.getLogger("google.auth").setLevel(logging.WARNING)
    logging.getLogger("urllib3").setLevel(logging.WARNING)
    logging.getLogger("httpx").setLevel(logging.WARNING)


def get_logger(name: str) -> logging.Logger:
    """Convenience wrapper — returns a named logger.

    Usage:
        from app.utils.logging_config import get_logger
        logger = get_logger(__name__)
    """
    return logging.getLogger(name)
