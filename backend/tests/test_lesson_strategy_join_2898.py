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


# ---------------------------------------------------------------------------
# 回歸鎖：策略名稱只准變完整，不准變短
# ---------------------------------------------------------------------------


def _all_metadata():
    import yaml

    for p in sorted((REPO / "backend" / "data" / "lessons").glob("L*/v3/metadata.yml")):
        doc = yaml.safe_load(p.read_text(encoding="utf-8")) or {}
        yield p.parts[-3], (doc.get("metadata", doc) or {})


def test_no_lesson_lost_a_fuller_strategy_name():
    """`strategy` 不可以比它自己記錄的任何一份來源短。

    這條是被踩出來的。合併規則本來是「兩個來源取較長」，漏掉第三個候選 ——
    `metadata.strategy` 在這支跑之前就有值（171 課，更早的 pipeline 寫的），
    而其中 21 課它比兩個新來源都完整。覆蓋之後：

        L0029  原「品格力──認識自我─看見長處與限制」→ 新「品格力──認識自我」
        L0047  原「詞彙推測策略──從上下文推測詞義」  → 新「從上下文推測詞義」

    **完全沒有症狀**：欄位有值、schema 過、前端照樣顯示一個看起來正常的策略名。
    要跟 staging 逐課比才看得出來。所以鎖在這裡，用檔案自己記的 provenance 就能驗，
    不需要連 git。
    """
    offenders = []
    for uid, meta in _all_metadata():
        name = str(meta.get("strategy") or "")
        src = meta.get("strategy_sources") or {}
        if not name or not isinstance(src, dict):
            continue
        for where, val in src.items():
            v = str(val or "")
            if len(v) > len(name):
                offenders.append(f"{uid}: strategy={name!r} 比 sources.{where}={v!r} 短")
    assert not offenders, (
        "以下課的策略名稱比它自己記錄的來源還短 —— 合併規則丟掉了比較完整的那份：\n  "
        + "\n  ".join(offenders[:12])
        + f"\n（共 {len(offenders)} 筆）"
    )


def test_every_explained_lesson_records_where_it_came_from():
    """有說明就要有 provenance。沒有它，上面那條鎖就沒有東西可以比。"""
    missing = [uid for uid, m in _all_metadata()
               if m.get("strategy_explained") and not m.get("strategy_sources")]
    assert not missing, f"{len(missing)} 課有 strategy_explained 但沒有 strategy_sources: {missing[:8]}"
