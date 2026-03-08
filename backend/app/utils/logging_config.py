"""
Structured JSON logging configuration for LingoLeap backend.

Configures Python logging with JSON formatter so that Cloud Logging
can parse structured fields (request_id, user_id, endpoint, duration, etc.)
as first-class log metadata.
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


def setup_logging() -> None:
    """Configure root logger with JSON formatter.

    In development (ENVIRONMENT != 'production'), falls back to a
    human-readable format so local terminal output stays readable.
    """
    environment = os.environ.get("ENVIRONMENT", "development")

    if environment == "production":
        _configure_json_logging()
    else:
        _configure_development_logging()


def _configure_json_logging() -> None:
    """Structured JSON output — used in Cloud Run production."""
    handler = logging.StreamHandler()

    # Cloud Logging picks up 'severity' as the log level field.
    # Include standard structured fields that every log entry should carry.
    formatter = jsonlogger.JsonFormatter(
        fmt="%(asctime)s %(name)s %(levelname)s %(message)s",
        rename_fields={"levelname": "severity", "asctime": "timestamp"},
        datefmt="%Y-%m-%dT%H:%M:%S",
    )
    handler.setFormatter(formatter)

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
