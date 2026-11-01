"""Eval: fuzzy school-name search against 20 real typo/abbreviation cases
drawn from the actual imported MOE directory (#3804 §4.2 task requirement).

Not a unit test of one isolated behavior — this measures the whole pipeline
(load real CSVs -> import -> fuzzy search) against realistic input noise
from a teacher typing a school name, run against the full ~3855-school
universe (not a handful of hand-picked seed rows like
test_school_directory_search_3804.py uses), so a case can fail here even
if every unit test above is green — e.g. if some other school in the full
dataset accidentally scores higher than the intended target.

Pass criterion: the expected school (by moe_school_code — several of these
names exist in multiple counties, so "any one of the real schools with
this name" counts) appears in the top 5 results. Reported as 答對 N/M.
"""
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import pytest
from sqlalchemy import create_engine, event
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.models import Base
from app.services.moe_school_import import import_moe_schools, load_moe_school_rows
from app.services.school_directory_search import search_school_directory

TOP_N = 5

# (query with a realistic typo/abbreviation, acceptable moe_school_code(s))
# Source names + codes verified against backend/data/moe_schools/*.csv
# directly (see commit message for the lookup query).
EVAL_CASES: list[tuple[str, set[str]]] = [
    # elementary — single-character substitution typos (visually/phonetically similar)
    ("市立古停國小", {"333607"}),                      # 亭->停
    ("市立老崧國小", {"373609"}),                      # 松->崧
    ("市立興鴉國小", {"323601"}),                      # 雅->鴉
    ("市立螢撟國小", {"353601"}),                      # 橋->撟
    ("市立龍仙國小", {"034611", "064686", "124703", "183609", "373610"}),  # 山->仙
    ("市立仁受國小", {"014787", "114673", "173611", "193641", "333605", "593603"}),  # 愛->受
    ("市立新聲國小", {"114734", "333610"}),             # 生->聲
    ("縣立成工國小", {"024611", "054686", "074732", "094628", "104678", "144663", "164614"}),  # 功->工
    ("市立信意國小", {"014771", "034671", "114780", "173612", "193615", "323605", "563603"}),  # 義->意
    ("市立和評國小", {"014678", "124648", "173604"}),   # 平->評
    # elementary — character omission
    ("永樂小", {"363604"}),                            # dropped 國
    # elementary — abbreviation (missing 國小 suffix entirely)
    ("博愛", {"203602", "213602", "323609", "553606"}),
    ("忠孝", {"173603", "193608", "353607"}),
    # elementary — traditional variant (臺) + extra county-name text the
    # normalizer does not strip, relying on containment boost
    ("臺北市立建國國小", {"014777", "034606", "064654", "573602"}),
    # elementary — full-width whitespace
    ("　大安　國小", {"034651", "064682", "333602"}),
    # junior high
    ("市立介夀國中", {"313501"}),                       # 壽->夀 (common variant form)
    ("金華中", {"333505"}),                             # omission, dropped 國
    ("民生", {"203505", "313502"}),                     # abbreviation
    # senior high
    ("國立華憍高級中等學校", {"010301"}),                # 僑->憍
    ("縣立成攻高中", {"074339"}),                       # 功->攻
]


@pytest.fixture(scope="module")
def db_session_with_real_data():
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

    rows = load_moe_school_rows()
    result = import_moe_schools(session, rows)
    assert result.created == len(rows), "fixture setup: full real-data import must create every row"

    yield session
    session.close()
    Base.metadata.drop_all(bind=engine)


def test_fuzzy_search_eval_top5_accuracy(db_session_with_real_data):
    correct = 0
    failures = []

    for query, acceptable_codes in EVAL_CASES:
        results = search_school_directory(db_session_with_real_data, county=None, q=query)
        top5_codes = {school.moe_school_code for school, _score in results[:TOP_N]}
        hit = bool(top5_codes & acceptable_codes)
        if hit:
            correct += 1
        else:
            failures.append((query, acceptable_codes, top5_codes))

    total = len(EVAL_CASES)
    print(f"\n答對 {correct}/{total} = {correct / total:.0%}")
    if failures:
        print("未命中案例：")
        for query, expected, got in failures:
            print(f"  {query!r} -> expected one of {expected}, top-5 codes were {got}")

    # Measured, not assumed: first run of this eval against the real
    # ~3855-school dataset scored 16/20 (80%), not 20/20. Every case was
    # individually checked to clear FUZZY_MATCH_THRESHOLD against its exact
    # target in isolation (see commit message) — the 4 misses
    # (市立興鴉國小/市立新聲國小/縣立成工國小/民生) are a real, honest
    # limitation: all 4 landed on a "common template" where 5+ real schools
    # nationally are each exactly one character away from the query (e.g.
    # 興南/興仁/興華/興福/復興國小 are all, like the intended 興雅國小, a
    # single substitution from "興鴉國小"). A pure character-overlap score
    # (difflib ratio, or any edit-distance metric) cannot break that tie
    # without an external signal such as phonetic similarity — a real
    # improvement, but out of scope for this round (would need a zhuyin/
    # pinyin distance lookup, not a quick fix). This bar is set to the
    # measured 16, so it still catches a future regression without
    # asserting a result this round never achieved.
    assert correct >= 16, f"答對 {correct}/{total} — see printed failures above (baseline: 16/20)"
