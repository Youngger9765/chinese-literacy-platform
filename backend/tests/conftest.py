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


def _patch_jsonb_columns():
    """Replace JSONB column types with JSON for SQLite compatibility."""
    for table in Base.metadata.sorted_tables:
        for column in table.columns:
            if isinstance(column.type, JSONB):
                column.type = JSON()


def _patch_pg_server_defaults():
    """Remove PostgreSQL-specific server_default values (e.g. ::jsonb casts).

    SQLite cannot parse expressions like ``'{}'::jsonb``. For JSON literals,
    replace them with SQLite-safe JSON text defaults; otherwise strip the
    PostgreSQL-only default and leave Python-side defaults intact.
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
            if not isinstance(arg_text, str) and isinstance(arg, str):
                arg_text = arg
            if isinstance(arg_text, str) and "::" in arg_text:
                sqlite_default = _sqlite_json_default_from_pg_cast(arg_text)
                if sqlite_default is not None:
                    column.server_default = sqlite_default
                    continue
                column.server_default = None


def _sqlite_json_default_from_pg_cast(default_text):
    """Return a SQLite-safe JSON default for quoted JSON PostgreSQL casts."""
    literal = default_text.split("::", 1)[0].strip()
    if len(literal) < 2 or literal[0] != literal[-1] or literal[0] not in {"'", '"'}:
        return None

    quote = literal[0]
    value = literal[1:-1]
    if quote == "'":
        value = value.replace("''", "'")

    try:
        json.loads(value)
    except json.JSONDecodeError:
        return None

    return DefaultClause(value)


def _patch_pg_partial_indexes():
    """Mirror PostgreSQL partial indexes to SQLite for test DB parity."""
    for table in Base.metadata.sorted_tables:
        for index in table.indexes:
            pg_where = index.dialect_options["postgresql"].get("where")
            sqlite_where = index.dialect_options["sqlite"].get("where")
            if pg_where is not None and sqlite_where is None:
                index.dialect_options["sqlite"]["where"] = pg_where


def _apply_sqlite_metadata_patches():
    _patch_jsonb_columns()
    _patch_pg_server_defaults()
    _patch_pg_partial_indexes()


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
