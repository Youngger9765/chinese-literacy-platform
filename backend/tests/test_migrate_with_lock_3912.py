"""Tests for Issue #3912: serialize concurrent `alembic upgrade head` startups.

On 2026-11-05 11:33, two prod Cloud Run instances started at the same
moment and both ran `alembic upgrade head` against the same Postgres
database (every instance runs migrations on startup, entrypoint.sh,
RUN_MIGRATIONS=true). One instance lost the race and hit DuplicateColumn
on `users.created_by_teacher_id` -- nothing serialized the two.

scripts/migrate_with_lock.py wraps the real `alembic upgrade head`
subprocess call in a Postgres session-scoped advisory lock
(pg_advisory_lock/pg_advisory_unlock), so concurrent instances serialize:
the loser blocks on the lock until the winner finishes and releases, then
runs `alembic upgrade head` itself -- a safe no-op by then.

This suite does not require a live Postgres: it asserts the SCRIPT's own
control-flow correctness (the property that actually matters here --
Postgres itself guarantees pg_advisory_lock blocks correctly, that's not
what could regress in this file) via a mocked SQLAlchemy engine/connection
and a mocked subprocess.run:
  1. The lock is acquired BEFORE alembic runs.
  2. The lock is released AFTER alembic runs, on success.
  3. The lock is released even when alembic's subprocess fails (exit != 0)
     -- a crashed migration must not leave the lock held forever.
  4. The lock is released even when the subprocess call itself raises.
  5. The script's own exit code mirrors alembic's subprocess exit code
     (entrypoint.sh's `if ! python3 scripts/migrate_with_lock.py; then`
     depends on this to preserve its existing error-handling branches).
  6. No DB connection is attempted at all when DATABASE_URL is unset.

TDD phases:
  RED  -> written against a stub `main()` that just runs alembic with no
          locking at all (the pre-fix shape); every ordering/release
          assertion here fails.
  GREEN -> passes against scripts/migrate_with_lock.py as implemented.

Run with:
    cd backend && python -m pytest tests/test_migrate_with_lock_3912.py -v
"""

import os
import sys
from unittest.mock import MagicMock, patch

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))


def _load_module():
    """Import scripts/migrate_with_lock.py as a module (scripts/ has no
    package __init__ import path set up for `from scripts import ...`
    elsewhere in this repo's test suite, so load it the same way
    assert_schema_matches_models.py's own callers do: by path)."""
    import importlib.util

    path = os.path.join(os.path.dirname(__file__), "..", "scripts", "migrate_with_lock.py")
    spec = importlib.util.spec_from_file_location("migrate_with_lock", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def _mock_engine(call_order: list[str]):
    """Build a MagicMock SQLAlchemy engine whose connection records
    pg_advisory_lock / pg_advisory_unlock calls (by inspecting the SQL
    text) into `call_order`, in the order they actually happen."""
    mock_engine = MagicMock()
    mock_conn = MagicMock()
    mock_conn.execution_options.return_value = mock_conn

    def _execute(clause, *args, **kwargs):
        sql = str(clause)
        if "advisory_unlock" in sql:
            call_order.append("unlock")
        elif "advisory_lock" in sql:
            call_order.append("lock")
        return MagicMock()

    mock_conn.execute.side_effect = _execute

    mock_conn_cm = MagicMock()
    mock_conn_cm.__enter__.return_value = mock_conn
    mock_conn_cm.__exit__.return_value = False
    mock_engine.connect.return_value = mock_conn_cm
    return mock_engine, mock_conn


class TestMigrateWithLockOrdering:
    def test_lock_acquired_before_alembic_and_released_after_on_success(self):
        call_order: list[str] = []
        mock_engine, _ = _mock_engine(call_order)

        with patch.dict(os.environ, {"DATABASE_URL": "postgresql://fake/db"}), \
                patch("sqlalchemy.create_engine", return_value=mock_engine), \
                patch("subprocess.run") as mock_run:
            mock_run.return_value = MagicMock(returncode=0)
            mock_run.side_effect = lambda *a, **k: (call_order.append("alembic"), mock_run.return_value)[1]

            module = _load_module()
            exit_code = module.main()

        assert exit_code == 0
        assert call_order == ["lock", "alembic", "unlock"], (
            f"expected lock -> alembic -> unlock in that order, got {call_order}"
        )

    def test_lock_released_even_when_alembic_exits_nonzero(self):
        call_order: list[str] = []
        mock_engine, _ = _mock_engine(call_order)

        with patch.dict(os.environ, {"DATABASE_URL": "postgresql://fake/db"}), \
                patch("sqlalchemy.create_engine", return_value=mock_engine), \
                patch("subprocess.run") as mock_run:
            mock_run.return_value = MagicMock(returncode=1)
            mock_run.side_effect = lambda *a, **k: (call_order.append("alembic"), mock_run.return_value)[1]

            module = _load_module()
            exit_code = module.main()

        assert exit_code == 1, "the script's exit code must mirror alembic's own failing exit code"
        assert "unlock" in call_order, (
            "a failed alembic run must still release the advisory lock -- "
            "otherwise a crashed migration wedges every other instance forever"
        )
        assert call_order.index("unlock") > call_order.index("alembic"), (
            "unlock must happen AFTER the (failed) alembic attempt, not before"
        )

    def test_lock_released_even_when_subprocess_raises(self):
        call_order: list[str] = []
        mock_engine, _ = _mock_engine(call_order)

        with patch.dict(os.environ, {"DATABASE_URL": "postgresql://fake/db"}), \
                patch("sqlalchemy.create_engine", return_value=mock_engine), \
                patch("subprocess.run", side_effect=OSError("alembic binary not found")):
            module = _load_module()
            try:
                module.main()
            except OSError:
                pass  # the script is allowed to propagate -- entrypoint.sh's `set -e` catches it

        assert "lock" in call_order
        assert "unlock" in call_order, (
            "the lock must be released via `finally` even when the subprocess "
            "call itself raises, not just when it returns a failing exit code"
        )

    def test_missing_database_url_takes_no_lock_and_no_connection(self):
        with patch.dict(os.environ, {}, clear=True), \
                patch("sqlalchemy.create_engine") as mock_create_engine:
            module = _load_module()
            exit_code = module.main()

        assert exit_code == 1
        mock_create_engine.assert_not_called()
