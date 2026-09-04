"""SQLite compatibility patches for the Postgres-shaped models.

The models are written for Postgres — JSONB columns, ``::jsonb`` casts in
server defaults, partial indexes with a WHERE clause. Tests run on SQLite,
which understands none of that, so the metadata is rewritten before any table
is created.

This lives in one place on purpose. It used to be copied into both
``tests/conftest.py`` and ``specs/conftest.py``, with the second one saying it
"mirrors" the first, and the two drifted: for a JSON literal like
``'[]'::jsonb`` the tests copy substituted a SQLite-safe default while the
specs copy stripped the default outright. ``learning_sessions.full_reading_attempts``
is NOT NULL with no Python-side default, so under the specs copy every insert
that omitted it failed — and which copy won depended on which directory pytest
happened to load first.

That made failures look like they belonged to whichever test ran second. Two
runs over the same 208 files, with different subsets, produced failing sets
that did not overlap at all.
"""

import json

from sqlalchemy import JSON, text
from sqlalchemy.schema import DefaultClause
from sqlalchemy.dialects.postgresql import JSONB

from app.models import Base

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
