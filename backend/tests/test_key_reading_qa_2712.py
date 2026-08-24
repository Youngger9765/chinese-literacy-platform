"""#2712 — 念順順對帳：學習單自己印的兩個標記，各管一頭。

    ☞ / 指令裡的序數  → 起點
    右緣累計字數，最後一個 → 終點

owner 2026-08-24：「☞ 是 start，最後的數字是 end」。

以前終點沒有依據，抽取器寫 `end: 課文結束` 一路讀到文章結尾。第一課因此
存了 487 字，而學習單只印到 376。

鎖的是**這支 QA 自己不會壞掉**，不是「全部課都必須貼合」——
把一條判斷鎖成必過斷言正是舊 skill L79 犯的錯（讓錯誤看起來是驗證過的）。
"""
from __future__ import annotations

import importlib.util
import pathlib

import pytest

REPO = pathlib.Path(__file__).resolve().parents[2]
_spec = importlib.util.spec_from_file_location("krqa", REPO / "scripts" / "key_reading_qa.py")
krqa = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(krqa)


@pytest.mark.parametrize(
    "paras,expected",
    [
        # 正常的一串累計字數
        (["25", "55", "85", "114", "376"], [25, 55, 85, 114, 376]),
        # 課文裡的數字不會自己成一段 → 不該被撿走
        (["2021年8月1日，小戴在東京奧運", "25", "55"], [25, 55]),
        # 一遇到不遞增就停（後面是表格 / 題號）
        # ⚠️ 這裡一定要用**兩位數以上**。原本寫 1/2/3，它們在遞增檢查之前就被
        # `\d{2,4}` 濾掉了 —— 那條 case 根本沒碰到遞增守衛，mutation 才抓到。
        (["25", "55", "85", "10", "20"], [25, 55, 85]),
        (["25", "55", "85", "1", "2", "3"], [25, 55, 85]),
        # 一位數不算（題號長那樣）
        (["1", "2", "3"], []),
        (["25", "55", "85", "114", "133", "161", "191", "221",
          "250", "280", "309", "339", "369", "376"],
         [25, 55, 85, 114, 133, 161, 191, 221, 250, 280, 309, 339, 369, 376]),
    ],
)
def test_reads_the_printed_counter(paras, expected):
    assert krqa.cumulative_counter(paras) == expected


@pytest.mark.parametrize(
    "instruction,expected",
    [
        ("請用計時器，從指定段落（三☞）開始朗讀，計時1分鐘", "三"),
        ("從指定段落（七）開始朗讀", "七"),
        ("從指定段落（12）開始朗讀", "12"),
        ("請朗讀全文", None),          # 沒印起點就回 None，不猜
        ("", None),
    ],
)
def test_reads_the_printed_start(instruction, expected):
    assert krqa.start_ordinal(instruction) == expected


def test_a_lesson_it_cannot_judge_is_not_a_pass():
    """讀不到累計字數欄要說「無法判斷」，不可以靜靜地當通過。

    這是這支 QA 最容易腐爛的地方：一個判不動就回綠的稽核器，
    比沒有稽核器更糟 —— 它會讓人以為看過了。
    """
    verdict = krqa.audit("L9999-does-not-exist")
    assert verdict["verdict"] == "無法判斷"
    assert verdict["why"], "判不動卻沒給理由"
    assert verdict["verdict"] != "貼合"


def test_the_real_corpus_still_answers():
    """正向對照：這支在真語料上判得動，不是每一課都回「無法判斷」。

    少了這條，上面那條（判不動要說判不動）可以靠「永遠判不動」滿足。
    """
    uids = sorted(p.parts[-3] for p in (REPO / "backend" / "data" / "lessons").glob("L*/v3/key_reading.yml"))
    assert len(uids) > 100, f"只找到 {len(uids)} 課 key_reading.yml，掃描壞了"
    sample = [krqa.audit(u) for u in uids[:12]]
    judged = [r for r in sample if r["verdict"] in ("貼合", "抽太多", "抽太少")]
    if not any(r.get("why", "").startswith("原稿不在") for r in sample):
        assert judged, "12 課全部判不動 —— 對帳邏輯壞了，不是語料的問題"
