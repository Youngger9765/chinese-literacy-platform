#!/usr/bin/env python3
"""把學習單右緣印的累計字數欄，逐筆轉錄進 key_reading yml。

## 為什麼

2026-08-29 明珠老師透過 Hans 回報：測段落閱讀流暢度需要至少 300 字，
學生要讀的是「講義右方有標字數的**全部段落**」。

那欄數字是判斷「該讀到哪」的唯一紙上依據，而全庫 160 份裡只有 30 份轉錄了它，
還散在四個不同的欄位名（`printed_char_marks` / `printed_counter_last` /
`printed_cumulative_chars` / `printed_char_count`）。

⛔ 這支**只做轉錄**，不改 `passage` / `start_paragraph` / `end_paragraph`。
   「該讀到哪」是另一件事（規則層），這裡先把證據存下來 ——
   `test_key_reading_golden_2912.py::test_the_transcribed_worksheet_numbers_are_not_swept_away`
   已經在保護這類欄位不被清理順手刪掉，理由是「刪那些是湮滅證據」。

## 欄位

    printed_char_marks    整條累計字數欄，逐筆（list[int]）——「紙上印了什麼」
    printed_counter_last  上面那條的最後一個數字 —— Owner 要的「max 數字右側」

⚠️ 那欄是**從 ☞ 開始累計**的，不是從文章開頭。決定性證據是 Owner 拍的
《大自然的氣象小幫手》(L0003)：☞ 在第七段，而第七段**第一行**的數字就是 28。

## 跑法

    ln -sfn <有原稿的 checkout>/private private     # 原稿在 private/，gitignored
    python scripts/backfill_printed_char_marks.py            # 只報告
    python scripts/backfill_printed_char_marks.py --apply    # 寫檔
"""

from __future__ import annotations

import argparse
import importlib.util
import pathlib
import sys

import yaml

ROOT = pathlib.Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "scripts"))

_spec = importlib.util.spec_from_file_location("krqa", ROOT / "scripts" / "key_reading_qa.py")
krqa = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(krqa)

LESSONS = ROOT / "backend" / "data" / "lessons"
SOT = ROOT / "private" / "curriculum-source" / "_SOT"


def _key_reading_files() -> list[pathlib.Path]:
    """兩種檔名都要算 —— #2916 之後是 `key_reading.{slug}.yml`。"""
    return sorted(LESSONS.glob("L*/v3/key_reading.yml")) + sorted(
        LESSONS.glob("L*/v3/key_reading.*.yml")
    )


def marks_for(uid: str) -> list[int] | None:
    """那一課的累計字數欄。讀不到就回 None —— ⛔ 不要猜一個合理的填進去。"""
    lp = LESSONS / uid / "v3" / "lesson.yml"
    if not lp.is_file():
        return None
    d = yaml.safe_load(lp.read_text(encoding="utf-8")) or {}
    d = d.get("lesson", d)
    rel = (d.get("source") or {}).get("drive_path")
    if not rel:
        return None
    docx = SOT / rel
    if not docx.is_file():
        return None
    seq = krqa.cumulative_counter(krqa.dw.docx_paragraphs(str(docx)))
    return seq if len(seq) >= krqa.MIN_RUN else None


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--apply", action="store_true", help="寫檔（不加只報告）")
    a = ap.parse_args()

    files = _key_reading_files()
    if not files:
        print("⛔ 一份 key_reading 都沒掃到 —— 掃描壞了，不是沒有資料")
        return 2
    if not SOT.is_dir():
        print(f"⛔ 原稿不在 {SOT} —— 先 `ln -sfn <有原稿的 checkout>/private private`")
        return 2

    wrote = skipped = same = 0
    for f in files:
        uid = f.parts[-3]
        doc = yaml.safe_load(f.read_text(encoding="utf-8")) or {}
        kr = doc.get("key_reading")
        if kr is None:
            skipped += 1
            continue
        seq = marks_for(uid)
        if not seq:
            skipped += 1
            continue
        if kr.get("printed_char_marks") == seq and kr.get("printed_counter_last") == seq[-1]:
            same += 1
            continue
        kr["printed_char_marks"] = seq
        kr["printed_counter_last"] = seq[-1]
        if a.apply:
            f.write_text(yaml.safe_dump(doc, allow_unicode=True, sort_keys=False), encoding="utf-8")
        wrote += 1

    verb = "寫入" if a.apply else "會寫入"
    print(f"  {verb} {wrote} 份 · 已一致 {same} 份 · 讀不到累計欄 {skipped} 份（共 {len(files)}）")
    if not a.apply:
        print("  （只報告。要寫檔加 --apply）")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
