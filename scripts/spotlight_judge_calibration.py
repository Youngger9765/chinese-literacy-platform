#!/usr/bin/env python
"""Spotlight vision-judge calibration eval (#2397).

The judge is the EDD quality gate for the per-lesson spotlight repair grind, so
it must be trustworthy before it gates anything. This is the human-anchored
labeled set: each case's expected verdict was verified by reading the full
content (passage + all spotlight blocks), NOT by the judge itself.

It doubles as the REGRESSION LOCK for the judge prompt: any future prompt change
must keep these labels. Re-run after editing JUDGE_SYSTEM_PROMPT.

Cases capture the two systematic failure modes this calibration fixed:
  - progressive-reveal FP: screenshot shows only the opening segment (a foreign
    worked example); judge must read the FULL block text to see the lesson's own
    application → faithful  (G5-L14)
  - and confirm cross-detection is NOT lost: a lesson whose own data is
    internally inconsistent still flags  (G7-L20 = story-39 title/passage bug)

Usage: env -u GOOGLE_APPLICATION_CREDENTIALS python scripts/spotlight_judge_calibration.py
Exit 0 = all labels matched (judge calibrated), 1 = a label drifted.
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

SHOTS = REPO_ROOT / "qa" / "content-evidence" / "vision-judge-grade-map" / "shots-calib"
SHOTS.mkdir(parents=True, exist_ok=True)

# (story_id, lesson, expected_verdict, why this label — human-verified)
CASES = [
    (1041, "G5-L14 垃圾食物", "faithful",
     "progressive-reveal: opening shows 臺東 worked-example, but full blocks apply 刪除法 to this lesson's 垃圾食物 (餅乾/洋芋片 in passage)"),
    (1076, "G6-L22 小兵立大功", "faithful",
     "dev7 gold standard: 烏鴉喝水 example then applies P-S-R to this lesson's 雞鳴狗盜"),
    (1103, "G7-L31 旅人鴿", "faithful",
     "legacy strategy_exercise quotes this lesson's own passage (超過十億隻飛過天空)"),
    (39, "G7-L20 偽科學", "cross_lesson",
     "NOT a judge FP — story-39 data bug: title=電子煙偽科學 but passage=芬蘭假新聞; judge correctly flags the internal inconsistency. Flip to faithful only after the story-39 title/passage data bug is fixed"),
]


def main() -> int:
    browse = Browse()
    browse.restart()
    time.sleep(2)
    if not browse_login(browse):
        print("FATAL: demo login failed", file=sys.stderr)
        return 2
    print("demo login OK", flush=True)
    bad = 0
    for sid, label, expected, why in CASES:
        try:
            j = render_and_judge(browse, int(sid), "reading-strategy", SHOTS)
            v = j.get("verdict", "error")
        except Exception as e:
            v = f"error:{e}"
            j = {}
        ok = v == expected
        if not ok:
            bad += 1
        mark = "✅" if ok else "❌ DRIFT"
        print(f"[{sid}] {label}: got={v} expected={expected} {mark}", flush=True)
        print(f"     label-why: {why}", flush=True)
        print(f"     judge: {(j.get('reasoning','') or '')[:160]}", flush=True)
    print(f"\n{'JUDGE_CALIBRATION=PASS' if bad == 0 else f'JUDGE_CALIBRATION=FAIL ({bad} drifted)'}", flush=True)
    return 0 if bad == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
