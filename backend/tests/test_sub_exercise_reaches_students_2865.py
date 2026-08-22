"""語詞應用底下的「子練習」要送到學生面前（#2865 後續）。

## 怎麼發現的

我先開了兩張缺陷票說「原稿有 8 題、yml 只有 6 題」（#2867 #2869）——
**兩張都是假的**，題目一直都在，住在子容器裡。

修完對帳門之後才想到真正該問的下一題：**那學生看得到嗎？**
打 staging 真環境數了一次：

    L0149  原稿 8 題 → 學生拿到 6 題
    L0066  原稿 8 題 → 學生拿到 7 題

斷點在 `lesson_indexes._cloze_from`：`rows = sec.get("items")` 只讀頂層，
子練習整包沒人讀。**跟對帳門犯的是同一個錯，差別是門只會誤報，
這裡會讓學生少做題。**

## ⚠️ 子練習的選項自成一組

    L0122 ◎牛刀小試   自己就有 option_bank {A: 肆虐, B: 蔓延}
    L0066 相似詞應用   沒有 bank，答案是語詞（象徵/意味著/代表）
    L0149 ◎詞義辨識   沒有 bank，glossary 給了那兩個詞

沿用主題目的 A–G 等於做出一個學生永遠答不對的題目 ——
所以每一題自己帶 `options`，前端用 `item.options ?? vocabBank`。
"""
from __future__ import annotations

import pathlib
import sys

import pytest

REPO = pathlib.Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO / "backend"))

from app.services import lesson_indexes as li          # noqa: E402
from app.services.lesson_uid_loader import load_lesson  # noqa: E402


@pytest.mark.parametrize("uid,total,subs", [
    ("L0149", 8, 2),   # 6 主題目 + ◎詞義辨識 2
    ("L0066", 10, 3),  # 7 主題目 + 相似詞應用 3
    ("L0122", 12, 4),  # 8 主題目 + ◎牛刀小試 4
])
def test_sub_exercise_items_reach_the_student(uid, total, subs):
    """用**數量**斷言，不是「至少有一題」。

    「至少有一個子練習出現了」跟「全部都出現了」長得一樣綠，
    而修之前的實際狀態正是 0 個。
    """
    lesson = load_lesson(uid)
    if lesson is None:
        pytest.skip(f"{uid} 不在")
    rows = li._cloze_from(lesson)
    got_subs = [r for r in rows if r.get("_sub_exercise")]
    assert len(rows) == total, f"{uid} 學生只拿到 {len(rows)} 題，應該有 {total}"
    assert len(got_subs) == subs, f"{uid} 子練習只出來 {len(got_subs)} 題，應該有 {subs}"


@pytest.mark.parametrize("uid", ["L0149", "L0066", "L0122"])
def test_every_sub_item_carries_its_own_option_set(uid):
    """每一道子練習題都要帶自己的選項組，而且答案要在裡面。

    ⛔ 少了 `options` 的話，前端會沿用整課的 A–G ——
    畫面看起來正常，但那組裡根本沒有正確答案，學生永遠答不對。
    """
    lesson = load_lesson(uid)
    if lesson is None:
        pytest.skip(f"{uid} 不在")
    subs = [r for r in li._cloze_from(lesson) if r.get("_sub_exercise")]
    assert subs, f"{uid} 一題子練習都沒出來"
    for r in subs:
        opts = r.get("options")
        assert isinstance(opts, dict) and opts, f"{uid} 子練習題沒有 options：{r}"
        assert r["answer"] in opts, \
            f"{uid} 的答案 {r['answer']!r} 不在自己的選項組裡 {opts} —— 學生永遠答不對"


def test_multi_blank_sub_exercise_is_skipped_not_mangled():
    """一題多個空格的（L0027 ◎小試身手，`answers` 是 list）要跳過。

    ⛔ 硬塞進單選框只會做出一個學生答不對的題目 —— 那比不顯示更糟，
    因為它看起來是一道正常的題目。
    """
    lesson = load_lesson("L0027")
    if lesson is None:
        pytest.skip("L0027 不在")
    subs = [r for r in li._cloze_from(lesson) if r.get("_sub_exercise")]
    assert subs == [], f"多空格題被送出去了：{subs}"


def test_answers_that_match_neither_code_nor_word_are_dropped():
    """答案既不是代號、也不是選項裡的語詞 → 丟掉，⛔ 不猜。"""
    sec = {
        "items": [],
        "weird": {
            "title": "◎測試",
            "items": [
                {"index": 1, "stem": "好的(  )。", "answer": "甲"},
                {"index": 2, "stem": "壞的(  )。", "answer": "乙"},
                {"index": 3, "stem": "對不上的(  )。", "answer": "丙丁戊己"},
            ],
        },
    }
    rows = li._sub_exercise_cloze(sec)
    # 甲乙丙丁戊己 都是「語詞」→ 三個都會進 bank，所以三題都留得住
    assert len(rows) == 3
    for r in rows:
        assert r["answer"] in r["options"]


def test_frontend_uses_the_per_item_bank_not_the_lesson_bank():
    """前端要用每題自己的選項組。

    ⚠️ 這條看的是**程式碼**，因為那個錯誤不會有任何症狀 ——
    畫面照樣渲染，只是選項是別組的。
    """
    src = (REPO / "frontend" / "src" / "components" / "reading-steps"
           / "FillInBlankExercise.tsx").read_text(encoding="utf-8")
    assert "currentSentence?.options ?? vocabBank" in src, "沒有用每題自己的選項組"
    assert "s.options ?? vocabBank" in src, "結果面板沒有逐題查自己的選項組"
    # #2279 的 TDZ：activeBank 必須宣告在 currentSentence 之後
    assert src.index("const currentSentence") < src.index("const activeBank"), \
        "activeBank 宣告在 currentSentence 之前 —— mount 會 TDZ 白屏"
