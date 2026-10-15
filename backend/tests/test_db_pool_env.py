"""Pool size per instance must be settable per environment: instances x
(pool + overflow) has to stay under the Cloud SQL connection cap
(db-g1-small 50, db-f1-micro 25) once Cloud Run scales out for a
300-player live quiz."""
import importlib
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))


def test_int_env_reads_overrides_and_falls_back(monkeypatch):
    import app.database as db
    monkeypatch.setenv("DB_POOL_SIZE", "4")
    assert db._int_env("DB_POOL_SIZE", 10) == 4
    monkeypatch.setenv("DB_POOL_SIZE", "not-a-number")
    assert db._int_env("DB_POOL_SIZE", 10) == 10
    monkeypatch.delenv("DB_POOL_SIZE")
    assert db._int_env("DB_POOL_SIZE", 10) == 10
    monkeypatch.setenv("DB_MAX_OVERFLOW", "-3")
    assert db._int_env("DB_MAX_OVERFLOW", 5) == 0


def test_postgres_engine_uses_the_env_values(monkeypatch):
    """Build the engine kwargs the same way the module does for a Postgres URL."""
    import app.database as db
    from sqlalchemy import create_engine

    monkeypatch.setenv("DB_POOL_SIZE", "4")
    monkeypatch.setenv("DB_MAX_OVERFLOW", "1")
    eng = create_engine("postgresql://u:p@localhost/x", pool_size=db._int_env("DB_POOL_SIZE", 10),
                        max_overflow=db._int_env("DB_MAX_OVERFLOW", 5))
    assert eng.pool.size() == 4 and eng.pool._max_overflow == 1
