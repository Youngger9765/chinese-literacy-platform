"""念順順的規則，code 跟文件不可以講不一樣的話。(#2912)

## 為什麼有這支

2026-08-30 修好抽取器之後，**skill 沒有跟著改** —— `lesson-reading-pipeline`
還寫著「規則：只取指定的那一段」，而 code 已經改成「☞ → 累計字數欄末筆」。
兩者分家的後果不是報錯，是**下一個人照著文件把 code 改回去**
（這條規則已經翻過三次，每次都是照著前一版的理由做的）。

⛔ 這支不驗「規則對不對」——那要靠實體學習單（見 `test_key_reading_golden_2912.py`）。
   這支只驗**同一個規則只有一種說法**，而且 code 與文件都是那一種。

## 這條規則現在是什麼

**☞ 那一段 → 學習單右緣累計字數欄末筆落在的那一段，兩端之間全包。**

三步：① 讀 `printed_counter_last` ② 從 ☞ 往後累加，取**離末筆最近**的停點
③ 差距 > 20 字就標記，不硬湊。
"""

from __future__ import annotations

import pathlib
import re

ROOT = pathlib.Path(__file__).resolve().parents[2]

EXTRACTOR = ROOT / "scripts" / "extract_key_reading_v3.py"
#: 會被下一個人拿來當規格讀的文件。改規則就得一起改，否則這支紅。
RULE_DOCS = (
    ROOT / ".claude/skills/lesson-reading-pipeline/SKILL.md",
    ROOT / ".claude/skills/extract-lesson-multimodal/SKILL.md",
)

#: 舊規則的說法。⚠️ 允許出現在「為什麼推翻」「更正」「~~刪除線~~」的脈絡裡 ——
#: 保留歷史是對的，把它當成現行規則才是錯的。
_OLD_RULE = "只取指定的那一段"
_HISTORY_MARKERS = ("為什麼推翻", "更正", "~~", "舊規則", "2026-08-24")


def test_the_files_are_where_we_think():
    """正向對照。少了這條，下面每一條都會在空字串上通過。"""
    assert EXTRACTOR.is_file(), f"找不到抽取器 {EXTRACTOR}"
    for d in RULE_DOCS:
        assert d.is_file(), f"找不到規格文件 {d}"
        assert len(d.read_text(encoding="utf-8")) > 500, f"{d.name} 短得不像真的"


def test_the_extractor_uses_the_counter():
    """抽取器必須真的在讀累計字數欄的末筆。"""
    src = EXTRACTOR.read_text(encoding="utf-8")
    assert "printed_counter_last" in src, (
        "抽取器沒有讀 `printed_counter_last` —— 那是決定範圍的唯一紙上依據。"
        "沒有它就只剩「只取一段」或「抽到文末」，兩個都錯過"
    )
    assert re.search(r'end_paragraph"?\]?\s*=\s*r\.get\("end_anchor"\)', src), (
        "`end_paragraph` 沒有從算出來的範圍取值。"
        "⛔ 又被寫死等於 start 了嗎？那正是 2026-08-30 那次 regression"
    )


def test_the_extractor_never_hardcodes_end_to_start():
    """⛔ 這條盯的就是那一行 regression。

    `kr["end_paragraph"] = r["anchor"]`（＝start）讓全庫 passage 中位數掉到 144 字，
    老師因此測不了流暢度（需要至少 300 字）。
    """
    src = EXTRACTOR.read_text(encoding="utf-8")
    bad = re.findall(r'^\s*kr\["end_paragraph"\]\s*=\s*r\["anchor"\]\s*$', src, flags=re.M)
    assert not bad, (
        "`end_paragraph` 又被寫死等於 anchor（start）了。"
        "規則是「☞ → 累計字數欄末筆落在的那一段」，不是只取 ☞ 那一段"
    )


def test_the_docs_do_not_state_the_old_rule_as_current():
    """文件不可以還把舊規則當成現行規則。

    ⛔ 這不是禁止提到它 —— 保留歷史（「為什麼推翻」「~~刪除線~~」）是對的，
       那正是防止翻第四次的東西。禁的是**當成現在的規則在陳述**。
    """
    offenders = []
    for d in RULE_DOCS:
        for i, line in enumerate(d.read_text(encoding="utf-8").split("\n"), 1):
            if _OLD_RULE not in line:
                continue
            if any(m in line for m in _HISTORY_MARKERS):
                continue
            offenders.append(f"  {d.name}:{i}  {line.strip()[:70]}")
    assert offenders == [], (
        "文件把舊規則「只取指定的那一段」當成現行規則在講，而 code 已經是"
        "「☞ → 累計字數欄末筆」。下一個人會照文件把 code 改回去：\n"
        + "\n".join(offenders)
    )


def test_the_docs_state_the_new_rule():
    """反過來鎖：文件要真的講得出現在的規則，不是只把舊的刪掉。"""
    missing = []
    for d in RULE_DOCS:
        text = d.read_text(encoding="utf-8")
        if "累計字數欄末筆" not in text and "累計欄末筆" not in text:
            missing.append(d.name)
    assert missing == [], (
        "這些文件沒有講出現行規則（「☞ → 累計字數欄末筆落在的那一段」）—— "
        "只刪掉舊的等於留白，下一個人還是得自己猜：" + ", ".join(missing)
    )
