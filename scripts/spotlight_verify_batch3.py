#!/usr/bin/env python
"""Post-deploy calibrated-judge gate for batch-3 (#2397):
  - G5-L12 / G7-L26: newly recovered (refined-ratchet) → expect faithful
  - G8-L11 蝴蝶蘭: was corrupted by the G8-L14 conversion (showed 石虎); the
    revert should restore 科學探究法 → expect faithful (confirms the fix on staging)
  - G7-L2 澳洲: the real pilot lesson (batch2 gate mislabeled story 1041=G5-L14)
    → judge it properly, expect faithful

Usage: env -u GOOGLE_APPLICATION_CREDENTIALS python scripts/spotlight_verify_batch3.py
"""
import os
os.environ.pop("GOOGLE_APPLICATION_CREDENTIALS", None)
import sys
import time
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO_ROOT))
sys.path.insert(0, str(REPO_ROOT / "backend"))
sys.path.insert(0, str(REPO_ROOT / "scripts"))

from spotlight_vision_judge import Browse, browse_login, render_and_judge  # noqa: E402
from app.services.lesson_loader import get_lesson_by_code  # noqa: E402

SHOTS = REPO_ROOT / "qa" / "content-evidence" / "vision-judge-grade-map" / "shots-batch3"
SHOTS.mkdir(parents=True, exist_ok=True)

CODES = [
    ("G5-L12", "六塊肌六塊雞 [recovered→faithful]"),
    ("G7-L26", "小米酒 [recovered→faithful]"),
    ("G8-L11", "蝴蝶蘭 [was corrupted→should be RESTORED to 科學探究法]"),
    ("G7-L2", "澳洲 用表格整理 [pilot, re-judge]"),
]


def main() -> int:
    targets = []
    for code, label in CODES:
        l = get_lesson_by_code(code)
        if l and l.get("id"):
            targets.append((int(l["id"]), code, label, l.get("title", "")))
        else:
            print(f"{code}: not found", file=sys.stderr)
    b = Browse(); b.restart(); time.sleep(2)
    if not browse_login(b):
        print("FATAL login", file=sys.stderr); return 2
    print("demo login OK", flush=True)
    cross = []
    for sid, code, label, title in targets:
        try:
            j = render_and_judge(b, sid, "reading-strategy", SHOTS); v = j.get("verdict", "err")
        except Exception as e:
            v = f"err:{e}"; j = {}
        mark = "✅" if v == "faithful" else ("❌ CROSS" if v == "cross_lesson" else f"⚠️ {v}")
        if v == "cross_lesson":
            cross.append(code)
        print(f"[{sid}] {code} {title[:14]} {label}: {v} {mark}", flush=True)
        print(f"     {(j.get('reasoning','') or '')[:160]}", flush=True)
    print(f"\n{'ALL FAITHFUL ✅' if not cross else 'CROSS: ' + ', '.join(cross)}", flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
