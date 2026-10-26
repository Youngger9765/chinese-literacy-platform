"""文字寶貝養成系統 — 靜態內容設定載入器（#3780）。

讀 `app/data/word_babies/{babies,fragments,encounters,care}.json`——這些是
不會因學生而變的靜態內容（100 隻的名字/稀有度/飲食/進化階段、口味掉落機率、
遭遇機率、照顧天數門檻），版控在 repo 裡，不進資料庫。

每個學生「目前養到哪裡」這種會變的狀態，走 `app/models/word_baby.py` 的
3 張表，不在這裡。

⛔ 這裡不含任何「某學生某站有沒有掉碎片」的判定邏輯——那是
`word_baby_service.py` 的事，而且正式判定一律用 `secrets`（CSPRNG），
不是這份設計內容本身帶的決定性雜湊（design.md §15.1）。
"""
from __future__ import annotations

import json
from functools import lru_cache
from pathlib import Path

_DATA_DIR = Path(__file__).resolve().parent.parent / "data" / "word_babies"


def _read_json(filename: str) -> dict:
    path = _DATA_DIR / filename
    with open(path, encoding="utf-8") as fh:
        return json.load(fh)


@lru_cache(maxsize=1)
def load_babies() -> dict[str, dict]:
    """回傳 {baby_id: baby_dict}，O(1) 查一隻的設定。"""
    doc = _read_json("babies.json")
    return {b["id"]: b for b in doc["babies"]}


@lru_cache(maxsize=1)
def load_fragments() -> dict:
    return _read_json("fragments.json")


@lru_cache(maxsize=1)
def load_encounters() -> dict:
    return _read_json("encounters.json")


@lru_cache(maxsize=1)
def load_care() -> dict:
    return _read_json("care.json")


def get_baby(baby_id: str) -> dict | None:
    return load_babies().get(baby_id)


@lru_cache(maxsize=1)
def _station_flavor_map() -> dict[str, str]:
    fragments = load_fragments()
    return {row["station"]: row["flavor"] for row in fragments["station_flavor_map"]}


def get_station_flavor(station: str) -> str | None:
    """PRD §5.1 的站 id → 口味家族。查不到回 None（未知站，呼叫端自行決定
    要不要當作「這站不參與寶貝系統」處理，不在這裡拋例外）。"""
    return _station_flavor_map().get(station)


def get_drop_probability(flavor: str) -> float:
    return load_fragments()["drop_probability_by_flavor"][flavor]


@lru_cache(maxsize=1)
def babies_by_flavor() -> dict[str, list[str]]:
    """flavor → 飲食包含這個口味的 baby_id 清單（排序過，決定性順序）。"""
    grouped: dict[str, list[str]] = {f: [] for f in load_fragments()["flavor_families"]}
    for baby in load_babies().values():
        for flavor in baby["diet_flavors"]:
            grouped[flavor].append(baby["id"])
    for flavor in grouped:
        grouped[flavor].sort()
    return grouped
