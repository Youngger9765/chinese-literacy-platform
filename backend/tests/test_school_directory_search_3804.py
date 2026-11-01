"""TDD RED tests for school directory search/normalize/fuzzy-match (#3804 §4.2).

Written before app/services/school_directory_search.py exists.
"""
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import pytest
from sqlalchemy import create_engine, event
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.models import Base
from app.models.school import School
from app.services.school_directory_search import (
    FUZZY_MATCH_THRESHOLD,
    normalize_school_name,
    search_school_directory,
    similarity_score,
)


# ---------------------------------------------------------------------------
# normalize_school_name
# ---------------------------------------------------------------------------


class TestNormalizeSchoolName:
    def test_expands_national_elementary_to_short_form(self):
        assert normalize_school_name("大安國民小學") == "大安國小"

    def test_expands_national_junior_high_to_short_form(self):
        assert normalize_school_name("大安國民中學") == "大安國中"

    def test_strips_municipal_ownership_prefix(self):
        assert normalize_school_name("市立大安國小") == "大安國小"

    def test_strips_county_ownership_prefix(self):
        assert normalize_school_name("縣立大安國小") == "大安國小"

    def test_strips_private_ownership_prefix(self):
        assert normalize_school_name("私立育才國小") == "育才國小"

    def test_strips_national_and_public_prefix(self):
        assert normalize_school_name("國立華僑高級中等學校") == "華僑高級中等學校"
        assert normalize_school_name("公立大安國小") == "大安國小"

    def test_normalizes_traditional_tai_to_simplified(self):
        assert normalize_school_name("臺北市立螢橋國小") == "台北螢橋國小"

    def test_strips_fullwidth_and_halfwidth_whitespace(self):
        assert normalize_school_name("　大安 國小　") == "大安國小"

    def test_combination_of_all_rules(self):
        assert normalize_school_name("市立大安國民小學") == "大安國小"

    def test_idempotent_on_already_short_form(self):
        assert normalize_school_name("大安國小") == "大安國小"

    def test_empty_string_stays_empty(self):
        assert normalize_school_name("") == ""
        assert normalize_school_name(None) == ""


# ---------------------------------------------------------------------------
# similarity_score — the raw fuzzy-match function
# ---------------------------------------------------------------------------


class TestSimilarityScore:
    def test_exact_match_scores_1(self):
        assert similarity_score("大安國小", "大安國小") == 1.0

    def test_single_character_typo_clears_threshold(self):
        score = similarity_score("大按國小", "大安國小")
        assert score >= FUZZY_MATCH_THRESHOLD

    def test_unrelated_names_with_shared_suffix_do_not_clear_threshold(self):
        score = similarity_score("大安國小", "東門國小")
        assert score < FUZZY_MATCH_THRESHOLD

    def test_abbreviation_missing_suffix_clears_threshold_via_containment(self):
        score = similarity_score("大安", "大安國小")
        assert score >= FUZZY_MATCH_THRESHOLD

    def test_empty_strings_score_zero(self):
        assert similarity_score("", "大安國小") == 0.0
        assert similarity_score("大安國小", "") == 0.0


# ---------------------------------------------------------------------------
# search_school_directory — end-to-end against a seeded DB
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


def _seed(db):
    schools = [
        School(
            name="市立大安國小",
            moe_school_code="333602",
            county_name="台北市",
            school_level="elementary",
        ),
        School(
            name="市立大安國小",
            moe_school_code="034651",
            county_name="桃園市",
            school_level="elementary",
        ),
        School(
            name="市立大安國小",
            moe_school_code="064682",
            county_name="台中市",
            school_level="elementary",
        ),
        School(
            name="市立大安國中",
            moe_school_code="333601",
            county_name="台北市",
            school_level="junior_high",
        ),
        School(
            name="市立東門國小",
            moe_school_code="333603",
            county_name="台北市",
            school_level="elementary",
        ),
        # Non-MOE, manually-created school — must never appear in directory search
        School(name="某老師自建學校"),
    ]
    for s in schools:
        db.add(s)
    db.commit()
    return schools


class TestSearchSchoolDirectory:
    def test_typo_finds_correct_school(self, db_session):
        _seed(db_session)
        results = search_school_directory(db_session, county=None, q="大按國小")
        names = {r.name for r, _score in results}
        assert "市立大安國小" in names

    def test_abbreviation_without_suffix_finds_school(self, db_session):
        _seed(db_session)
        results = search_school_directory(db_session, county=None, q="大安")
        codes = {r.moe_school_code for r, _score in results}
        assert {"333602", "034651", "064682", "333601"}.issubset(codes)

    def test_same_name_different_counties_all_returned_without_county_filter(self, db_session):
        _seed(db_session)
        results = search_school_directory(db_session, county=None, q="大安國小")
        codes = {r.moe_school_code for r, _score in results}
        assert {"333602", "034651", "064682"}.issubset(codes)

    def test_county_filter_narrows_to_one_of_the_duplicates(self, db_session):
        _seed(db_session)
        results = search_school_directory(db_session, county="桃園市", q="大安國小")
        codes = {r.moe_school_code for r, _score in results}
        assert codes == {"034651"}

    def test_elementary_and_junior_high_both_returned_and_distinguishable(self, db_session):
        _seed(db_session)
        results = search_school_directory(db_session, county="台北市", q="大安")
        levels_by_code = {r.moe_school_code: r.school_level for r, _score in results}
        assert levels_by_code["333602"] == "elementary"
        assert levels_by_code["333601"] == "junior_high"

    def test_non_moe_schools_never_appear_in_results(self, db_session):
        _seed(db_session)
        results = search_school_directory(db_session, county=None, q="自建")
        assert results == []

    def test_unrelated_query_returns_no_results(self, db_session):
        _seed(db_session)
        results = search_school_directory(db_session, county=None, q="不存在的某某學校名稱")
        assert results == []

    def test_no_query_returns_county_filtered_list(self, db_session):
        _seed(db_session)
        results = search_school_directory(db_session, county="台北市", q=None)
        codes = {r.moe_school_code for r, _score in results}
        assert codes == {"333602", "333601", "333603"}

    def test_results_sorted_by_score_descending(self, db_session):
        _seed(db_session)
        results = search_school_directory(db_session, county=None, q="大安國小")
        scores = [score for _r, score in results]
        assert scores == sorted(scores, reverse=True)
