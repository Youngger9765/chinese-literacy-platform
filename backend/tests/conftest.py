import os as _os
import sys as _sys
# 讓 `from _module_files import ...` 在任何 rootdir 下都找得到（#2916）。
# tests/ 不是 package，pytest 的 rootdir 會變，靠相對 import 不穩。
_sys.path.insert(0, _os.path.dirname(_os.path.abspath(__file__)))

"""
Shared test configuration.

Patches PostgreSQL-specific column types (JSONB) to SQLite-compatible types (JSON)
before table creation, so all tests can use SQLite in-memory databases.

Also patches server_default values that contain PostgreSQL-specific syntax (::jsonb casts)
which SQLite cannot parse, and mirrors PostgreSQL partial-index predicates to
SQLite partial indexes.
"""
import json
import sys
import os

# Allow running pytest from the repo root or from backend/
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from sqlalchemy import JSON
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.schema import DefaultClause
from app.models import Base
# One implementation, shared with specs/conftest.py — see that module's docstring
# for what happened when there were two.
from test_support.sqlite_compat import _apply_sqlite_metadata_patches


_original_create_all = Base.metadata.create_all


def _create_all_with_sqlite_patches(*args, **kwargs):
    _apply_sqlite_metadata_patches()
    return _original_create_all(*args, **kwargs)


Base.metadata.create_all = _create_all_with_sqlite_patches

# Run once at import time, before any test creates tables.
_apply_sqlite_metadata_patches()


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
    try:
        from app.routes.classrooms.classroom_crud import join_preview_rate_limiter
        join_preview_rate_limiter.reset()
    except (ImportError, AttributeError):
        pass
