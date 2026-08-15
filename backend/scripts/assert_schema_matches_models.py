#!/usr/bin/env python3
"""Fail the deploy if the database is missing anything the models declare.

WHY
---
`entrypoint.sh` has a recovery path for the shared preview database (#1477): when
`alembic upgrade head` fails, it truncates `alembic_version`, runs `alembic stamp head`,
and upgrades again. `stamp head` records the database as being AT head without running
a single migration — which is right when the only problem was stale revision rows left
by another PR branch, and wrong when the schema is genuinely behind. In that case the
container starts, reports success, and serves.

That is what it looked like on 2026-08-16. `GET /api/learning/sessions` returned 500 on
preview and 200 on staging from the same commit; a clean local Postgres built from the
models served it fine. The code was not the difference — the database was, and nothing
in the deploy said so. The failure surfaced as a broken page days later.

`alembic current` cannot catch this: after a stamp it reports head, truthfully, about a
schema that never received the migrations. So this compares the models against what is
actually in the database.

WHAT IT CHECKS
--------------
Every table and column declared in `Base.metadata` exists. Not types, not constraints,
not extra columns the database has and the models do not — a drifted-behind schema
shows up as something MISSING, and widening the check to differences that are routinely
harmless would make it noisy enough to be ignored.

Usage:  python3 scripts/assert_schema_matches_models.py
Exit:   0 when the schema covers the models, 1 with the list of what is missing.
"""

from __future__ import annotations

import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))


def missing_schema(engine) -> list[str]:
    """Tables and columns the models declare that the database does not have."""
    from sqlalchemy import inspect

    from app.models import Base

    inspector = inspect(engine)
    present_tables = set(inspector.get_table_names())
    problems: list[str] = []

    for name, table in sorted(Base.metadata.tables.items()):
        if name not in present_tables:
            problems.append(f"table missing: {name}")
            continue
        have = {c["name"] for c in inspector.get_columns(name)}
        for column in table.columns:
            if column.name not in have:
                problems.append(f"column missing: {name}.{column.name}")
    return problems


def main() -> int:
    url = os.environ.get("DATABASE_URL")
    if not url:
        print("DATABASE_URL is unset — nothing to check.")
        return 0

    from sqlalchemy import create_engine

    engine = create_engine(url)
    try:
        problems = missing_schema(engine)
    finally:
        engine.dispose()

    if not problems:
        print("Schema check: database covers every table and column the models declare.")
        return 0

    print("Schema check FAILED — the database is behind the models.", file=sys.stderr)
    print(
        "  A migration did not reach this database. On preview this is usually the "
        "`alembic stamp head` recovery path marking a genuinely-behind schema as "
        "up to date; the service would start and then 500 on the affected tables.",
        file=sys.stderr,
    )
    for p in problems[:40]:
        print(f"    {p}", file=sys.stderr)
    if len(problems) > 40:
        print(f"    … and {len(problems) - 40} more", file=sys.stderr)
    return 1


if __name__ == "__main__":
    sys.exit(main())
