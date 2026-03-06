"""
Shared test configuration.

Patches PostgreSQL-specific column types (JSONB) to SQLite-compatible types (JSON)
before table creation, so all tests can use SQLite in-memory databases.
"""
import sys
import os

# Allow running pytest from the repo root or from backend/
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from sqlalchemy import JSON
from sqlalchemy.dialects.postgresql import JSONB
from app.models import Base


def _patch_jsonb_columns():
    """Replace JSONB column types with JSON for SQLite compatibility."""
    for table in Base.metadata.sorted_tables:
        for column in table.columns:
            if isinstance(column.type, JSONB):
                column.type = JSON()


# Run once at import time, before any test creates tables.
_patch_jsonb_columns()


def pytest_runtest_setup(item):
    """Reset the rate limiter before each test (including module-scoped fixtures).

    Using a hook instead of a fixture ensures the reset happens before
    module-scoped fixtures that call /api/auth/register.
    """
    from app.routes.auth import rate_limiter
    rate_limiter.reset()
