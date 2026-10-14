#!/usr/bin/env python3
"""注音挑戰出題模組 —— 每課可出幾題的報告 (#3551)。

用法：
    cd backend && python3 scripts/report_zhuyin_challenge.py

印出每一課的題數，最後印總題數與平均。不碰 DB，純讀 zhuyin.json +
font_readings.json + font_slot_readings.json，跟 generate_zhuyin_questions
本身一樣是唯讀操作。
"""
from __future__ import annotations

import sys
from pathlib import Path

_BACKEND = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(_BACKEND))

from app.services.zhuyin_challenge import generate_zhuyin_questions  # noqa: E402

LESSONS = _BACKEND / "data" / "lessons"


def _lesson_uids() -> list[str]:
    out = []
    for p in sorted(LESSONS.iterdir()):
        if not p.is_dir():
            continue
        if not (p.name.startswith("L") and p.name[1:].isdigit()):
            continue
        if any(c.is_dir() and (c / "zhuyin.json").is_file() for c in p.iterdir()):
            out.append(p.name)
    return out


def main() -> int:
    uids = _lesson_uids()
    total = 0
    zero_lessons = []
    counts = []
    for uid in uids:
        qs = generate_zhuyin_questions(uid, seed=0)
        n = len(qs)
        counts.append((uid, n))
        total += n
        if n == 0:
            zero_lessons.append(uid)
        print(uid + "\t" + str(n))

    print("")
    print("lessons scanned: " + str(len(uids)))
    print("total questions: " + str(total))
    if uids:
        print("average per lesson: " + str(round(total / len(uids), 2)))
    print("lessons with zero questions: " + str(zero_lessons))
    counts.sort(key=lambda row: row[1])
    print("lowest 5: " + str(counts[:5]))
    print("highest 5: " + str(counts[-5:]))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
