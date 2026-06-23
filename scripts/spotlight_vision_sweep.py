#!/usr/bin/env python
"""Platform spotlight vision sweep — map ALL residual 內容放錯課 (#2397).

Self-contained: pops GOOGLE_APPLICATION_CREDENTIALS (career-creator SA key
shadows lingoleap ADC → 403) so vision uses youngtsai owner ADC. Reuses the
calibrated judge's render_and_judge. Reads the lesson list from the committed
p0-l1-matrix review_queue (story_id + lesson_code already enumerated). Writes
jsonl incrementally (防丟) + a summary.

Usage: env -u GOOGLE_APPLICATION_CREDENTIALS python scripts/spotlight_vision_sweep.py [GRADE_PREFIX...]
  e.g. ... spotlight_vision_sweep.py G5 G6 G7 G8 G9 文   (default: all non-G4)
"""
import os
os.environ.pop("GOOGLE_APPLICATION_CREDENTIALS", None)  # auth fix

import json
import sys
import time
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO_ROOT))
sys.path.insert(0, str(REPO_ROOT / "backend"))

from spotlight_vision_judge import Browse, browse_login, render_and_judge  # noqa: E402

OUT_DIR = REPO_ROOT / "qa" / "content-evidence" / "vision-judge-grade-map"
OUT_DIR.mkdir(parents=True, exist_ok=True)
SHOTS = OUT_DIR / "shots"
SHOTS.mkdir(parents=True, exist_ok=True)

# Lesson list from the committed L1 matrix (story_id + lesson_code).
RQ = REPO_ROOT / "qa" / "content-evidence" / "p0-l1-matrix" / "review_queue.jsonl"
seen = {}
for line in RQ.read_text().splitlines():
    try:
        r = json.loads(line)
    except Exception:
        continue
    if r.get("step") != "reading-strategy":
        continue
    sid = r.get("story_id")
    code = r.get("lesson_code") or ""
    if sid is not None and sid not in seen:
        seen[sid] = code

prefixes = sys.argv[1:] or None  # None => all non-G4
lessons = []
for sid, code in seen.items():
    if prefixes:
        if not any(code.startswith(p) for p in prefixes):
            continue
    else:
        if code.startswith("G4-"):
            continue
    lessons.append((sid, code))
lessons.sort(key=lambda x: str(x[1]))
print(f"sweep {len(lessons)} reading-strategy lessons (prefixes={prefixes or 'non-G4'})", flush=True)

browse = Browse()
browse.restart()
time.sleep(2)
if not browse_login(browse):
    print("FATAL: demo login failed", file=sys.stderr)
    sys.exit(2)
print("demo login OK", flush=True)

out_path = OUT_DIR / "sweep-results.jsonl"
counts = {}
with out_path.open("w") as fh:
    for i, (sid, code) in enumerate(lessons, 1):
        try:
            j = render_and_judge(browse, int(sid), "reading-strategy", SHOTS)
            v = j.get("verdict", "error")
        except Exception as exc:
            j = {"story_id": sid, "lesson_code": code, "verdict": "error",
                 "reasoning": f"exception: {exc}"}
            v = "error"
        counts[v] = counts.get(v, 0) + 1
        row = {"story_id": sid, "lesson_code": code, "title": j.get("title", ""),
               "verdict": v, "confidence": j.get("confidence"),
               "reasoning": (j.get("reasoning", "") or "")[:300],
               "suspected_actual_lesson": j.get("suspected_actual_lesson", "")}
        fh.write(json.dumps(row, ensure_ascii=False) + "\n")
        fh.flush()
        print(f"[{i}/{len(lessons)}] {code} ({sid}) -> {v}", flush=True)

print("DONE", json.dumps(counts, ensure_ascii=False), flush=True)
(OUT_DIR / "sweep-summary.json").write_text(
    json.dumps({"total": len(lessons), "counts": counts}, ensure_ascii=False, indent=2)
)
