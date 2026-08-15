"""The deploy must notice a database that is behind the models (#2683).

`entrypoint.sh` recovers a failed preview migration by truncating `alembic_version`,
stamping head and upgrading. `stamp head` records the database as being at head without
running anything, so a genuinely-behind schema is marked current and the container
starts clean. On 2026-08-16 that produced a preview serving 500 on every
`learning_sessions` query while staging served 200 from the same commit and a clean
local Postgres worked — and the deploy reported success throughout.

`alembic current` cannot catch it: after a stamp it truthfully reports head about a
schema that never received the migrations. So the guard compares models to the database.
"""

import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import pytest
from sqlalchemy import create_engine, text
from sqlalchemy.pool import StaticPool

from scripts.assert_schema_matches_models import missing_schema


@pytest.fixture
def engine():
    from app.models import Base

    e = create_engine("sqlite://", connect_args={"check_same_thread": False},
                      poolclass=StaticPool)
    Base.metadata.create_all(bind=e)
    yield e
    e.dispose()


def test_a_schema_built_from_the_models_reports_nothing_missing(engine):
    """The positive control. Without it, a guard that always returned [] would look
    like it was working."""
    assert missing_schema(engine) == []


def test_a_dropped_column_is_reported(engine):
    """The shape the stamp path produces: the table is there, a migration's column
    is not."""
    with engine.begin() as c:
        c.execute(text("ALTER TABLE learning_sessions DROP COLUMN full_reading_attempts"))
    problems = missing_schema(engine)
    assert any("learning_sessions.full_reading_attempts" in p for p in problems), problems


def test_a_dropped_table_is_reported(engine):
    with engine.begin() as c:
        c.execute(text("DROP TABLE reading_attempt_history"))
    assert any("reading_attempt_history" in p for p in missing_schema(engine))


def test_the_models_can_actually_build_a_postgres_schema():
    """A server_default is a SQL expression. Given the plain string "'[]'::jsonb",
    SQLAlchemy quotes it again — DEFAULT '''[]''::jsonb' — and Postgres rejects the
    CREATE TABLE outright, so `create_all` could not build these tables at all. Nobody
    noticed: production's schema comes from Alembic and every test runs on SQLite.

    Run in a SUBPROCESS, and that is the point. `conftest.py` rewrites server_default
    on the shared `Base.metadata` at import time, stripping exactly the ::jsonb casts
    this checks — so an in-process version of this test inspects a metadata object with
    the defect already erased from it, and passes whatever the models say. Verified by
    mutation: reverting the fix left the in-process version green while a plain
    `python3 -c` on the same file showed the broken DDL.
    """
    import subprocess
    import textwrap

    probe = textwrap.dedent("""
        import sys
        sys.path.insert(0, ".")
        from sqlalchemy.dialects import postgresql
        from sqlalchemy.schema import CreateTable
        from app.models import Base
        bad = []
        for name, table in Base.metadata.tables.items():
            ddl = str(CreateTable(table).compile(dialect=postgresql.dialect()))
            if "\'\'\'" in ddl:
                bad.append(name)
        print("BAD:" + ",".join(sorted(bad)))
    """)
    root = os.path.join(os.path.dirname(__file__), "..")
    out = subprocess.run([sys.executable, "-c", probe], cwd=root,
                         capture_output=True, text=True, timeout=120)
    assert out.returncode == 0, out.stderr[-800:]
    line = [l for l in out.stdout.splitlines() if l.startswith("BAD:")][-1]
    assert line == "BAD:", (
        f"these tables cannot be created on Postgres — server_default is double-quoted: "
        f"{line[4:]}"
    )


# ---------------------------------------------------------------------------
# The repair path — preview only, and run in a SUBPROCESS.
#
# Second time in this file. `conftest.py` rewrites both the column TYPES (JSONB→JSON)
# and the server_defaults on the shared `Base.metadata` at import time, so a test that
# exercises the repair in-process generates DDL from a metadata object that no longer
# resembles what the container has. It produced `DEFAULT []` — a Python list where SQL
# was needed — and the failure was in the test's own subject, not in the code.
# ---------------------------------------------------------------------------

