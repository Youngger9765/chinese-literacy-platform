"""`needs_human_review` 的家在文件頂層，巢狀那份誰都看不到（#2919）。

L0139 的 `key_reading.cffhh.yml` 裡面寫著：

    key_reading:
      needs_human_review: true      ← 巢狀，讀取契約看不到
      passage: （393 字）
    extraction_check:
      verdict: ok                   ← 而它其實是對的

三件事同時成立：**旗標在錯的層、內容其實沒問題、而且沒有人會發現**。
那是舊版抽取器留下的殘骸 —— 新版把旗標寫在頂層，`apply()` 也只 pop 頂層那份。

⛔ **只清 `needs_human_review` / `review_reason` 這兩個。**
   `char_marks_note` / `review_reason_note` 是人手寫的分析（30 課），
   例如「右緣累計字數只印到 400，p2 之後那一欄是空的 —— 原稿如此，不是漏抽」。
   我第一版連它們一起 pop，一口氣刪掉 178 行證據才發現 —— 那正是
   `docs/pdca/2026-08-key-reading-range.md` 裡「刪證據 ≠ 消除矛盾」那條。
"""
import glob
import pathlib

import yaml

REPO = pathlib.Path(__file__).resolve().parents[2]
FILES = sorted(glob.glob(str(REPO / "backend/data/lessons/L*/v3/*key_reading*.yml")))
#: 有頂層的家，巢狀那份是殘骸
MISPLACED = ("needs_human_review", "review_reason")
#: 人手寫的分析，⛔ 不准當殘骸清掉
KEEP = ("char_marks_note", "review_reason_note")


def _docs():
    for f in FILES:
        yield pathlib.Path(f).parts[-3], yaml.safe_load(pathlib.Path(f).read_text(encoding="utf-8")) or {}


def test_the_flag_is_never_nested_inside_key_reading():
    """⛔ 巢狀的旗標＝寫了等於沒寫（讀取契約只看頂層）。"""
    bad = sorted(f"{uid}.{k}" for uid, d in _docs()
                 for k in MISPLACED if k in (d.get("key_reading") or {}))
    assert not bad, (
        f"這些旗標寫在 key_reading 裡面，讀取契約看不到：{bad}\n"
        "→ 家在文件頂層。重跑 scripts/extract_key_reading_v3.py --apply")


def test_the_handwritten_notes_survive():
    """⛔ 正向對照：清殘骸不可以順手把人寫的分析一起刪掉。

    少了這條，把整個 key_reading 清空也會讓上面那條變綠。
    """
    have = sum(1 for _, d in _docs()
               if any(k in (d.get("key_reading") or {}) for k in KEEP))
    assert have >= 25, (
        f"只剩 {have} 課帶著人手寫的分析（char_marks_note / review_reason_note）—— "
        "那是 30 課的證據，不是殘骸")


def test_the_top_level_flag_still_works():
    """正向對照之二：頂層那份要還在，否則「巢狀 0」可能是整個旗標都沒了。"""
    top = sum(1 for _, d in _docs() if d.get("needs_human_review"))
    assert top >= 10, f"頂層只有 {top} 課帶旗標 —— 標記機制可能整個掉了"


def test_there_are_files_to_scan():
    assert len(FILES) >= 140, f"只掃到 {len(FILES)} 個檔"
