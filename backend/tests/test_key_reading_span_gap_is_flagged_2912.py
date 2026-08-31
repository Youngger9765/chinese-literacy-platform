"""念順順的字數對不上時，檔案自己要說「要人看」——不可以無聲出貨。

`extract()` 早就算出 `span_note`（累加結果與學習單累計欄差超過 SPAN_TOLERANCE），
但 2026-08-31 之前 `apply()` 只看 `REVIEW_REASONS[verdict]`，**從來沒讀過 span_note**
→ 19 課對不上的裡面只有 1 課帶標記，其餘 18 課看起來跟完全正確的課一模一樣。

門算出了答案卻沒有人接 —— 跟 #2912 那條線上其他幾次同型。
"""
import glob
import pathlib

import yaml

REPO = pathlib.Path(__file__).resolve().parents[2]
TOLERANCE = 20


def _shipped():
    for f in glob.glob(str(REPO / "backend/data/lessons/L*/v3/*key_reading*.yml")):
        doc = yaml.safe_load(pathlib.Path(f).read_text(encoding="utf-8")) or {}
        kr = doc.get("key_reading") or {}
        passage, target = kr.get("passage") or "", kr.get("printed_counter_last")
        if not passage or not isinstance(target, int):
            continue
        yield pathlib.Path(f).parts[-3], doc, len(passage) - target


def test_every_lesson_that_disagrees_with_the_worksheet_says_so():
    """對不上就要標。⛔ 不是把它修成對 —— 是誠實說「這課要人看」。"""
    silent = sorted(uid for uid, doc, gap in _shipped()
                    if abs(gap) > TOLERANCE and not doc.get("needs_human_review"))
    assert not silent, (
        f"{len(silent)} 課的字數與學習單累計欄差超過 {TOLERANCE} 字卻沒有 "
        f"needs_human_review，會被當成正確的課出貨：{silent[:8]}")


def test_the_flag_says_which_two_numbers_disagree():
    """標記要能讓人不必重跑就知道差在哪 —— 兩個數字都要出現在理由裡。"""
    vague = []
    for uid, doc, gap in _shipped():
        if abs(gap) <= TOLERANCE or not doc.get("needs_human_review"):
            continue
        reason = str(doc.get("review_reason") or "")
        kr = doc["key_reading"]
        if not (str(len(kr["passage"])) in reason
                and str(kr["printed_counter_last"]) in reason):
            vague.append(uid)
    assert not vague, f"標了但沒說是哪兩個數字對不上：{sorted(vague)[:8]}"


def test_the_lessons_that_do_agree_are_not_flagged_for_this():
    """正向對照：對得上的課不可以被這條理由汙染，否則標記變成雜訊沒人看。"""
    noisy = sorted(uid for uid, doc, gap in _shipped()
                   if abs(gap) <= TOLERANCE
                   and "累計欄" in str(doc.get("review_reason") or ""))
    assert not noisy, f"對得上卻被標成字數不符：{noisy[:8]}"


def test_the_gate_is_actually_measuring_something():
    """正向對照：真的有課被量到（全都跳過的話上面三條恆真）。"""
    measured = list(_shipped())
    assert len(measured) >= 140, f"只量到 {len(measured)} 課，量具本身可能壞了"

def test_a_lesson_with_no_counter_at_all_is_not_shipped_silently():
    """沒有累計欄的課會退回單段 —— 那正是 Hans 報的形狀，不能無聲出貨。

    ⚠️ 上面三條只看「有累計欄」的課，所以一課如果連累計欄都沒有，它會從那三條的
    視野裡整個消失。今天 150/150 都有，這條是把那個縫先補起來。
    """
    import glob as _g
    blind = []
    for f in _g.glob(str(REPO / "backend/data/lessons/L*/v3/*key_reading*.yml")):
        doc = yaml.safe_load(pathlib.Path(f).read_text(encoding="utf-8")) or {}
        kr = doc.get("key_reading") or {}
        if not (kr.get("passage") or ""):
            continue
        if isinstance(kr.get("printed_counter_last"), int):
            continue
        if not doc.get("needs_human_review"):
            blind.append(pathlib.Path(f).parts[-3])
    assert not blind, (
        f"{len(blind)} 課沒有學習單累計欄可對，也沒有標記 —— "
        f"它們會以單段長度出貨而沒有人知道：{sorted(blind)[:8]}")