_REPAIR_PROBE = r"""
import subprocess, sys
sys.path.insert(0, ".")
from sqlalchemy import create_engine, inspect, text as sql
from app.models import Base
from scripts.assert_schema_matches_models import missing_schema, repair

DB = "lingoleap_repair_probe"
subprocess.run(["psql","-d","postgres","-c",f"DROP DATABASE IF EXISTS {DB}"], capture_output=True)
subprocess.run(["psql","-d","postgres","-c",f"CREATE DATABASE {DB}"], capture_output=True, check=True)
engine = create_engine(f"postgresql://localhost/{DB}")
try:
    Base.metadata.create_all(bind=engine)
    assert missing_schema(engine) == [], "positive control: a fresh build is complete"

    with engine.begin() as c:
        c.execute(sql("ALTER TABLE learning_sessions DROP COLUMN full_reading_attempts"))
        c.execute(sql("DROP TABLE reading_attempt_history"))
    before = missing_schema(engine)
    assert any("full_reading_attempts" in p for p in before), before
    assert any("reading_attempt_history" in p for p in before), before

    repair(engine)
    assert missing_schema(engine) == [], "repair left something behind"

    # Usable, not merely present: a NOT NULL column added without its default breaks
    # the next INSERT rather than the next query.
    from sqlalchemy.orm import sessionmaker
    from app.models.user import User
    S = sessionmaker(bind=engine)
    db = S()
    db.add(User(email="r@example.com", name="R", password_hash="x"))
    db.commit()
    uid = db.query(User).first().id
    db.close()
    from app.models.session import LearningSession
    db = S()
    db.add(LearningSession(student_id=uid, status="in_progress"))
    db.commit()
    db.close()
    with engine.begin() as c:
        got = c.execute(sql("SELECT full_reading_attempts FROM learning_sessions")).scalar()
    assert got == [], f"default did not apply: {got!r}"
    print("REPAIR-OK")
finally:
    engine.dispose()
    subprocess.run(["psql","-d","postgres","-c",f"DROP DATABASE IF EXISTS {DB}"], capture_output=True)
"""


@pytest.mark.skipif(
    os.system("psql -d postgres -c 'SELECT 1' >/dev/null 2>&1") != 0,
    reason="no local Postgres; the repair emits Postgres DDL and SQLite cannot stand in",
)
def test_repair_puts_back_what_a_stamped_migration_skipped():
    import subprocess

    root = os.path.join(os.path.dirname(__file__), "..")
    out = subprocess.run([sys.executable, "-c", _REPAIR_PROBE], cwd=root,
                         capture_output=True, text=True, timeout=300)
    assert "REPAIR-OK" in out.stdout, (out.stdout[-500:] + "\n" + out.stderr[-1500:])


def test_the_guard_cannot_brick_a_preview_deploy(tmp_path, monkeypatch):
    """A diagnostic that can stop every preview deploying is worse than the drift it
    reports — this one did exactly that on its first two runs, before the repair path
    and this exit code existed.

    So on preview a schema that cannot be repaired is a loud warning and a zero exit;
    on staging and production it is still an abort. The repair is made to fail rather
    than assumed to: an empty database file, the obvious way to write this, turned out
    to be perfectly repairable and the test passed without reaching the branch.
    """
    from sqlalchemy import create_engine, text as sql

    from app.models import Base
    import scripts.assert_schema_matches_models as guard

    db = tmp_path / "behind.sqlite"
    engine = create_engine(f"sqlite:///{db}")
    Base.metadata.create_all(bind=engine)
    with engine.begin() as c:
        c.execute(sql("DROP TABLE reading_attempt_history"))
    engine.dispose()

    monkeypatch.setenv("DATABASE_URL", f"sqlite:///{db}")

    def _fails(_engine):
        raise RuntimeError("no permission to alter this database")

    monkeypatch.setattr(guard, "repair", _fails)

    monkeypatch.setenv("ENVIRONMENT", "preview")
    assert guard.main() == 0, "preview must start even when the schema cannot be repaired"

    monkeypatch.setenv("ENVIRONMENT", "staging")
    assert guard.main() == 1, "staging must refuse to start on a schema it cannot verify"
