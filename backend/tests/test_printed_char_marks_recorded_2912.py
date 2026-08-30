"""學習單右緣印的累計字數欄，必須逐筆留在 yml 裡。(#2912)

## 為什麼

那欄數字是判斷「學生該讀到哪」的**唯一紙上依據**。2026-08-29 明珠老師透過 Hans
回報：測段落閱讀流暢度需要至少 300 字，學生要讀的是「講義右方有標字數的**全部段落**」。

在此之前全庫 160 份只有 30 份轉錄了它，還散在四個不同欄位名。

⚠️ 那欄是**從 ☞ 開始累計**的，不是從文章開頭。決定性證據是 Owner 拍的
《大自然的氣象小幫手》(L0003) 實體學習單：☞ 在第七段，而第七段**第一行**的數字就是 28
（若從文章開頭算，第七段第一行不可能是 28）。整條是
`[28, 58, 88, 118, 148, 178, 208, 237, 259, 287, 317, 347, 376, 392]` ——
跟照片逐筆吻合。

⛔ 這支**不主張**「該讀到哪」——那是規則層的事。這裡只鎖「證據要在」。
   既有的 `test_key_reading_golden_2912.py::test_the_transcribed_worksheet_numbers_are_not_swept_away`
   已經在保護這類欄位不被清理順手刪掉，理由是「刪那些是湮滅證據」；這支是它的正面版：
   不只是「不准刪」，而是「本來就該有」。

重建：`python scripts/backfill_printed_char_marks.py --apply`（需要 `private/` 原稿）。
"""

from __future__ import annotations

import pathlib

import yaml

LESSONS = pathlib.Path(__file__).resolve().parents[1] / "data" / "lessons"

#: 有實體學習單照片可以逐筆核對的那一課。
_PHOTOGRAPHED_UID = "L0003"
_PHOTOGRAPHED_MARKS = [28, 58, 88, 118, 148, 178, 208, 237, 259, 287, 317, 347, 376, 392]


def _files() -> list[pathlib.Path]:
    """兩種檔名都要算 —— #2916 之後是 `key_reading.{slug}.yml`。"""
    return sorted(LESSONS.glob("L*/v3/key_reading.yml")) + sorted(
        LESSONS.glob("L*/v3/key_reading.*.yml")
    )


def _kr(f: pathlib.Path) -> dict:
    return (yaml.safe_load(f.read_text(encoding="utf-8")) or {}).get("key_reading") or {}


def test_the_sweep_finds_the_corpus():
    """正向對照。少了這條，下面每一條都會在空清單上通過。"""
    assert len(_files()) >= 100, f"只掃到 {len(_files())} 份 key_reading —— 掃描壞了"


def test_the_photographed_lesson_matches_the_paper():
    """L0003 有照片，所以它是這支的錨點 —— 逐筆比，不是只比最後一個。"""
    d = LESSONS / _PHOTOGRAPHED_UID / "v3"
    f = next(iter(sorted(list(d.glob("key_reading.yml")) + list(d.glob("key_reading.*.yml")))), None)
    assert f is not None, f"{_PHOTOGRAPHED_UID} 沒有 key_reading"
    kr = _kr(f)
    assert kr.get("printed_char_marks") == _PHOTOGRAPHED_MARKS, (
        f"{_PHOTOGRAPHED_UID} 的累計字數欄跟照片對不上。\n"
        f"  照片: {_PHOTOGRAPHED_MARKS}\n  檔案: {kr.get('printed_char_marks')}"
    )
    assert kr.get("printed_counter_last") == _PHOTOGRAPHED_MARKS[-1], (
        "printed_counter_last 應該是整條的最後一個數字"
    )


def test_most_lessons_carry_the_marks():
    """廣度。⛔ 這條防的是「有人清資料時把它整批掃掉」。

    門檻不用「每一課都要」——有 10 課的原稿讀不到累計欄（`MIN_RUN` 沒到），
    那是刻意不猜，不是漏做。
    """
    files = _files()
    have = [f for f in files if _kr(f).get("printed_char_marks")]
    assert len(have) >= 120, (
        f"只有 {len(have)}/{len(files)} 份留著累計字數欄。"
        "那是判斷『學生該讀到哪』的唯一紙上依據 —— 沒有它就只能重新去翻原稿"
    )


def test_the_last_number_is_consistent_with_the_list():
    """`printed_counter_last` 必須真的是那條的最後一個 —— 不是另外填的數字。"""
    wrong = []
    for f in _files():
        kr = _kr(f)
        marks, last = kr.get("printed_char_marks"), kr.get("printed_counter_last")
        if not marks or last is None:
            continue
        if last != marks[-1]:
            wrong.append(f"  {f.parts[-3]}: last={last} 但整條最後一個是 {marks[-1]}")
    assert wrong == [], "printed_counter_last 跟整條對不上：\n" + "\n".join(wrong)


def test_the_marks_increase():
    """累計欄必須遞增 —— 不遞增代表讀錯了（抓到別欄的數字）。"""
    wrong = []
    for f in _files():
        marks = _kr(f).get("printed_char_marks")
        if not marks or len(marks) < 2:
            continue
        if any(b <= a for a, b in zip(marks, marks[1:])):
            wrong.append(f"  {f.parts[-3]}: {marks}")
    assert wrong == [], (
        "累計字數欄不是遞增的 —— 多半是抓到別欄的數字，不是原稿真的這樣印：\n"
        + "\n".join(wrong)
    )
