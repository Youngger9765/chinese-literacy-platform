"""出貨的念順順資料，必須就是抽取器現在會產出的東西。(#2912)

## 為什麼有這支 —— 它擋的是別的鎖擋不到的那一種

已經有的鎖各自擋一種死法：

    test_key_reading_rule_is_stated_once_2912   code 或 skill 被改回舊規則
    test_key_reading_range_restored_2912        資料的**形狀**塌回一段（跨段數、字數）
    test_key_reading_golden_2912                12 課的**逐課**期望值
    test_printed_char_marks_recorded_2912       累計字數欄被清掉

**但沒有一支擋得住「資料被手改成跟抽取器不一致」** ——
那不會報錯、形狀還過得了、golden 那 12 課也可能剛好沒被動到。
下一次有人重跑抽取器，那些手改就被默默蓋掉；或者反過來，
有人改了抽取器卻沒重生資料，線上服務的還是舊的。

⛔ 這一族的病在這個 repo 反覆發生過：「抽對了卻沒人接」「門建了沒插電」
   「改了一個沒被執行的檔案」。共通形狀都是**兩份東西該一致卻沒有人在比**。

## 為什麼這支跑得動（不需要 DOCX）

抽取器決定範圍時讀的是 yml 裡的 `printed_counter_last`（學習單累計字數欄的末筆，
#2912 已轉錄），不是原稿。實測在沒有 `private/` 的環境下
L0003 仍算出段 7–8 / 392 字（與 Owner 拍的實體學習單一致）。

## 不一致時怎麼辦

    python scripts/extract_key_reading_v3.py            # 先看報告
    python scripts/extract_key_reading_v3.py --apply    # 確認後重生

⛔ 不要改這支測試讓它綠 —— 那等於把「資料與抽取器分家」變成常態。
"""

from __future__ import annotations

import importlib.util
import pathlib
import sys

import yaml

ROOT = pathlib.Path(__file__).resolve().parents[2]
LESSONS = ROOT / "backend" / "data" / "lessons"

_spec = importlib.util.spec_from_file_location(
    "ekr", ROOT / "scripts" / "extract_key_reading_v3.py"
)
ekr = importlib.util.module_from_spec(_spec)
sys.modules["ekr"] = ekr
_spec.loader.exec_module(ekr)

#: 抽取器**刻意不出貨**的那些狀態（文言文唸原文、解不出段號…）。
#: 這些課的資料不由抽取器決定，所以不比。
_WITHHELD = {
    "empty", "no_version_dir", "no_key_reading", "no_body", "no_anchor",
    "whole_text_reading", "anchor_out_of_range", "implausible_length",
    "short_marked_paragraph", "unnumbered_tail_disputed",
}


def _uids() -> list[str]:
    return sorted({p.parts[-3] for p in LESSONS.glob("L*/v3/key_reading*.yml")})


def _shipped(uid: str) -> list[dict]:
    d = LESSONS / uid / "v3"
    out = []
    for f in sorted(list(d.glob("key_reading.yml")) + list(d.glob("key_reading.*.yml"))):
        out.append((yaml.safe_load(f.read_text(encoding="utf-8")) or {}).get("key_reading") or {})
    return out


def test_the_extractor_loads_and_produces_something():
    """正向對照。抽取器 import 不起來、或一課都算不出來的話，
    下面那條會在空清單上通過 —— 那比不一致更糟（看起來全綠）。"""
    uids = _uids()
    assert len(uids) >= 100, f"只掃到 {len(uids)} 課 —— 掃描壞了"
    got = [u for u in uids[:20] if (ekr.extract(u) or {}).get("passage")]
    assert len(got) >= 10, (
        f"前 20 課裡只有 {len(got)} 課算得出 passage —— 抽取器在這個環境跑不動。"
        "⚠️ 它決定範圍讀的是 yml 的 printed_counter_last，不需要 DOCX；"
        "跑不動代表那個欄位被清掉了，或 import 失敗"
    )


def test_shipped_data_is_what_the_extractor_produces_now():
    """逐課比：出貨的 start/end/passage == 抽取器現在算出來的。

    ⛔ 這是**唯一**一支在比「資料」與「抽取器」的鎖。少了它，兩邊可以無聲分家，
       而分家的那一刻沒有任何症狀 —— 下一次重跑才會發現，那時已經蓋掉了。
    """
    wrong = []
    for uid in _uids():
        r = ekr.extract(uid) or {}
        if r.get("verdict") in _WITHHELD or not r.get("passage"):
            continue
        want = (r.get("anchor"), r.get("end_anchor"), r["passage"].strip())
        for kr in _shipped(uid):
            got = (kr.get("start_paragraph"), kr.get("end_paragraph"),
                   (kr.get("passage") or "").strip())
            if got[:2] == want[:2] and got[2] == want[2]:
                break
        else:
            shipped = _shipped(uid)
            g = shipped[0] if shipped else {}
            wrong.append(
                f"  {uid}: 抽取器算 段{want[0]}–{want[1]}/{len(want[2])}字，"
                f"出貨的是 段{g.get('start_paragraph')}–{g.get('end_paragraph')}/"
                f"{len(g.get('passage') or '')}字"
            )
    assert wrong == [], (
        f"出貨資料與抽取器不一致（{len(wrong)} 課）—— 要嘛有人手改了資料、"
        "要嘛改了抽取器沒重生。重生：`python scripts/extract_key_reading_v3.py --apply`\n"
        + "\n".join(wrong[:15])
        + ("\n  …還有更多" if len(wrong) > 15 else "")
    )
