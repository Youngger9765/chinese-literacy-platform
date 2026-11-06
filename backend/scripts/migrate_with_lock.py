#!/usr/bin/env python3
"""Run `alembic upgrade head` while holding a Postgres advisory lock.

WHY
---
`entrypoint.sh` runs `alembic upgrade head` on every container startup when
RUN_MIGRATIONS=true -- which is every instance, every deploy, every
scale-up. On 2026-11-05 11:33, two prod instances started at the same
moment and both ran `alembic upgrade head` concurrently against the same
Postgres database: one added `users.created_by_teacher_id`, the other hit
the same ADD COLUMN a few milliseconds later and failed with
DuplicateColumn, firing the error alert. Nothing serialized them -- two
processes racing the identical DDL statement is exactly what Postgres
itself cannot make safe on its own.

WHAT THIS DOES
--------------
Acquires a single, fixed-key Postgres advisory lock (`pg_advisory_lock`,
session-scoped -- blocks the calling process until it can acquire) before
running `alembic upgrade head` as a subprocess, and releases it
(`pg_advisory_unlock`) when that subprocess exits, success or failure.

Two instances starting at the same moment now serialize: whichever gets
the lock first runs the real migration and commits it; the other blocks
until the lock is released, then runs `alembic upgrade head` itself --
which alembic itself makes a safe no-op, since `alembic_version` already
reads "head" by the time it gets to run.

The advisory lock is intentionally NOT `pg_advisory_xact_lock` (the
transaction-scoped variant): alembic's own migrations commit in their own
transaction(s), and a lock that auto-released at the first commit would
stop protecting the remaining migrations in the same `upgrade head` run.
Session-scoped `pg_advisory_lock` stays held for this whole process's
single DB connection, independent of whatever alembic itself commits on
its own, separate connection.

Usage: python3 scripts/migrate_with_lock.py
Exit: alembic's own exit code (0 on success), or 1 if DATABASE_URL is unset.
"""
from __future__ import annotations

import os
import subprocess
import sys

# Arbitrary fixed int64 advisory-lock key. Only needs to be a constant unique
# to this specific lock's purpose within this database -- nothing else in
# this repo currently takes a Postgres advisory lock (grepped before
# picking this), so collision is not a present concern. Chosen as a
# recognizable, non-random constant rather than e.g. a hash, so a DBA
# reading `SELECT * FROM pg_locks WHERE locktype = 'advisory'` during an
# incident can grep this file for the exact number.
MIGRATION_LOCK_KEY = 391239120


def main() -> int:
    database_url = os.environ.get("DATABASE_URL")
    if not database_url:
        print("DATABASE_URL is unset -- cannot take the migration advisory lock.", file=sys.stderr)
        return 1

    import sqlalchemy as sa

    engine = sa.create_engine(database_url)
    with engine.connect() as conn:
        # AUTOCOMMIT: pg_advisory_lock/unlock take effect immediately on
        # this connection's own session regardless of any surrounding
        # transaction state -- autocommit just keeps that explicit instead
        # of relying on default driver behavior.
        conn = conn.execution_options(isolation_level="AUTOCOMMIT")

        print(f"Waiting for migration advisory lock ({MIGRATION_LOCK_KEY})...", flush=True)
        conn.execute(sa.text("SELECT pg_advisory_lock(:key)"), {"key": MIGRATION_LOCK_KEY})
        print("Migration advisory lock acquired -- running alembic upgrade head.", flush=True)
        try:
            result = subprocess.run(["alembic", "upgrade", "head"])
            return result.returncode
        finally:
            conn.execute(sa.text("SELECT pg_advisory_unlock(:key)"), {"key": MIGRATION_LOCK_KEY})
            print("Migration advisory lock released.", flush=True)


if __name__ == "__main__":
    sys.exit(main())
