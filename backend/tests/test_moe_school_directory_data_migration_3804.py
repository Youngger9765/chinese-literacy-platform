"""TDD RED tests for the MOE school directory DATA migration (#3804 §4.2
follow-up — staging had the schema but zero imported rows because nothing
in the deploy pipeline ran scripts/import_moe_schools.py).

Written BEFORE the migration file exists — confirms failure (file not
found) first, then exercises upgrade()/downgrade() in isolation using
alembic's documented `Operations.context(migration_context)` pattern
(https://alembic.sqlalchemy.org/en/latest/cookbook.html — running a
migration's op calls outside the full `alembic upgrade` CLI).
"""
import importlib.util
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import pytest
from alembic.migration import MigrationContext
from alembic.operations import Operations
from sqlalchemy import create_engine, event
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.models import Base
from app.models.school import Classroom, School
from app.models.user import Role, User, UserRole

MIGRATIONS_DIR = os.path.join(os.path.dirname(__file__), "..", "alembic", "versions")
REVISION_PREFIX = "b2c3d4moe02"


def _load_migration_module():
    """Dynamically import the revision file by its revision-id prefix — the
    same mechanism alembic's own ScriptDirectory uses to load a revision."""
    matches = [
        f for f in os.listdir(MIGRATIONS_DIR) if f.startswith(REVISION_PREFIX) and f.endswith(".py")
    ]
    assert len(matches) == 1, (
        f"expected exactly 1 migration file starting with {REVISION_PREFIX!r}, found {matches}"
    )
    path = os.path.join(MIGRATIONS_DIR, matches[0])
    spec = importlib.util.spec_from_file_location(f"migration_{REVISION_PREFIX}", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def _run(engine, fn_name: str, module) -> None:
    connection = engine.connect()
    context = MigrationContext.configure(connection)
    with Operations.context(context):
        getattr(module, fn_name)()
    connection.commit()
    connection.close()


@pytest.fixture()
def engine():
    eng = create_engine(
        "sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool
    )

    @event.listens_for(eng, "connect")
    def _set_sqlite_pragma(dbapi_connection, connection_record):
        cursor = dbapi_connection.cursor()
        cursor.execute("PRAGMA foreign_keys=ON")
        cursor.close()

    Base.metadata.create_all(bind=eng)  # conftest.py patches this for sqlite compat
    yield eng
    Base.metadata.drop_all(bind=eng)


@pytest.fixture()
def session_factory(engine):
    return sessionmaker(bind=engine)


class TestMoeSchoolDirectoryDataMigrationUpgrade:
    def test_upgrade_against_empty_db_imports_all_rows(self, engine, session_factory):
        module = _load_migration_module()
        _run(engine, "upgrade", module)

        session = session_factory()
        count = session.query(School).filter(School.moe_school_code.isnot(None)).count()
        session.close()
        assert count == 3855

    def test_upgrade_is_idempotent_on_rerun(self, engine, session_factory):
        module = _load_migration_module()
        _run(engine, "upgrade", module)
        _run(engine, "upgrade", module)  # simulate a retried/rerun deploy

        session = session_factory()
        count = session.query(School).filter(School.moe_school_code.isnot(None)).count()
        total_schools = session.query(School).count()
        session.close()
        assert count == 3855
        assert total_schools == 3855  # no duplicates created on rerun

    def test_upgrade_never_touches_pre_existing_non_moe_school(self, engine, session_factory):
        session = session_factory()
        legacy = School(name="某老師自建學校")
        session.add(legacy)
        session.commit()
        legacy_id = legacy.id
        session.close()

        module = _load_migration_module()
        _run(engine, "upgrade", module)

        session = session_factory()
        reloaded = session.query(School).filter(School.id == legacy_id).one()
        session.close()
        assert reloaded.name == "某老師自建學校"
        assert reloaded.moe_school_code is None


class TestMoeSchoolDirectoryDataMigrationDowngrade:
    def test_downgrade_removes_all_unreferenced_moe_schools(self, engine, session_factory):
        module = _load_migration_module()
        _run(engine, "upgrade", module)
        _run(engine, "downgrade", module)

        session = session_factory()
        count = session.query(School).filter(School.moe_school_code.isnot(None)).count()
        session.close()
        assert count == 0

    def test_downgrade_keeps_a_moe_school_referenced_by_a_classroom(self, engine, session_factory):
        module = _load_migration_module()
        _run(engine, "upgrade", module)

        session = session_factory()
        role = Role(name="teacher", display_name="Teacher", scope_level="school")
        session.add(role)
        user = User(email="teacher-classroom@example.com", password_hash="x", name="T")
        session.add(user)
        session.commit()

        protected_school = session.query(School).filter(School.moe_school_code.isnot(None)).first()
        protected_id = protected_school.id
        session.add(Classroom(school_id=protected_id, teacher_id=user.id, name="Test Class"))
        session.commit()
        session.close()

        _run(engine, "downgrade", module)

        session = session_factory()
        still_there = session.query(School).filter(School.id == protected_id).first()
        remaining = session.query(School).filter(School.moe_school_code.isnot(None)).count()
        session.close()

        assert still_there is not None, "a MOE school referenced by a real classroom must survive downgrade"
        assert remaining == 1

    def test_downgrade_keeps_a_moe_school_referenced_by_a_teacher_role(self, engine, session_factory):
        module = _load_migration_module()
        _run(engine, "upgrade", module)

        session = session_factory()
        role = Role(name="teacher", display_name="Teacher", scope_level="school")
        session.add(role)
        user = User(email="teacher-role@example.com", password_hash="x", name="T2")
        session.add(user)
        session.commit()

        protected_school = session.query(School).filter(School.moe_school_code.isnot(None)).first()
        protected_id = protected_school.id
        session.add(
            UserRole(user_id=user.id, role_id=role.id, scope_type="school", scope_id=str(protected_id))
        )
        session.commit()
        session.close()

        _run(engine, "downgrade", module)

        session = session_factory()
        still_there = session.query(School).filter(School.id == protected_id).first()
        remaining = session.query(School).filter(School.moe_school_code.isnot(None)).count()
        session.close()

        assert still_there is not None, "a MOE school referenced by a teacher UserRole must survive downgrade"
        assert remaining == 1
