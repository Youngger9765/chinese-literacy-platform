"""念順順必須是「☞ → 累計字數欄最後一個數字」的範圍，不是只有 ☞ 那一段。(#2912 / #2712)

## 為什麼有這支

2026-08-29 明珠老師透過 Hans 回報：測段落閱讀流暢度需要**至少 300 字**，
學習單上「手指箭頭（☞）是開始，但學生要讀的是講義右方有標字數的**全部段落**」。

她是對的。當時服務端 160 份 key_reading 的 passage 中位數只有 **144 字**，
只有 **4/160** 達到 300 字 —— 因為抽取器把 `end_paragraph` 寫死等於 `start_paragraph`
（`scripts/extract_key_reading_v3.py`，PR #2918）。

## 決定性證據：累計字數欄是從 ☞ 開始算的

Owner 提供的《大自然的氣象小幫手》(L0003) 實體學習單照片：

    ☞ 在第七段，而第七段**第一行**的數字就是 28
        → 不是接續前面六段的大數，所以那欄是從 ☞ 開始累計
    第七段結束在 259
    第八段結束在 392   ← 學生該唸到這裡

所以「最後一個數字」直接就是該唸的字數。L0003 應該是 392 字（段 7–8），
而當時服務的是 259 字（只有段 7）。

⛔ 不要再把它改回「只取一段」。那條規則來自 PR #2918，依據是
`backend/data/key_reading_passages.yml` —— 那是**一版（舊版）**的人工掃描，
134 筆中位數 147 字、只有 7 筆 ≥300 字。它本身就是一段一段的資料，
所以「只取一段」當然對得比較好，但**它驗不到二修學習單改成印跨段累計欄這件事**。
"""

from __future__ import annotations

import pathlib
import statistics

import yaml

LESSONS = pathlib.Path(__file__).resolve().parents[1] / "data" / "lessons"

#: 有實體學習單照片佐證的那一課。段 7–8，392 字。
_PHOTOGRAPHED = ("L0003", 7, 8, 392)


def _files() -> list[pathlib.Path]:
    """兩種檔名都要算 —— #2916 之後是 `key_reading.{slug}.yml`。"""
    return sorted(LESSONS.glob("L*/v3/key_reading.yml")) + sorted(
        LESSONS.glob("L*/v3/key_reading.*.yml")
    )


def _blocks() -> list[dict]:
    out = []
    for f in _files():
        y = yaml.safe_load(f.read_text(encoding="utf-8")) or {}
        out.append(y.get("key_reading") or {})
    return out


def test_the_scan_finds_the_corpus():
    """正向對照。少了這條，下面每一條都會在空清單上通過。"""
    assert len(_files()) >= 100, f"只掃到 {len(_files())} 份 key_reading —— 掃描壞了"


def test_the_photographed_lesson_matches_the_worksheet():
    """L0003：有照片可以逐字核對，所以它是這支的錨點。"""
    uid, s, e, chars = _PHOTOGRAPHED
    d = LESSONS / uid / "v3"
    f = next(iter(sorted(list(d.glob("key_reading.yml")) + list(d.glob("key_reading.*.yml")))), None)
    assert f is not None, f"{uid} 沒有 key_reading"
    kr = (yaml.safe_load(f.read_text(encoding="utf-8")) or {}).get("key_reading") or {}
    assert kr.get("start_paragraph") == s, (
        f"{uid} 的起點應該是第 {s} 段（學習單的 ☞），實際 {kr.get('start_paragraph')}"
    )
    assert kr.get("end_paragraph") == e, (
        f"{uid} 的終點應該是第 {e} 段 —— 學習單的累計字數欄印到 392，"
        f"第七段只到 259。實際 {kr.get('end_paragraph')}"
    )
    got = len(kr.get("passage") or "")
    assert abs(got - chars) <= 5, (
        f"{uid} 應該是 {chars} 字（學習單累計欄的最後一個數字），實際 {got}"
    )


def test_most_lessons_span_more_than_one_paragraph():
    """⛔ 這條是防「end 又被寫死等於 start」。

    那次 regression 的樣態是**全庫 0 課跨段** —— 不是某幾課壞掉，是規則被改掉。
    """
    blocks = [b for b in _blocks() if b.get("start_paragraph") and b.get("end_paragraph")]
    assert len(blocks) >= 100, f"只有 {len(blocks)} 份有段號 —— 掃描壞了"
    multi = [b for b in blocks if b["end_paragraph"] > b["start_paragraph"]]
    assert len(multi) >= 100, (
        f"只有 {len(multi)}/{len(blocks)} 課跨段。念順順要的是「☞ → 累計欄最後一個數字」，"
        "不是只有 ☞ 那一段。end_paragraph 是不是又被寫死等於 start 了？"
    )


def test_passages_are_long_enough_to_time_fluency():
    """明珠老師 2026-08-29：測流暢度需要至少 300 字。

    門檻用**中位數**不用「每一課都要」—— 有些課文本身就短（L0123 的學習單只印到 47），
    要求每一課都 ≥300 會逼人去湊字數，那比抽太少更糟。
    """
    lens = [len(b.get("passage") or "") for b in _blocks()]
    assert lens, "一份 passage 都沒讀到 —— 掃描壞了"
    med = statistics.median(lens)
    assert med >= 300, (
        f"passage 中位數只有 {med:.0f} 字。2026-08-29 那次 regression 是 144 字，"
        "老師因此測不了流暢度（需要至少 300 字）"
    )
    long_enough = sum(1 for x in lens if x >= 300)
    assert long_enough >= 60, (
        f"只有 {long_enough}/{len(lens)} 課 ≥300 字。regression 當時是 4/160"
    )
