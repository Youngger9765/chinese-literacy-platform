"""#3780 D（PRD §5.6）—— 前後端共用的「這站算不算完成」規則，讀同一份
`fixtures/island-station-completion.json`，斷言這裡算出來的 `stations_done`
跟前端 `islandStationCompletion.fixture.test.ts` 算出來的完全一致（同一個
CI 就會抓到任一邊漂移）。

Run with:
    cd backend && python -m pytest tests/test_island_station_completion_fixture.py -v
"""
import json
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import pytest

from app.routes.learning.learning_progress import _is_station_done, _count_stations_done

FIXTURE_PATH = os.path.join(os.path.dirname(__file__), "..", "..", "fixtures", "island-station-completion.json")


def _load_fixture():
    with open(FIXTURE_PATH, "r", encoding="utf-8") as f:
        return json.load(f)


FIXTURE = _load_fixture()


def test_fixture_has_at_least_5_cases():
    """先確認 fixture 真的讀到了——空清單會讓底下的 parametrize 悄悄變成
    0 條測試，看起來「沒有測試失敗」但其實什麼都沒測到。"""
    assert len(FIXTURE["cases"]) >= 5


@pytest.mark.parametrize("case", FIXTURE["cases"], ids=lambda c: c["name"])
def test_case_matches_expected(case):
    step_sequence = case["step_sequence"]
    steps_completed = case["steps_completed"]
    has_session = case["has_session"]

    done_indexes = [
        i for i in range(len(step_sequence))
        if _is_station_done(step_sequence, i, steps_completed, has_session)
    ]
    assert done_indexes == case["expected_done_indexes"]
    assert _count_stations_done(step_sequence, steps_completed, has_session) == case["expected_stations_done"]
    assert len(step_sequence) == case["expected_stations_total"]
