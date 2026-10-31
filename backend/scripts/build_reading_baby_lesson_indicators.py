#!/usr/bin/env python3
"""閱讀寶貝課綱對照 —— 從設計文件精簡成後端可讀檔（#3780 第一階段）。

來源（人讀、審核用，179 課逐課課綱對照＋來源強度標記）：
    docs/design/reading-babies/lesson-indicators.json

產出（機器讀、服務用，精簡成遊戲機制只需要的欄位）：
    backend/app/data/reading_baby/lesson_indicators.json

可重跑：來源文件改版（例如 node_indicator_review.xlsx 審核回填後重跑
`.claude/skills/lesson-curriculum-mapping/scripts/build_lesson_indicators.py`
產生新版來源）之後，重跑這支腳本就能同步後端對照，不需要手改 JSON。

規則（對應 docs/design/reading-babies/ability-indicators.md §2.1／§6.1／
ability_id_rule）：
  1. `effective_grade`：來源 `grade` 是數字字串（"4".."9"）就直接轉 int；
     是「文言文」/「品格教育」這種非數字系列名，改讀 `professor_row.grade`
     （教授總表的真實年級——2026-10-31 查核：12 課文言文全部是 8 年級、
     15 課品格教育 9 課是 4 年級／6 課是 5 年級，與工頭補充指示一致）。
  2. 每個站的 `ability_id`／`signal_type`：
     - `spotlight` 站固定讀該課 `primary_indicator.code`（聚光燈＝主要指標）
     - 其餘站查 `station_indicator_map[station].by_stage[該課 stage]`
     - `by_stage` 是 null（如 `vocab-review`）或整條 `signal` 是 `none`
       （如 `report`）的站，不產出（沒有可追蹤的指標代碼，不量）
     - `signal` 欄位可能帶括號備註（如 `"completion（逐格正確率是否落庫待確認）"`），
       只取括號前的乾淨字串當 `signal_type`
"""
from __future__ import annotations

import json
from pathlib import Path

_BACKEND_ROOT = Path(__file__).resolve().parent.parent
_REPO_ROOT = _BACKEND_ROOT.parent
SOURCE_PATH = _REPO_ROOT / "docs" / "design" / "reading-babies" / "lesson-indicators.json"
TARGET_PATH = _BACKEND_ROOT / "app" / "data" / "reading_baby" / "lesson_indicators.json"


def _effective_grade(lesson: dict) -> int:
    """見模組 docstring 規則 1。"""
    grade = lesson.get("grade")
    if isinstance(grade, str) and grade.isdigit():
        return int(grade)
    professor_row = lesson.get("professor_row") or {}
    prof_grade = professor_row.get("grade")
    if prof_grade is None:
        raise ValueError(
            f"{lesson.get('lesson_uid')}: grade={grade!r} 不是數字，"
            "且 professor_row.grade 也沒有 —— 這一課沒有任何管道算出 effective_grade"
        )
    return int(prof_grade)


def _clean_signal(raw_signal: str) -> str:
    """去掉 signal 欄位常見的括號備註，只留乾淨的 signal_type 字串。"""
    return raw_signal.split("（", 1)[0].split("(", 1)[0].strip()


def _resolve_station_ability(lesson: dict, station: str, station_indicator_map: dict) -> dict | None:
    """見模組 docstring 規則 2。回傳 None 代表這個站不產出（不量）。"""
    entry = station_indicator_map.get(station)
    if entry is None:
        return None
    signal_type = _clean_signal(entry["signal"])
    if signal_type == "none":
        return None
    if station == "spotlight":
        ability_id = lesson["primary_indicator"]["code"]
    else:
        by_stage = entry.get("by_stage")
        if not isinstance(by_stage, dict):
            return None
        ability_id = by_stage.get(lesson["stage"])
        if ability_id is None:
            return None
    return {"indicator_code": ability_id, "signal_type": signal_type}


def build(source_path: Path = SOURCE_PATH) -> dict:
    doc = json.loads(source_path.read_text(encoding="utf-8"))
    station_indicator_map = doc["station_indicator_map"]

    lessons_out: dict[str, dict] = {}
    for lesson in doc["lessons"]:
        lesson_uid = lesson["lesson_uid"]
        stations_out: dict[str, dict] = {}
        for station in lesson.get("stations", []):
            resolved = _resolve_station_ability(lesson, station, station_indicator_map)
            if resolved is not None:
                stations_out[station] = resolved

        lessons_out[lesson_uid] = {
            "lesson_uid": lesson_uid,
            "title": lesson.get("title"),
            "grade_code": lesson.get("grade_code"),
            "grade": lesson.get("grade"),
            "effective_grade": _effective_grade(lesson),
            "stage": lesson["stage"],
            "ability_family": lesson.get("ability_family"),
            "ability_family_name": lesson.get("ability_family_name"),
            "primary_indicator_code": lesson["primary_indicator"]["code"],
            "assessable_stations": lesson.get("assessable_stations", []),
            "stations": stations_out,
        }

    return {
        "_meta": {
            "name": "閱讀寶貝課綱對照（後端精簡版）",
            "generated_from": "docs/design/reading-babies/lesson-indicators.json",
            "generated_by": "backend/scripts/build_reading_baby_lesson_indicators.py",
            "source_schema_version": doc.get("schema_version"),
        },
        "mapping_version": doc.get("schema_version", "unknown"),
        "lessons": lessons_out,
    }


def main() -> None:
    result = build()
    TARGET_PATH.parent.mkdir(parents=True, exist_ok=True)
    TARGET_PATH.write_text(
        json.dumps(result, ensure_ascii=False, indent=2, sort_keys=False) + "\n",
        encoding="utf-8",
    )
    print(f"wrote {len(result['lessons'])} lessons -> {TARGET_PATH}")


if __name__ == "__main__":
    main()
