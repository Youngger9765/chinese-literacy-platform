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
    # ⚠️ #2916 之後檔名是 `key_reading.{slug}.yml`；兩種都要算。
    #    這條下限斷言就是為了抓「掃描壞了」跟「真的沒有」長得一樣的情況 ——
    #    2026-08-28 它真的抓到了（只寫無 slug 的名字 → 0 課）。
    root = REPO / "backend" / "data" / "lessons"
    uids = sorted({p.parts[-3] for p in
                   list(root.glob("L*/v3/key_reading.yml")) + list(root.glob("L*/v3/key_reading.*.yml"))})
    assert len(uids) > 100, f"只找到 {len(uids)} 課 key_reading yml，掃描壞了"
    sample = [krqa.audit(u) for u in uids[:12]]
    judged = [r for r in sample if r["verdict"] in ("貼合", "抽太多", "抽太少")]
    if not any(r.get("why", "").startswith("原稿不在") for r in sample):
        assert judged, "12 課全部判不動 —— 對帳邏輯壞了，不是語料的問題"

def test_target_is_start_to_end_not_whole_article():
    """判準鎖：target 必須扣掉 ☞ 之前的字數。

    2026-08-29：一度把 target 定成「累計字數欄最後一個數字」＝整篇總字數，
    於是 157 課裡 145 課判「抽太少」，看起來像判準錯了。實際是少扣了 ☞ 之前那幾段。

    扣掉之後兩把獨立的尺互相印證：
      【☞→文末】  中位數 303（2026-07-20 專家審查定的規格是 300–400）
      【現在存的】中位數 148
    所以判準是對的，錯的是資料（`end_paragraph == start_paragraph` 150/160）。

    ⛔ 這條防的是「有人把 target 改回 seq[-1]」—— 那會讓對帳整批失真，
       而且失真的方向是「全部都抽太少」，看起來像內容出事，其實是尺出事。
    """
    src = (REPO / "scripts" / "key_reading_qa.py").read_text(encoding="utf-8")
    assert 'out["target"] = seq[-1] - before' in src, (
        "target 不再是「☞ 到文末」了。改判準要連同這條鎖與腳本檔頭的說明一起更新"
    )
    assert 'out["article_total"] = seq[-1]' in src, (
        "整篇總字數要另外留一欄 —— 它有用，只是不能拿來當 target"
    )
    # 正向對照：檔案真的讀到了
    assert len(src) > 2000, "腳本短得不像真的 —— 上面兩條會在空字串上通過"
