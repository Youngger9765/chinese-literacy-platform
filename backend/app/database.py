import os

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker, Session
from typing import Generator
from .config import settings

def _int_env(name: str, default: int, lo: int, hi: int) -> int:
    """Bounded int from env. Bounds matter: SQLAlchemy reads pool_size=0 as
    "no limit", so a bad value must never fall through as 0."""
    try:
        value = int(os.environ.get(name, default))
    except (TypeError, ValueError):
        return default
    return min(hi, max(lo, value))


_engine_kwargs = {}
if settings.database_url.startswith("sqlite"):
    # SQLite refuses a connection used from a thread other than the one that
    # made it, and the app hands work to worker threads (asyncio.to_thread in
    # transcribe_reading_audio, among others). Without this the session opened
    # on the request thread raises when it is closed on the worker:
    # "SQLite objects created in a thread can only be used in that same thread".
    #
    # Postgres never reaches this branch, so production is unaffected — but the
    # test suite runs on SQLite, and the failure looked like a flaky test rather
    # than a missing engine option.
    _engine_kwargs["connect_args"] = {"check_same_thread": False}
    if settings.database_url in ("sqlite://", "sqlite:///:memory:"):
        # An in-memory DB is per-connection; a pool would hand out connections
        # to different, empty databases. StaticPool keeps one.
        from sqlalchemy.pool import StaticPool

        _engine_kwargs["poolclass"] = StaticPool
else:
    _engine_kwargs["pool_pre_ping"] = True
    # Per INSTANCE. Cloud SQL caps connections for the whole database
    # (db-g1-small: 50, db-f1-micro: 25, minus 3 reserved), so
    # instances x (pool + overflow) must stay under it. Each environment sets
    # these to match its --max-instances (2026-10-16, 300-player live-quiz
    # scale-out); the defaults are the old fixed values.
    _engine_kwargs["pool_size"] = _int_env("DB_POOL_SIZE", 10, lo=1, hi=50)
    _engine_kwargs["max_overflow"] = _int_env("DB_MAX_OVERFLOW", 5, lo=0, hi=50)
    _engine_kwargs["pool_timeout"] = 30
    _engine_kwargs["pool_recycle"] = 1800

engine = create_engine(
    settings.database_url,
    **_engine_kwargs,
)

SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


def get_db() -> Generator[Session, None, None]:
    """FastAPI dependency: yields a DB session and ensures it is closed."""
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
