#!/usr/bin/env python3
"""把課次寫進每一課的 `metadata.yml`，讓排序不必再 parse 課碼字串。

為什麼
------
圖書館按 `lesson_uid` 排 —— 那是抽取的流水號，跟課本順序無關。
學生打開圖書館，四年級的第一課是《十秒的背後》（實際是第 10 課），
而第 1 課《贏得喝采的輸家》躺在 `L0011`。

課次一直都在 `grade_code` 裡（`G4-L10` ＝ 年級 4 課次 10），但那是字串，
而且有三種系列：`G4-L1`（一般）、`文-L1`（文言文）、`體-L1`（體育生）。
每個要排序的地方各自 parse 一次，遲早會排得不一樣。

寫入三個欄位
------------
    lesson_no    課次數字（10）
    series       一般 / 文言文 / 體育生
    lesson_seq   排序用的整數，把系列也編進去，一把尺排完全部

`lesson_seq` 的編法：一般課 `年級*1000 + 課次`，文言文 `90000 + 課次`，
體育生 `91000 + 課次` —— 兩個特殊系列排在一般課之後，各自維持自己的順序。

用法：
    python3 scripts/add_lesson_ordering_metadata.py --dry-run
    python3 scripts/add_lesson_ordering_metadata.py
"""
from __future__ import annotations

import argparse
import pathlib
import re
import sys

import yaml

REPO = pathlib.Path(__file__).resolve().parent.parent
LESSONS = REPO / "data" / "lessons"

_CODE = re.compile(r"^(?:G(\d+)|(文|體))-L(\d+)([a-z]?)$")
SERIES = {"文": "文言文", "體": "體育生", None: "一般"}
SERIES_BASE = {"一般": 0, "文言文": 90000, "體育生": 91000}


def parse(code: str) -> tuple[str, int, int] | None:
    """課碼 → (系列, 課次, 排序序號)。"""
    m = _CODE.match(str(code or ""))
    if not m:
        return None
    grade, special, no, suffix = m.groups()
    series = SERIES[special]
    lesson_no = int(no)
    if series == "一般":
        seq = int(grade) * 1000 + lesson_no * 10
    else:
        seq = SERIES_BASE[series] + lesson_no * 10
    # `G8-L06b` 這種同課次的分支排在本課之後
    if suffix:
        seq += ord(suffix) - ord("a") + 1
    return series, lesson_no, seq


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    sys.path.insert(0, str(REPO))
    from app.services.lesson_loader import search_lessons  # noqa: E402

    lessons = search_lessons()
    if len(lessons) < 150:
        raise SystemExit(f"⛔ 只讀到 {len(lessons)} 課，明顯太少")

    written = skipped = 0
    seen_seq: dict[int, str] = {}
    for l in lessons:
        uid = l.get("lesson_uid")
        parsed = parse(l.get("grade_code"))
        if not uid:
            skipped += 1
            continue
        if parsed:
            series, lesson_no, seq = parsed
        else:
            # 課碼解不出課次 → 退回用 UID 排（Young 2026-08-19）。
            # 排在所有有課次的課之後，順序仍然是決定性的 —— 不給它一個位置，
            # 它會落在排序器碰巧放的地方，而那不會有任何徵兆。
            m_uid = re.match(r"^L(\d+)$", str(uid))
            if not m_uid:
                print(f"  ⚠️ {uid} 課碼與 UID 都解不出順序：{l.get('grade_code')!r}")
                skipped += 1
                continue
            series, lesson_no, seq = "一般", None, 99000 + int(m_uid.group(1))
            print(f"  ↩︎ {uid} 沒有課次（code={l.get('grade_code')!r}）→ 依 UID 排在最後")
        if seq in seen_seq:
            # 兩課排到同一格 = 排序會不穩定，而且沒有任何徵兆
            raise SystemExit(
                f"⛔ {uid} 與 {seen_seq[seq]} 的排序序號都是 {seq} —— 課碼有重複，先查清楚"
            )
        seen_seq[seq] = uid

        f = LESSONS / uid / "v3" / "metadata.yml"
        if not f.exists():
            skipped += 1
            continue
        doc = yaml.safe_load(f.read_text(encoding="utf-8")) or {}
        doc["lesson_no"] = lesson_no          # None = 沒有課次，排序退回 UID
        doc["series"] = series
        doc["lesson_seq"] = seq
        written += 1
        if not args.dry_run:
            f.write_text(
                yaml.safe_dump(doc, allow_unicode=True, sort_keys=False, width=200),
                encoding="utf-8",
            )

    print(f"\n  寫入 {written} 課，跳過 {skipped}"
          + ("　※ dry-run" if args.dry_run else ""))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
