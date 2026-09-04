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
from test_support.sqlite_compat import _apply_sqlite_metadata_patches








# Run once at import time, before any spec test creates tables.
# One implementation, shared with tests/conftest.py. This file used to carry
# its own copy and the two drifted -- see test_support/sqlite_compat.py.
_apply_sqlite_metadata_patches()

# Re-apply before every create_all, not just at import: whichever conftest
# loads second must not find the metadata already rewritten by a different
# (or older) version of these rules.
_original_create_all = Base.metadata.create_all


def _create_all_with_sqlite_patches(*args, **kwargs):
    _apply_sqlite_metadata_patches()
    return _original_create_all(*args, **kwargs)


Base.metadata.create_all = _create_all_with_sqlite_patches


