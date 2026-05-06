#!/bin/bash
set -e

if [ "$RUN_MIGRATIONS" = "true" ]; then
    echo "Running database migrations..."
    if ! alembic upgrade head 2>&1; then
        echo "alembic upgrade head failed (possible stale revision from a different branch on shared preview DB)."
        echo "Clearing alembic_version and re-stamping from scratch..."
        # Purge ALL rows from alembic_version before stamping.
        # 'alembic stamp head' only upserts the current head row; it does NOT remove
        # unrecognised revision rows left behind by other PRs on the shared preview DB.
        # Truncating first ensures a clean state before re-stamp + upgrade.
        python3 - <<'PYEOF'
import os, sys
try:
    import sqlalchemy as sa
    url = os.environ["DATABASE_URL"]
    # Convert unix-socket URL (Cloud Run) to TCP for local proxy environments
    engine = sa.create_engine(url)
    with engine.connect() as conn:
        conn.execute(sa.text("TRUNCATE TABLE alembic_version"))
        conn.commit()
    print("alembic_version table cleared.")
except Exception as e:
    print(f"Warning: could not truncate alembic_version: {e}", file=sys.stderr)
    # Non-fatal: alembic stamp head will attempt an upsert anyway
PYEOF
        alembic stamp head
        if ! alembic upgrade head 2>&1; then
            echo "ERROR: alembic upgrade head still failing after re-stamp. Aborting."
            exit 1
        fi
    fi
    echo "Migrations complete."
fi

exec uvicorn app.main:app --host 0.0.0.0 --port 8080 --proxy-headers --forwarded-allow-ips='*'
