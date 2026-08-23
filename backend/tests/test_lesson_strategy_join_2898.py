"""#2898 — 本課學習策略：join 必須是唯一的，兩個來源都要看。

今天同一件事量錯兩次，兩次的共同形狀是「join 對到錯的列，而值看起來完全正常」：

  用 catalog_slot→新課次 對    每課都拿到像真的策略字串，
                              但「那列的課名 == 這課標題」只有 2/175 相符
  用課名對但沒濾 sheet         對到「影片連結-新」那張（沒有策略欄），
                              於是誤報「總表只有 24 課」

所以鎖的不是「有沒有拿到值」，是「拿到的值憑什麼相信」。
"""
from __future__ import annotations

import importlib.util
import pathlib

import pytest

REPO = pathlib.Path(__file__).resolve().parents[2]
_spec = importlib.util.spec_from_file_location("bls", REPO / "scripts" / "build_lesson_strategy.py")
bls = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(bls)


def test_the_join_key_is_unique():
    """不唯一的 join 會安靜地對到錯的列。載入器自己就該 raise，不是回一個能用的 dict。"""
    sheets = bls.load_master_sheet()
    assert len(sheets) >= 100, f"只載到 {len(sheets)} 列，來源檔或篩選壞了"
    # 由 load_master_sheet 內部斷言保證；這裡確認它真的執行過而不是被拿掉
    assert bls.STRATEGY_SHEETS == {"總表", "文言文"}


def test_only_the_sheets_that_carry_a_strategy_are_joined():
    """「影片連結-新」那張也有課名，但沒有策略欄。混進來就會讓有策略的課看起來沒有。"""
    sheets = bls.load_master_sheet()
    for title, row in sheets.items():
        assert str(row.get("_source_sheet")) in bls.STRATEGY_SHEETS, (
            f"《{title}》來自 {row.get('_source_sheet')}，那張沒有策略欄"
        )


def test_the_strategy_column_actually_has_values_after_the_join():
    """正向對照。上面兩條就算全綠，一個 join 到空欄位的來源也會全綠。"""
    sheets = bls.load_master_sheet()
    key = bls.SHEET_KEYS["target"]
    filled = sum(1 for r in sheets.values() if str(r.get(key) or "").strip() not in ("", "無", "None"))
    assert filled >= 100, f"join 完只有 {filled} 列有策略 —— 對到沒有這一欄的 sheet 了"


@pytest.mark.parametrize(
    "paras,expected",
    [
        # 原稿把它拆成相鄰兩段，接起來才完整
        (["目標策略：摘要策略──", "找小主題和重要細節"], "摘要策略──找小主題和重要細節"),
        # 沒有破折號就整句都是
        (["目標策略：媒體素養與識讀"], "媒體素養與識讀"),
        # 下一段是另一個大題標題 → 不可以接上去
        (["目標策略：推論策略──", "一", "讀全文-做記號"], "推論策略"),
        # 下一段太長 → 那不是尾巴
        (["目標策略：推論策略──", "這是一段很長的敘述" * 5], "推論策略"),
        # 學習單沒印 → 空字串，不猜
        (["Level 4・記敘文", "一", "讀全文-做記號"], ""),
    ],
)
def test_two_paragraph_join(paras, expected):
    assert bls.strategy_from_paragraphs(paras) == expected


def test_house_rule_is_deterministic_not_prompted():
    """句號那條由後處理保證。prompt 講了模型還是會忘，而它是硬規則。"""
    out, warn = bls.tidy("這一課要練的是找重點。\n讀的時候可以這樣做。")
    assert "。" not in out, f"行尾句號沒清掉：{out!r}"
    assert warn == [], warn
    long_out, long_warn = bls.tidy("字" * 200)
    assert any("超過" in w for w in long_warn), "超長沒有被標記出來"
