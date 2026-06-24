#!/usr/bin/env python
"""Post-deploy calibrated-judge faithfulness gate for the batch-2 repaired
lessons (#2397). Runs the (now calibrated) vision judge on each repaired lesson;
faithful → keep, cross_lesson → must revert that lesson's conversion.

Usage: env -u GOOGLE_APPLICATION_CREDENTIALS python scripts/spotlight_verify_batch2.py
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

SHOTS = REPO_ROOT / "qa" / "content-evidence" / "vision-judge-grade-map" / "shots-batch2"
SHOTS.mkdir(parents=True, exist_ok=True)

# story_id, code (10 repaired lessons; G6-L2/G8-L14/G9-L3 were heuristic-uncertain)
TARGETS = [
    (1041, "G7-L2 (pilot)"),
    (None, "G6-L17"), (None, "G6-L2*"), (None, "G7-L1"), (None, "G7-L18"),
    (None, "G7-L3"), (None, "G7-L4"), (None, "G8-L14*"), (None, "G9-L3*"), (None, "G9-L4"),
]
# resolve codes → story_id via loader
from app.services.lesson_loader import get_lesson_by_code  # noqa: E402
RESOLVED = []
for sid, label in TARGETS:
    code = label.split()[0].rstrip("*")
    if sid is None:
        l = get_lesson_by_code(code)
        sid = l.get("id") if l else None
    if sid:
        RESOLVED.append((int(sid), label))

def main() -> int:
    b = Browse(); b.restart(); time.sleep(2)
    if not browse_login(b):
        print("FATAL login", file=sys.stderr); return 2
    print("demo login OK", flush=True)
    cross = []
    for sid, label in RESOLVED:
        try:
            j = render_and_judge(b, sid, "reading-strategy", SHOTS); v = j.get("verdict", "err")
        except Exception as e:
            v = f"err:{e}"; j = {}
        mark = "✅" if v == "faithful" else ("❌ CROSS — revert" if v == "cross_lesson" else f"⚠️ {v}")
        if v == "cross_lesson":
            cross.append(label)
        print(f"[{sid}] {label}: {v} {mark}", flush=True)
        print(f"     {(j.get('reasoning','') or '')[:150]}", flush=True)
    print(f"\n{'ALL FAITHFUL ✅' if not cross else 'REVERT THESE: ' + ', '.join(cross)}", flush=True)
    return 0

if __name__ == "__main__":
    sys.exit(main())
