"""TDD RED tests for the MOE school directory import (#3804 §4.2).

Two layers:
  1. Parsing — small inline CSV fixtures test each quirk in isolation
     (multi-year junior-high file, senior-high footnote row, traditional/
     simplified county name, upsert idempotency).
  2. Reconciliation against the real committed CSVs in
     backend/data/moe_schools/ — this is the "imported row count must match
     the source CSV row count" check the task asked for, made concrete and
     machine-checked instead of a one-off manual count in a commit message.
"""
import io
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import csv as csv_module

import pytest
from sqlalchemy import create_engine, event
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.models import Base
from app.models.school import School
from app.services.moe_school_import import (
    MOE_DATA_DIR,
    import_moe_schools,
    load_moe_school_rows,
    parse_elementary_or_senior_csv,
    parse_junior_high_csv,
)


# ---------------------------------------------------------------------------
# Inline fixtures — each isolates exactly one data quirk
# ---------------------------------------------------------------------------

_ELEMENTARY_CSV = (
    "學年度,代碼,學校名稱,公/私立,縣市名稱,地址,電話,網址\r\n"
    "115,011601,私立育才國小,私立,[01]新北市,[234]新北市永和區福和路125巷20號,(02)29214630,https://x\r\n"
    "115,333602,市立大安國小,公立,[33]臺北市,[106]臺北市大安區臥龍街129號,(02)27295654,https://y\r\n"
)

_JUNIOR_CSV_MULTI_YEAR = (
    "學年度,代碼,學校名稱,公/私立,縣市名稱,地址,電話,網址\r\n"
    "104,014501,市立板橋國中,公立,[01]新北市,[220]舊地址,(02)1111,http://old\r\n"
    "115,014501,市立板橋國中,公立,[01]新北市,[220]新北市板橋區中正路437號,(02)29666498,http://new\r\n"
    "115,333601,市立大安國中,公立,[33]臺北市,[106]臺北市大安區信義路四段1號,(02)2222,http://z\r\n"
)

_SENIOR_CSV_WITH_FOOTNOTE = (
    "學年度,代碼,學校名稱,公/私立,縣市名稱,地址,電話,網址,備註\r\n"
    "115,010301,國立華僑高級中等學校,公立,[01]新北市,[220]新北市板橋區大觀路一段32號,(02)29684131,http://a,\r\n"
    "高中部尚未招生,,,,,,,,\r\n"
)


def _rows_from_csv_text(text: str) -> list[dict]:
    return list(csv_module.DictReader(io.StringIO(text)))


class TestParseElementaryOrSeniorCsv:
    def test_parses_all_rows(self):
        rows = parse_elementary_or_senior_csv(_rows_from_csv_text(_ELEMENTARY_CSV), level="elementary")
        assert len(rows) == 2

    def test_row_shape(self):
        rows = parse_elementary_or_senior_csv(_rows_from_csv_text(_ELEMENTARY_CSV), level="elementary")
        row = rows[0]
        assert row == {
            "moe_school_code": "011601",
            "name": "私立育才國小",
            "is_public": False,
            "county_code": "01",
            "county_name": "新北市",
            "school_level": "elementary",
            "address": "[234]新北市永和區福和路125巷20號",
            "phone": "(02)29214630",
        }

    def test_normalizes_traditional_tai_in_county_name(self):
        rows = parse_elementary_or_senior_csv(_rows_from_csv_text(_ELEMENTARY_CSV), level="elementary")
        taipei_row = next(r for r in rows if r["moe_school_code"] == "333602")
        assert taipei_row["county_name"] == "台北市"  # not 臺北市
        assert taipei_row["county_code"] == "33"

    def test_skips_footnote_row_with_no_code(self):
        rows = parse_elementary_or_senior_csv(
            _rows_from_csv_text(_SENIOR_CSV_WITH_FOOTNOTE), level="senior_high"
        )
        assert len(rows) == 1
        assert rows[0]["moe_school_code"] == "010301"
        assert rows[0]["school_level"] == "senior_high"


class TestParseJuniorHighCsv:
    def test_filters_to_requested_academic_year(self):
        rows = parse_junior_high_csv(_rows_from_csv_text(_JUNIOR_CSV_MULTI_YEAR), year="115")
        codes = {r["moe_school_code"] for r in rows}
        # 014501 appears in both 104 and 115 - only the 115 row should survive
        assert codes == {"014501", "333601"}
        assert len(rows) == 2

    def test_picks_the_requested_years_data_not_an_older_year(self):
        rows = parse_junior_high_csv(_rows_from_csv_text(_JUNIOR_CSV_MULTI_YEAR), year="115")
        row = next(r for r in rows if r["moe_school_code"] == "014501")
        assert row["address"] == "[220]新北市板橋區中正路437號"  # the 115 address, not 104's

    def test_school_level_tagged_junior_high(self):
        rows = parse_junior_high_csv(_rows_from_csv_text(_JUNIOR_CSV_MULTI_YEAR), year="115")
        assert all(r["school_level"] == "junior_high" for r in rows)


