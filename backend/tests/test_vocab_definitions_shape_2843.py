"""語詞我最棒的兩個形狀陷阱（#2843，extract-vocab-definitions 的回歸鎖）。

## 陷阱一：有沒有語詞框，決定欄位叫什麼

    143 課  vocabulary_bank 是 list → item 用 `word`（從框裡挑）
      7 課  vocabulary_bank 是 None → item 用 `answer`（沒有框，自己想）

那不是不一致，是**兩種題型**，而且差別決定判分方式：
有框可以做成選擇/拖拉，沒框只能 free_text。統一欄位名會把這個資訊抹掉。

## 陷阱二：一格填兩個詞是正常的

L0003「徵兆、前兆」、L0045「兵來將擋，水來土掩」——
學習單那一格的答案就是兩個詞並列，bank 分開列是因為它列的是可選語詞。

所以「word 一定要在 bank 裡找得到」**不成立**。

⚠️ 但「一律拆逗號」也**不成立** —— 第一版這樣寫，把
`失之毫釐，差之千里`、`麻雀雖小，五臟俱全` 這種**成語內部的逗號**也拆了，
於是把 4 課好資料判成錯。實測：整串命中 1516 筆、真並列 3 筆、對不上 0 筆。

正確判準是**先試整串，整串不中才拆**。
"""
from __future__ import annotations

import pathlib
import re

import pytest
import yaml

REPO_ROOT = pathlib.Path(__file__).resolve().parents[2]
LESSONS = REPO_ROOT / "backend" / "data" / "lessons"

#: 一格裡並列多個詞的分隔符（實測出現過的）
SPLITTERS = re.compile(r"[、，,]")


@pytest.fixture(scope="module")
def bodies() -> list[tuple[str, dict]]:
    out = []
    for path in sorted(LESSONS.glob("L*/v3/vocab_definitions.*.yml")):
        try:
            data = yaml.safe_load(path.read_text(encoding="utf-8")) or {}
        except Exception:
            continue
        body = data.get("vocab_definitions")
        if isinstance(body, dict):
            out.append((path.parent.parent.name, body))
    return out


def test_the_scan_found_lessons(bodies):
    assert len(bodies) >= 140, f"只掃到 {len(bodies)} 課"


def test_field_name_matches_whether_a_word_bank_exists(bodies):
    """🔴 有 bank → word；無 bank → answer。這是兩種題型不是不一致。"""
    offenders = []
    with_bank = without_bank = 0
    for uid, body in bodies:
        has_bank = body.get("vocabulary_bank") is not None
        with_bank += has_bank
        without_bank += not has_bank
        for item in body.get("items") or []:
            if not isinstance(item, dict):
                continue
            # 同一節裡可能夾一題選擇題（L0083 第 9 題「『琢磨』有三種解釋…」）。
            # 它有 stem + options，答案是選項代號不是語詞 —— 那是另一種題型，
            # 不適用「有 bank 就用 word」這條。⛔ 不要把它改成 word，那會弄丟題型。
            if "stem" in item or "options" in item:
                continue
            uses_word = "word" in item
            if uses_word != has_bank:
                offenders.append((uid, item.get("index"), has_bank, sorted(item)))
    # 數量斷言：兩種題型都要還在，任一邊掉到 0 就是有人統一掉了
    assert with_bank >= 140, f"有語詞框的課從 143 掉到 {with_bank}"
    assert without_bank >= 5, (
        f"沒有語詞框的課從 7 掉到 {without_bank} —— 有人把 answer 統一成 word？\n"
        "⛔ 那會抹掉「這課有沒有給語詞框」，而那正是判分方式的差別。"
    )
    assert not offenders, (
        "欄位名跟「有沒有語詞框」對不上：\n"
        + "\n".join(f"  {u} 第 {i} 題 bank={'有' if h else '無'} 欄位={k}"
                    for u, i, h, k in offenders[:10])
    )


def test_multi_word_answers_still_resolve_to_the_bank(bodies):
    """答案並列多詞時，**每一段**都要在 bank 裡。

    ⛔ 不驗「整串在 bank 裡」—— L0003 的「徵兆、前兆」永遠不會整串命中，
    那樣寫會把正常資料判成錯，然後有人來把它「修好」。
    """
    offenders = []
    checked = 0
    for uid, body in bodies:
        bank = body.get("vocabulary_bank")
        if not isinstance(bank, list) or not bank:
            continue
        bank_set = set(bank)
        for item in body.get("items") or []:
            word = isinstance(item, dict) and item.get("word")
            if not word:
                continue
            checked += 1
            if word in bank_set:
                continue   # 整串命中 —— 成語內部本來就有逗號（失之毫釐，差之千里）
            parts = [p.strip() for p in SPLITTERS.split(str(word)) if p.strip()]
            missing = [p for p in parts if p not in bank_set]
            if missing:
                offenders.append((uid, item.get("index"), word, missing))
    assert checked >= 800, f"只檢查到 {checked} 題，掃描壞了"
    assert not offenders, (
        "答案有段落不在語詞框裡：\n"
        + "\n".join(f"  {u} 第 {i} 題 word={w!r} 找不到 {m}" for u, i, w, m in offenders[:10])
    )
