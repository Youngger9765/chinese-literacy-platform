"""子項標題不可以在橋接器裡消失（#2736）

為什麼需要這支
--------------
`_flatten_items` 取子項名字時只讀 `sub_label` / `index`：

    label = str(item.get("sub_label") or item.get("index") or "").strip()

但 skill §⑥.55b 叫抽取者寫 `label:`：

    - label: 挫折事件
      items:
        - label: 雅加達亞運        # ← 這個
          value: 比賽結果是（單選）

於是**照現行規格寫的每一課，子項標題都渲染成空字串**。畫面上那一欄整排空白，
學生看不到「起因／經過／結果」是哪一列。而且不報錯：整列還有別的格有字，
形狀門的「每列至少一格非空」照樣過，逐字門也過（YAML 裡的字沒被改）。

實測 61 課、359 個 `items` 子項 + 6 個 `sub_rows` 子項，全部掉光。

這支怎麼擋
----------
斷言用**數量相等**，不是「至少有一個」：從 YAML 自己數出「作者寫了名字的子項」有幾個，
再數渲染後真的畫出名字的有幾個，兩個數字必須相同。少一個就紅。

⚠️ 另外釘一個下限（`>= EXPECTED_FLOOR`）。沒有它的話，glob 打錯字、課被搬走、
或在空目錄跑，`0 == 0` 會綠 —— 那是這種全庫掃描最典型的假綠。
"""
from __future__ import annotations

import pathlib

import pytest
import yaml

from app.services.keypoints_to_structure import (
    _flatten_items,
    keypoints_to_structure_table,
)

LESSONS = pathlib.Path(__file__).resolve().parents[1] / "data/lessons"

# 2026-08-18 全庫實際值 365（items 359 + sub_rows 6）。課只會變多，所以這是下限
# 不是等號 —— 它的工作只有一個：確認這支測試真的掃到東西了。
EXPECTED_FLOOR = 365


def _authored_sublabels(kp: dict) -> list[str]:
    """作者在 YAML 裡替子項寫的名字。**不呼叫橋接器** —— 拿實作去算期望值
    等於自己跟自己比對，改壞了也會綠。

    只走 `sub_rows or items`（不是兩個都收），因為橋接器就是這樣挑的
    （`keypoints_to_structure.py` 的 `subs = row.get("sub_rows") or row.get("items")`）；
    收了它看不到的東西會製造假紅。
    """
    names: list[str] = []
    for row in kp.get("rows") or []:
        if not isinstance(row, dict):
            continue
        for item in (row.get("sub_rows") or row.get("items") or []):
            if not isinstance(item, dict):
                continue
            name = item.get("sub_label") or item.get("index") or item.get("label")
            if name is not None and str(name).strip():
                names.append(str(name).strip())
    return names


def _rendered_sublabels(table: list[list]) -> list[str]:
    """渲染結果裡屬於「子項名字」的那些格。

    形狀是 `[列標題, 子項名, 內容, 子項名, 內容, …]`，所以子項名固定在奇數位。
    只看奇數位而不是整列搜尋，才不會讓內文裡剛好同字的句子冒充成「有畫出來」。
    """
    out: list[str] = []
    for cells in table or []:
        if len(cells) < 3:
            continue
        out.extend(str(c).strip() for c in cells[1::2])
    return out


def _lessons_with_sublabels():
    # 檔名帶自己的 slug（#2916）；多篇課一篇一份，每一份都要驗。
    for path in sorted(LESSONS.glob("*/v3/keypoints.*.yml")):
        kp = (yaml.safe_load(path.read_text(encoding="utf-8")) or {}).get("keypoints") or {}
        rows = kp.get("rows")
        if not isinstance(rows, list) or not rows:
            continue
        # 沒有列標題的課走欄位式那條路，不經過 `_flatten_items`
        if not any(isinstance(r, dict) and r.get("label") for r in rows):
            continue
        authored = _authored_sublabels(kp)
        if authored:
            yield path.parts[-3], kp, authored


def test_flatten_items_reads_label() -> None:
    """單元層：`label` 是現行規格寫子項名字的方式，不能被吃掉。"""
    out = _flatten_items([{"label": "雅加達亞運", "value": "比賽結果是"}])
    assert out[0]["sub_label"] == "雅加達亞運"


def test_flatten_items_keeps_sub_label_and_index_winning() -> None:
    """正向對照：既有兩種寫法的優先序不可以被新的 fallback 改掉。"""
    assert _flatten_items([{"sub_label": "甲", "label": "乙"}])[0]["sub_label"] == "甲"
    assert _flatten_items([{"index": 3, "label": "乙"}])[0]["sub_label"] == "3"


def test_every_authored_sublabel_survives_the_bridge() -> None:
    """全庫層：作者寫了幾個子項名字，畫面上就要出現幾個。

    這條才是真的會抓到東西的那條 —— 手寫 fixture 只涵蓋我想得到的形狀。
    """
    total_authored = 0
    missing: list[tuple[str, str]] = []

    for uid, kp, authored in _lessons_with_sublabels():
        total_authored += len(authored)
        rendered = _rendered_sublabels(keypoints_to_structure_table(kp) or [])
        for name in authored:
            # 巢狀子項的名字會帶序號後綴（`結果` → `結果-1`），那也算畫出來了
            if not any(c == name or c.startswith(f"{name}-") for c in rendered):
                missing.append((uid, name))

    assert total_authored >= EXPECTED_FLOOR, (
        f"只數到 {total_authored} 個子項標題，少於下限 {EXPECTED_FLOOR} —— "
        "這代表這支測試沒掃到課，不是資料變乾淨了"
    )
    assert not missing, (
        f"{len(missing)}/{total_authored} 個子項標題渲染後不見了，"
        f"涉及 {len({u for u, _ in missing})} 課。前 10 筆：{missing[:10]}"
    )
