#!/usr/bin/env python3
"""measure_spotlight_lesson_content.py — 全庫聚光燈：legacy vs lesson_content 對照表。

每一課列出：原稿頂層 block 數（legacy BlockSequenceRenderer 畫的就是這些）、adapter
產出的 block 數與題數、有沒有 block 沒被轉過去（dropped + reason）、能不能通過 Lesson
驗證，以及最後會不會被 loader 供應（= 切換到新渲染器）。

跟 loader 走同一條路（`lesson_content_loader.get_lesson_content`），所以這裡說「可切換」
的課，就是 API 真的會回 lesson_content 的課。

    cd backend && PYTHONPATH=. .venv/bin/python ../scripts/measure_spotlight_lesson_content.py
    ... --json out.json          # 每課明細
    ... --lesson L0168 --dump    # 印出一課的產出
"""
from __future__ import annotations

import argparse
import collections
import copy
import json
import logging
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "backend"))

logging.disable(logging.CRITICAL)

from app.services import lesson_content_loader as L  # noqa: E402
from app.services import spotlight_to_lesson_content as A  # noqa: E402
from app.services.lesson_loader import get_all_lessons  # noqa: E402


def measure(lesson: dict) -> dict:
    spot = lesson["spotlight_v2"]
    row = {
        "uid": lesson.get("lesson_uid"),
        "id": lesson.get("id"),
        "code": lesson.get("lesson_code"),
        "legacy_blocks": len(spot.get("blocks") or []),
    }
    cov = A.Coverage()
    try:
        d = A.assemble_lesson(copy.deepcopy(spot), {}, A.GapLog(), False,
                              identity=lesson.get("lesson_uid"),
                              lesson_code=lesson.get("lesson_code"), coverage=cov)
        d["title"] = lesson.get("title") or d.get("title")
        les = A.to_lesson(d)
        blocks = les.model_dump(mode="json")["blocks"]
        row["blocks"] = len(blocks)
        row["steps"] = sum(len(b["question"].get("steps") or [b]) for b in blocks if b["type"] == "exercise")
        row["valid"] = True
    except Exception as e:  # noqa: BLE001
        row["blocks"] = row["steps"] = None
        row["valid"] = False
        row["error"] = type(e).__name__ + ": " + str(e).split("\n")[0][:120]
    row["consumed"] = len(cov.consumed)
    row["fallback"] = cov.fallback
    row["dropped"] = cov.dropped
    row["served"] = L.get_lesson_content(lesson) is not None
    return row


def main(argv=None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--json")
    ap.add_argument("--lesson")
    ap.add_argument("--dump", action="store_true")
    args = ap.parse_args(argv)

    L._reset_caches_for_test()
    lessons = [l for l in get_all_lessons() if isinstance(l.get("spotlight_v2"), dict) and l["spotlight_v2"]]
    if args.lesson:
        lessons = [l for l in lessons if args.lesson in (l.get("lesson_uid"), l.get("lesson_code"))]
    rows = [measure(l) for l in lessons]

    if args.dump and args.lesson and lessons:
        print(json.dumps(L.get_lesson_content(lessons[0]), ensure_ascii=False, indent=1))

    served = [r for r in rows if r["served"]]
    invalid = [r for r in rows if not r["valid"]]
    blocked_by = collections.Counter()
    drops_by = collections.Counter()
    for r in rows:
        for reason in {d["reason"] for d in r["dropped"]}:
            blocked_by[reason] += 1
        for d in r["dropped"]:
            drops_by[f'{d["type"]}:{d["reason"]}'] += 1
    only_reason = collections.Counter(
        next(iter({d["reason"] for d in r["dropped"]})) for r in rows
        if len({d["reason"] for d in r["dropped"]}) == 1 and r["valid"]
    )

    with_generic = [r for r in served if r["fallback"]]
    print(f"lessons with spotlight_v2 : {len(rows)}")
    print(f"served (switchable)       : {len(served)}")
    print(f"  of which use generic    : {len(with_generic)}  (read-only blocks: {sum(len(r['fallback']) for r in with_generic)})")
    gen_by: dict[str, set] = collections.defaultdict(set)
    for r in with_generic:
        for d in r["fallback"]:
            gen_by[f"{d['type']}:{d['reason']}"].add(r["uid"])
    for k, uids in sorted(gen_by.items(), key=lambda kv: -len(kv[1])):
        print(f"     {k}   ({', '.join(sorted(uids))})")
    print(f"validation failures       : {len(invalid)}")
    for r in invalid[:8]:
        print(f"   {r['uid']}: {r['error']}")
    print("lessons blocked, by reason (a lesson can have several):")
    for k, v in blocked_by.most_common():
        print(f"   {v:>4}  {k}   (only blocker for {only_reason.get(k, 0)})")
    print("dropped source blocks, by type:reason:")
    for k, v in drops_by.most_common(20):
        print(f"   {v:>4}  {k}")
    if served:
        import statistics as st
        print(f"served: median legacy blocks {st.median(r['legacy_blocks'] for r in served)}"
              f" → produced blocks {st.median(r['blocks'] for r in served)},"
              f" median steps {st.median(r['steps'] for r in served)}")
    if args.json:
        Path(args.json).write_text(json.dumps(rows, ensure_ascii=False, indent=1), encoding="utf-8")
    return 0


if __name__ == "__main__":
    sys.exit(main())
