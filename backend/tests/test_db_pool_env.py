"""Pool size per instance must be settable per environment (instances x
(pool + overflow) has to stay under the Cloud SQL connection cap), and a bad
value must never turn into "unlimited": SQLAlchemy reads pool_size=0 as no
limit (commit security review 2026-10-16)."""
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))


def test_reads_override(monkeypatch):
    import app.database as db
    monkeypatch.setenv("DB_POOL_SIZE", "4")
    assert db._int_env("DB_POOL_SIZE", 10, lo=1, hi=50) == 4


def test_bad_or_missing_value_falls_back(monkeypatch):
    import app.database as db
    monkeypatch.setenv("DB_POOL_SIZE", "not-a-number")
    assert db._int_env("DB_POOL_SIZE", 10, lo=1, hi=50) == 10
    monkeypatch.delenv("DB_POOL_SIZE")
    assert db._int_env("DB_POOL_SIZE", 10, lo=1, hi=50) == 10


def test_pool_size_zero_or_negative_is_never_unlimited(monkeypatch):
    import app.database as db
    for v in ("0", "-3"):
        monkeypatch.setenv("DB_POOL_SIZE", v)
        assert db._int_env("DB_POOL_SIZE", 10, lo=1, hi=50) == 1


def test_huge_value_is_capped(monkeypatch):
    import app.database as db
    monkeypatch.setenv("DB_MAX_OVERFLOW", "100000")
    assert db._int_env("DB_MAX_OVERFLOW", 5, lo=0, hi=50) == 50