# ---------------------------------------------------------------------------
# import_moe_schools(db, rows) — upsert behavior
# ---------------------------------------------------------------------------


@pytest.fixture()
def db_session():
    engine = create_engine(
        "sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool
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


class TestImportMoeSchools:
    def test_creates_new_schools(self, db_session):
        rows = parse_elementary_or_senior_csv(_rows_from_csv_text(_ELEMENTARY_CSV), level="elementary")
        result = import_moe_schools(db_session, rows)

        assert result.created == 2
        assert result.updated == 0
        assert db_session.query(School).count() == 2

    def test_rerun_is_idempotent_no_duplicates(self, db_session):
        rows = parse_elementary_or_senior_csv(_rows_from_csv_text(_ELEMENTARY_CSV), level="elementary")
        import_moe_schools(db_session, rows)
        result2 = import_moe_schools(db_session, rows)

        assert result2.created == 0
        assert result2.updated == 0  # nothing changed between runs
        assert db_session.query(School).count() == 2

    def test_rerun_updates_changed_fields(self, db_session):
        rows = parse_elementary_or_senior_csv(_rows_from_csv_text(_ELEMENTARY_CSV), level="elementary")
        import_moe_schools(db_session, rows)

        changed_rows = [dict(r) for r in rows]
        changed_rows[0]["phone"] = "(02)99999999"
        result = import_moe_schools(db_session, changed_rows)

        assert result.created == 0
        assert result.updated == 1
        updated = (
            db_session.query(School).filter(School.moe_school_code == "011601").one()
        )
        assert updated.phone == "(02)99999999"

    def test_does_not_touch_pre_existing_non_moe_schools(self, db_session):
        legacy = School(name="某老師自建學校")
        db_session.add(legacy)
        db_session.commit()
        legacy_id = legacy.id

        rows = parse_elementary_or_senior_csv(_rows_from_csv_text(_ELEMENTARY_CSV), level="elementary")
        import_moe_schools(db_session, rows)

        reloaded = db_session.query(School).filter(School.id == legacy_id).one()
        assert reloaded.name == "某老師自建學校"
        assert reloaded.moe_school_code is None
        # legacy row + 2 imported rows, no merge attempted
        assert db_session.query(School).count() == 3


# ---------------------------------------------------------------------------
# Reconciliation against the real committed CSVs
# ---------------------------------------------------------------------------


class TestLoadRealMoeDataReconciliation:
    """Counts here are the machine-checked version of the README's claims —
    if someone re-downloads a newer academic year and the counts drift, this
    test (not just the README prose) will tell them."""

    def test_elementary_row_count_matches_source(self):
        rows = load_moe_school_rows(data_dir=MOE_DATA_DIR)
        elementary = [r for r in rows if r["school_level"] == "elementary"]
        assert len(elementary) == 2609

    def test_junior_high_row_count_after_year_filter(self):
        rows = load_moe_school_rows(data_dir=MOE_DATA_DIR)
        junior = [r for r in rows if r["school_level"] == "junior_high"]
        assert len(junior) == 740

    def test_senior_high_row_count_excludes_footnote(self):
        rows = load_moe_school_rows(data_dir=MOE_DATA_DIR)
        senior = [r for r in rows if r["school_level"] == "senior_high"]
        assert len(senior) == 506

    def test_total_row_count_and_no_code_collisions(self):
        rows = load_moe_school_rows(data_dir=MOE_DATA_DIR)
        assert len(rows) == 2609 + 740 + 506

        codes = [r["moe_school_code"] for r in rows]
        assert len(codes) == len(set(codes)), "duplicate moe_school_code across the three files"

    def test_full_import_round_trip_against_real_data(self, db_session):
        rows = load_moe_school_rows(data_dir=MOE_DATA_DIR)
        result = import_moe_schools(db_session, rows)

        assert result.created == 2609 + 740 + 506
        assert result.updated == 0
        assert db_session.query(School).filter(School.moe_school_code.isnot(None)).count() == (
            2609 + 740 + 506
        )
