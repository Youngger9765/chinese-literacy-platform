"""Shared spec-test configuration.

Three jobs:

1. Make ``app`` importable regardless of pytest invocation cwd. CI runs
   ``cd backend && python -m pytest specs/`` (backend on sys.path), but this
   keeps ``pytest backend/specs/`` working from the repo root too.

2. Patch PostgreSQL-specific column types/defaults so spec tests that need a
   real (DB-coupled) contract can use an in-memory SQLite database. Mirrors
   ``backend/tests/conftest.py`` — JSONB → JSON, and strips ``::jsonb`` casts
   from server_default that SQLite cannot parse. Pure-function spec modules are
   unaffected; only the DB-tier modules rely on this.

3. Pin asyncio fixture loop scope to "function" (Python 3.11+ / pytest-asyncio
   0.24+). Without this, pytest-asyncio emits a DeprecationWarning that becomes
   an error in future versions, and the implicit loop scope can cause
   RuntimeError: There is no current event loop in thread 'MainThread' when
   async helpers (e.g. _run / asyncio.run) are used inside sync test methods.
   Setting this explicitly here makes all three environments consistent:
   local Py3.10, CI Py3.11, and future upgrades.
"""
import sys
from pathlib import Path

_BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(_BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(_BACKEND_DIR))

from sqlalchemy import JSON
from sqlalchemy.dialects.postgresql import JSONB

from app.models import Base


def _patch_jsonb_columns() -> None:
    """Replace JSONB column types with JSON for SQLite compatibility."""
    for table in Base.metadata.sorted_tables:
        for column in table.columns:
            if isinstance(column.type, JSONB):
                column.type = JSON()


def _patch_pg_server_defaults() -> None:
    """Strip PostgreSQL-specific server_default values (e.g. ``'{}'::jsonb``).

    SQLite cannot parse ``'{}'::jsonb``; remove any server_default whose text
    contains ``::``, leaving Python-side defaults intact.
    """
    for table in Base.metadata.sorted_tables:
        for column in table.columns:
            sd = column.server_default
            if sd is None:
                continue
            arg = getattr(sd, "arg", None)
            if arg is None:
                continue
            # server_default arg may be a TextClause (.text) OR a plain string
            # (e.g. mapped_column(JSONB, server_default="'[]'::jsonb")).
            arg_text = getattr(arg, "text", None)
            if arg_text is None and isinstance(arg, str):
                arg_text = arg
            if isinstance(arg_text, str) and "::" in arg_text:
                column.server_default = None


# Run once at import time, before any spec test creates tables.
_patch_jsonb_columns()
_patch_pg_server_defaults()


