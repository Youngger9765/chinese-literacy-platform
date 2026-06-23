#!/usr/bin/env python
"""Targeted render verify for the #2397 legacy strategy_exercise fix.

Judges ONLY the affected lessons against deployed staging — far faster than the
full grade sweep. 4 fixed (expect: no longer cross — placeholder/faithful) +
2 judge-FP controls (expect: stay faithful).

Usage: env -u GOOGLE_APPLICATION_CREDENTIALS python scripts/spotlight_verify_targeted.py
"""
import os
os.environ.pop("GOOGLE_APPLICATION_CREDENTIALS", None)
import json, sys, time
from pathlib import Path
REPO_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO_ROOT))
sys.path.insert(0, str(REPO_ROOT / "backend"))
from spotlight_vision_judge import Browse, browse_login, render_and_judge  # noqa

SHOTS = REPO_ROOT / "qa" / "content-evidence" / "vision-judge-grade-map" / "shots-verify"
SHOTS.mkdir(parents=True, exist_ok=True)

# (story_id, label, expectation)
TARGETS = [
    (1042, "G5-L15 信件 [fixed→expect NOT cross]", "fixed"),
    (1066, "G6-L12 動物 [fixed→expect NOT cross]", "fixed"),
    (1086, "G7-L7 人口 [fixed→expect NOT cross]", "fixed"),
    (53,   "G9-L8 閱讀力 [fixed→expect NOT cross]", "fixed"),
    (1041, "G5-L14 垃圾食物 [FP control→expect faithful]", "control"),
    (39,   "G7-L20 偽科學 [FP control→expect faithful]", "control"),
]
browse = Browse(); browse.restart(); time.sleep(2)
if not browse_login(browse):
    print("FATAL: demo login failed", file=sys.stderr); sys.exit(2)
print("demo login OK", flush=True)
bad = 0
for sid, label, kind in TARGETS:
    try:
        j = render_and_judge(browse, int(sid), "reading-strategy", SHOTS)
        v = j.get("verdict", "error")
    except Exception as e:
        v = f"error:{e}"; j = {}
    flag = ""
    if kind == "fixed" and v == "cross_lesson":
        flag = "  ❌ STILL CROSS"; bad += 1
    if kind == "control" and v == "cross_lesson":
        flag = "  ⚠️ judge still FP (content faithful, judge flags)"
    print(f"[{sid}] {label} -> {v}{flag}", flush=True)
    print(f"     {(j.get('reasoning','') or '')[:180]}", flush=True)
print(f"\n{'ALL FIXED OK' if bad==0 else f'*** {bad} still cross ***'}", flush=True)
