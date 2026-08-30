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

def test_target_is_the_last_number_in_the_margin():
    """判準鎖：target = 累計字數欄的最後一個數字，不扣任何東西。

    ⛔ 2026-08-29 我一度改成「總字數 - ☞ 之前那幾段」（PR #2976），那是錯的。
       錯誤假設：以為累計欄從**文章開頭**算。實際是**從 ☞ 開始算**。

    決定性證據是 Owner 提供的《大自然的氣象小幫手》學習單照片：
      ☞ 在第七段，而第七段**第一行**的數字就是 28 —— 不是接續前面六段的大數。
      第七段結束在 259，我們存的 passage 正好 259 字（完全吻合）。
      第八段結束在 392 ← 學生該唸到這裡。

    所以「最後一個數字」直接就是該唸的字數。扣掉 ☞ 之前的部分會**低估** target，
    讓「抽太少」被誤判成「抽太多」——L0003 就是這樣從「少 133」變成「多 45」。
    """
    src = (REPO / "scripts" / "key_reading_qa.py").read_text(encoding="utf-8")
    assert 'out["target"] = seq[-1]' in src, (
        "target 不是「累計欄最後一個數字」了。改判準前先回去看那張學習單照片 —— "
        "累計欄是從 ☞ 開始算的，不是從文章開頭"
    )
    assert 'seq[-1] - before' not in src, (
        "又把 ☞ 之前的字數扣掉了。那會低估 target，把「抽太少」講成「抽太多」"
    )
    # 正向對照：檔案真的讀到了
    assert len(src) > 2000, "腳本短得不像真的 —— 上面兩條會在空字串上通過"
