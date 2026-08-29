#!/usr/bin/env python3
"""對每一課跑逐字門 —— 因為它原本不在任何一次全庫掃描裡。

為什麼需要這支
--------------
`verbatim_gate.py` 是主門（擋潤稿、擋看錯字形、擋改到原稿），但它的介面是
**逐課**的（`--yaml` + `--docx`）。八道門的例行掃描裡沒有它，於是只要收件時
沒有逐課跑，一課可以在**逐字門從來沒有執行過**的情況下進 repo。

2026-08-18 實際發生：L0122 帶著 3 處對不上被 commit 進去。抓到它的不是逐字門，
是 `sot_drift_check`（因為 `split_lesson_modules` 只在逐字門通過時才蓋 `docx_md5`，
沒指紋反過來洩漏了「這課沒過逐字門」）。**繞了一圈才被抓到，而且是靠副作用。**

跟這輪其他缺陷同一個形狀：檢查存在，但沒接在真正會跑的路徑上。

用法：
    python3 scripts/verbatim_all.py          # 全庫
    python3 scripts/verbatim_all.py L0122    # 單課
"""
from __future__ import annotations

import subprocess
import sys
from pathlib import Path

import yaml

REPO = Path(__file__).resolve().parent.parent
EXTRACTED = REPO / "backend/data/lessons/_extracted"
LESSONS = REPO / "backend/data/lessons"
SOT = REPO / "private/curriculum-source/_SOT"
GATE = REPO / "scripts/verbatim_gate.py"


def drive_path(uid: str) -> str | None:
    for v in ("v2", "v3"):
        f = LESSONS / uid / v / "lesson.yml"
        if f.exists():
            src = (yaml.safe_load(f.read_text(encoding="utf-8")) or {}).get("source") or {}
            if src.get("drive_path"):
                return src["drive_path"]
    return None


def main() -> int:
    only = sys.argv[1] if len(sys.argv) > 1 else None
    files = sorted(EXTRACTED.glob("*.yml"))
    if only:
        files = [f for f in files if f.stem == only]
        if not files:
            print(f"⛔ 找不到 {only}")
            return 1

    bad, skipped = [], []
    for f in files:
        dp = drive_path(f.stem)
        if not dp or not (SOT / dp).exists():
            # 讀不到原稿 ≠ 通過。分開列，不要混進 PASS 的數字裡。
            skipped.append(f.stem)
            continue
        r = subprocess.run(
            [sys.executable, str(GATE), "--yaml", str(f), "--docx", str(SOT / dp)],
            capture_output=True, text=True,
        )
        if "VERBATIM_GATE=PASS" in r.stdout:
            print(f"  ✓ {f.stem}")
        else:
            bad.append(f.stem)
            miss = [l for l in r.stdout.splitlines() if l.strip().startswith("✗")]
            print(f"  🔴 {f.stem}: {len(miss)} 處對不上")
            for m in miss[:3]:
                print(f"      {m.strip()[:90]}")

    if skipped:
        print(f"\n⚠️ 讀不到原稿、**未驗**：{len(skipped)} 課 → {' '.join(skipped)}")
    ok = len(files) - len(bad) - len(skipped)
    print(f"\nVERBATIM_ALL={'PASS' if not bad else 'FAIL'}  （{ok}/{len(files)} 通過"
          + (f"，{len(skipped)} 未驗" if skipped else "") + "）")
    return 1 if bad else 0


if __name__ == "__main__":
    raise SystemExit(main())
