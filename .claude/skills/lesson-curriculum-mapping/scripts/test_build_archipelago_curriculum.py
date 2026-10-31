#!/usr/bin/env python3
"""TDD lock for build_archipelago_curriculum.py — 先紅後綠。

兩種測試：
1. 小夾具（人工構造 3 課）測 extract_codes() 的邊界情況（缺欄位、前綴剝離）。
2. 真實 lesson-indicators.json 的「已知分布」快照——2026-10-31 實跑過一次核對的
   數字（見 PRD 與 skill 文件）。這條是 regression lock：來源資料被改過但沒人同步
   更新分群合併表時，這裡會先紅，不會讓前端悄悄跑出不一致的群。
"""
from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from build_archipelago_curriculum import extract_codes, build, LESSON_JSON  # noqa: E402


def test_extract_codes_happy_path():
    lesson = {
        "primary_indicator": {"code": "5-Ⅳ-4"},
        "learning_contents": [{"code": "Ad-Ⅳ-1"}, {"code": "Bb-Ⅳ-2"}],
        "core_competencies": [{"general_item": "A2"}],
    }
    codes = extract_codes(lesson)
    assert codes == {
        "performanceCode": "5-Ⅳ-4",
        "contentPrefix": "Ad",  # 只取第一筆 learning_contents 的前綴，不是全部
        "competencyCode": "A2",
    }


def test_extract_codes_missing_fields_do_not_crash():
    lesson = {}
    codes = extract_codes(lesson)
    assert codes == {"performanceCode": None, "contentPrefix": None, "competencyCode": None}


def test_extract_codes_empty_lists_do_not_crash():
    lesson = {"primary_indicator": {}, "learning_contents": [], "core_competencies": []}
    codes = extract_codes(lesson)
    assert codes["performanceCode"] is None
    assert codes["contentPrefix"] is None
    assert codes["competencyCode"] is None


def test_extract_codes_prefix_strips_trailing_stage_and_number():
    lesson = {"learning_contents": [{"code": "Cb-Ⅳ-1"}]}
    assert extract_codes(lesson)["contentPrefix"] == "Cb"


def test_real_lesson_json_total_is_179():
    by_story_id, missing = build(LESSON_JSON)
    assert len(by_story_id) == 179
    assert missing == [], f"這些課缺三層代碼之一：{missing}"


def test_real_lesson_json_known_distribution_2026_10_31():
    """2026-10-31 實跑確認過的分布——來源資料改版時這條先紅，提醒去同步
    `archipelagoClusters.ts` 的合併表與 PRD。"""
    by_story_id, _ = build(LESSON_JSON)

    import collections

    perf = collections.Counter(v["performanceCode"] for v in by_story_id.values())
    content = collections.Counter(v["contentPrefix"] for v in by_story_id.values())
    comp = collections.Counter(v["competencyCode"] for v in by_story_id.values())

    assert len(perf) == 19
    assert perf["5-Ⅳ-4"] == 31
    assert perf["5-Ⅱ-9"] == 1  # 最小的一個，驗證併群表有涵蓋到它

    assert dict(content) == {
        "Ad": 86, "Cb": 36, "Bc": 21, "Ab": 19, "Ba": 9, "Bd": 8,
    }

    assert dict(comp) == {
        "A2": 73, "C1": 36, "B3": 25, "B2": 23, "B1": 21, "C2": 1,
    }


if __name__ == "__main__":
    import pytest

    raise SystemExit(pytest.main([__file__, "-v"]))
