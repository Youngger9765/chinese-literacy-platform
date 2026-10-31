"""閱讀寶貝 —— 靜態設定載入器（#3780 第一階段）。

讀三份設定檔（版控在 repo，不進資料庫）：
  - app/data/reading_baby/lesson_indicators.json  — 179 課課綱對照（由
    scripts/build_reading_baby_lesson_indicators.py 從
    docs/design/reading-babies/lesson-indicators.json 產生）
  - app/data/reading_baby/quality_thresholds.json — quality_passed 門檻
  - app/data/reading_baby/growth_weights.json     — 三階進化的站權重
  - app/data/stations/station_buildings.json      — 站 → 建築名稱（寶貝卡用）

跟 `word_baby_config.py` 同一個精神：只讀設定，不含任何判定邏輯——判定邏輯在
`reading_baby_quality.py`（quality_passed 怎麼算）與 `reading_baby_service.py`
（成長/進化怎麼算）。
"""
from __future__ import annotations

import json
from functools import lru_cache
from pathlib import Path

_DATA_DIR = Path(__file__).resolve().parent.parent / "data" / "reading_baby"
_STATIONS_DIR = Path(__file__).resolve().parent.parent / "data" / "stations"


def _read_json(path: Path) -> dict:
    with open(path, encoding="utf-8") as fh:
        return json.load(fh)


@lru_cache(maxsize=1)
def load_lesson_indicators() -> dict:
    """回傳整份 lesson_indicators.json（含 `_meta`／`mapping_version`／`lessons`）。"""
    return _read_json(_DATA_DIR / "lesson_indicators.json")


@lru_cache(maxsize=1)
def lessons_by_uid() -> dict[str, dict]:
    return load_lesson_indicators()["lessons"]


def get_lesson_indicator(lesson_uid: str) -> dict | None:
    """單一課的課綱對照；查不到回 None（呼叫端自行決定要不要當作『非 179 課內』處理）。"""
    return lessons_by_uid().get(lesson_uid)


def get_indicator_text(code: str) -> str | None:
    """課綱代碼 → 108 課綱原文（老師端欄頭／鑽取頁用）；查不到回 None。"""
    return load_lesson_indicators().get("indicator_texts", {}).get(code)


def get_mapping_version() -> str:
    return load_lesson_indicators().get("mapping_version", "unknown")


def all_lesson_uids() -> list[str]:
    """排序過的全部 lesson_uid（決定性順序，給圖鑑頁用）。"""
    return sorted(lessons_by_uid().keys())


@lru_cache(maxsize=1)
def load_quality_thresholds() -> dict:
    return _read_json(_DATA_DIR / "quality_thresholds.json")


@lru_cache(maxsize=1)
def load_growth_weights() -> dict:
    return _read_json(_DATA_DIR / "growth_weights.json")


def get_station_weight(station: str) -> float:
    weights = load_growth_weights()
    return weights["station_weight"].get(station, weights["_meta"]["default_weight"])


def get_evolution_thresholds() -> dict:
    return load_growth_weights()["evolution_thresholds"]


@lru_cache(maxsize=1)
def load_station_buildings() -> dict:
    return _read_json(_STATIONS_DIR / "station_buildings.json")


def get_station_building(station: str) -> str | None:
    return load_station_buildings()["station_building"].get(station)
