"""
Shared test configuration.

Patches PostgreSQL-specific column types (JSONB) to SQLite-compatible types (JSON)
before table creation, so all tests can use SQLite in-memory databases.

Also patches server_default values that contain PostgreSQL-specific syntax (::jsonb casts)
which SQLite cannot parse.
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


def _patch_pg_server_defaults():
    """Remove PostgreSQL-specific server_default values (e.g. ::jsonb casts).

    SQLite cannot parse expressions like ``'{}'::jsonb``, so we strip any
    server_default whose text contains '::', leaving Python-side defaults intact.
    """
    for table in Base.metadata.sorted_tables:
        for column in table.columns:
            sd = column.server_default
            if sd is None:
                continue
            # server_default is a DefaultClause; its .arg may be a text() object
            arg = getattr(sd, "arg", None)
            if arg is None:
                continue
            arg_text = getattr(arg, "text", None)
            if isinstance(arg_text, str) and "::" in arg_text:
                column.server_default = None


# Run once at import time, before any test creates tables.
_patch_jsonb_columns()
_patch_pg_server_defaults()


def pytest_runtest_setup(item):
    """Reset rate limiters before each test (including module-scoped fixtures).

    Using a hook instead of a fixture ensures the reset happens before
    module-scoped fixtures that call /api/auth/register.
    """
    from app.routes.auth import rate_limiter
    rate_limiter.reset()
    # Also reset the global per-IP rate limiter so tests don't hit 429
    try:
        from app.auth.rate_limiter import general_rate_limiter
        general_rate_limiter.reset()
    except (ImportError, AttributeError):
        pass
