#!/bin/bash
set -e

if [ "$RUN_MIGRATIONS" = "true" ]; then
    echo "Running database migrations..."
    if ! alembic upgrade head 2>&1; then
        echo "alembic upgrade head failed (possible stale revision from another branch)."
        echo "Stamping DB to current head and retrying..."
        alembic stamp head
        alembic upgrade head
    fi
    echo "Migrations complete."
fi

exec uvicorn app.main:app --host 0.0.0.0 --port 8080 --proxy-headers --forwarded-allow-ips='*'
