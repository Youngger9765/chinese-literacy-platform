"""#2860 —— 詞語複習的教師版找字表要真的送到學生面前。

## 為什麼是這個形狀的鎖

抽取器 150 課抽了 `grid` + `answer_paths`，九道門全綠，`module_reaches_the_student`
也把它算成「有抽到」。但那張表一課都沒到過學生面前 —— 因為
「story dict → StoryDetail → api.ts → 元件」**四處都是逐欄位列舉**，
每一處沒列到就靜默掉，沒有任何錯誤訊息。修的時候我一次只找到一處，
以為補完了，打真 API 才發現還是 0 課。

所以這裡不驗「yml 抽對了沒」（那是別的門的事），只驗**最後一哩**：
真的打 detail 端點，數有幾課拿得到。

## 為什麼用數量不用「有一課對就算過」

2026-08-19 一天內五次「只修一半」，根因全是 `>= 1` 型斷言 ——
別的課還滿足條件，所以鎖照樣綠。
"""
from __future__ import annotations

import pathlib

import pytest
import yaml
from fastapi.testclient import TestClient

from app.main import app

REPO = pathlib.Path(__file__).resolve().parents[2]
LESSONS = REPO / "backend" / "data" / "lessons"


def _count_in_source(module: str, require_grid: bool = False) -> int:
    n = 0
    for f in LESSONS.glob(f"L*/v3/{module}.yml"):
        body = (yaml.safe_load(f.read_text(encoding="utf-8")) or {}).get(module) or {}
        if require_grid and not body.get("grid"):
            continue
        n += 1
    return n


@pytest.fixture(scope="module")
def details():
    c = TestClient(app)
    ids = [s["id"] for s in c.get("/api/stories", params={"page_size": 300}).json()["stories"]]
    return [c.get(f"/api/stories/{i}").json() for i in ids]


def test_teacher_grid_reaches_the_detail_endpoint(details):
    """有 grid 的課，detail 端點就要送得出來 —— 一課都不能少。"""
    expected = _count_in_source("vocab_review", require_grid=True)
    served = sum(1 for d in details if (d.get("vocab_review") or {}).get("grid"))
    assert expected > 0, "來源一課都沒有 grid，這個鎖失去意義（是不是資料被清了？）"
    assert served == expected, (
        f"來源有 {expected} 課有教師版找字表，API 只送出 {served} 課。"
        "差額就是靜默掉在某一層逐欄位列舉裡。"
    )


def test_resources_reaches_the_detail_endpoint(details):
    expected = _count_in_source("resources")
    served = sum(1 for d in details if d.get("resources"))
    assert expected > 0
    assert served == expected, f"知識補給站來源 {expected} 課，API 只送 {served} 課"


def test_answer_paths_actually_spell_the_word(details):
    """座標讀出來必須就是那個詞。

    1-based / 0-based 弄反的話，讀出來會是別的字 —— 而畫面照樣顯示得出來，
    只是學生怎麼拖都對不上。這種錯不會有錯誤訊息。
    """
    checked = 0
    for d in details:
        vr = d.get("vocab_review") or {}
        grid = vr.get("grid")
        if not grid:
            continue
        # 一列是字串或字元陣列，兩種都在服務中（實測 142 / 1）
        rows = [list(r) if isinstance(r, list) else list(str(r)) for r in grid]
        for p in vr.get("answer_paths") or []:
            word = str(p.get("word") or "")
            cells = p.get("cells") or []
            if len(cells) != len(word):
                continue
            read = "".join(
                rows[r - 1][c - 1]
                for r, c in cells
                if 0 < r <= len(rows) and 0 < c <= len(rows[r - 1])
            )
            assert read == word, f"{d.get('id')} 的「{word}」座標讀出來是「{read}」"
            checked += 1
    assert checked > 1000, f"只驗到 {checked} 條路徑，抽樣太少（實測全庫約 1490 條）"
