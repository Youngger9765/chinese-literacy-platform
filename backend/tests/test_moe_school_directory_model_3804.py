"""TDD RED test for the MOE school directory columns on School (#3804 §4.2).

Written BEFORE the columns exist on app/models/school.py — run this file
first and confirm it fails (TypeError: unexpected keyword argument), then
add the columns to make it pass.

Covers:
- School accepts the five new nullable MOE directory fields
- moe_school_code has a real UNIQUE constraint (two schools with the same
  code must not both commit)
- moe_school_code being NULL for many rows (pre-existing schools) does not
  collide with itself (Postgres/SQLite both treat NULL != NULL in a unique
  index — this is what lets 4000+ old rows coexist with the new column)
"""
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import pytest
from sqlalchemy import create_engine, event
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.models import Base
from app.models.school import School


@pytest.fixture()
def db_session():
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )

    @event.listens_for(engine, "connect")
    def _set_sqlite_pragma(dbapi_connection, connection_record):
        cursor = dbapi_connection.cursor()
        cursor.execute("PRAGMA foreign_keys=ON")
        cursor.close()

    Base.metadata.create_all(bind=engine)
    SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
    session = SessionLocal()
    try:
        yield session
    finally:
        session.close()
        Base.metadata.drop_all(bind=engine)


class TestMoeSchoolDirectoryFields:
    def test_school_accepts_moe_directory_fields(self, db_session):
        school = School(
            name="市立大安國小",
            moe_school_code="333602",
            county_code="33",
            county_name="台北市",
            school_level="elementary",
            is_public=True,
        )
        db_session.add(school)
        db_session.commit()
        db_session.refresh(school)

        assert school.moe_school_code == "333602"
        assert school.county_code == "33"
        assert school.county_name == "台北市"
        assert school.school_level == "elementary"
        assert school.is_public is True

    def test_moe_directory_fields_default_to_none(self, db_session):
        """Pre-existing, non-MOE schools (domain-auto-created etc.) must keep
        working unchanged — all five new columns are nullable."""
        school = School(name="某老師自建學校")
        db_session.add(school)
        db_session.commit()
        db_session.refresh(school)

        assert school.moe_school_code is None
        assert school.county_code is None
        assert school.county_name is None
        assert school.school_level is None
        assert school.is_public is None

    def test_moe_school_code_unique_constraint_rejects_duplicate(self, db_session):
        db_session.add(School(name="School A", moe_school_code="011601"))
        db_session.commit()

        db_session.add(School(name="School B (duplicate code)", moe_school_code="011601"))
        with pytest.raises(IntegrityError):
            db_session.commit()
        db_session.rollback()

    def test_multiple_null_moe_school_code_rows_coexist(self, db_session):
        """NULL != NULL under a unique index — many legacy schools with no
        MOE code must be able to coexist (regression guard for the opposite
        mistake: making the column NOT NULL or treating None as a value)."""
        db_session.add(School(name="Legacy School 1"))
        db_session.add(School(name="Legacy School 2"))
        db_session.commit()  # must not raise

        count = db_session.query(School).filter(School.moe_school_code.is_(None)).count()
        assert count == 2
