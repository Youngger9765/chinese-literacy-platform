#!/usr/bin/env python
"""Spotlight regression check — the "增量修復、隨時批次檢查前面有沒有修壞" gate (#2397).

Ratchet semantics: quality may only go UP. For every lesson in the baseline,
the current spotlight must have >= the baseline's block count AND >= its
question-block count, and must not have lost a question TYPE. Any DECREASE (or a
lesson that no longer loads) is a REGRESSION = FAIL.

Workflow:
  - Run anytime to verify nothing previously-good got broken:
        python scripts/spotlight_regression_check.py
  - After REPAIRING a lesson (improving it), re-baseline so its new (higher)
    floor is locked in:
        python scripts/spotlight_regression_check.py --rebaseline G6-L18 G7-L4
    (only the named lessons are lifted to their current structure; everything
     else keeps its existing floor — so a repair can't silently lower others)
  - Re-baseline every lesson at once (use sparingly, e.g. first build):
        python scripts/spotlight_regression_check.py --rebaseline-all

Exit code 0 = PASS (no regressions), 1 = FAIL (regressions found).
"""
import json
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO_ROOT / "backend"))

from app.services.spotlight_contract import (  # noqa: E402
    DEV7_LESSONS,
    TEST15_CATALOG_CODES,
    CATALOG_LESSONS,
)
from app.services.spotlight_v2_loader import load_spotlight_v2  # noqa: E402
from app.services.lesson_code_normalization import normalize_manifest_code  # noqa: E402

BASELINE_PATH = REPO_ROOT / "backend" / "data" / "curriculum_qa" / "spotlight_regression_baseline.json"
Q_TYPES = {"single", "multi", "free_text", "fill_table", "fill_blank", "sort", "match"}


def tier(code: str) -> str:
    n = normalize_manifest_code(code)
    if code in DEV7_LESSONS or n in DEV7_LESSONS:
        return "dev7"
    if code in TEST15_CATALOG_CODES or n in TEST15_CATALOG_CODES:
        return "test15"
    return "catalog"


def snapshot_one(code: str) -> dict | None:
    """Current structural snapshot for a lesson, or None if no spotlight loads."""
    sp = load_spotlight_v2(code)
    if not sp:
        return None
    blocks = sp.get("blocks", [])
    type_counts: dict[str, int] = {}
    for b in blocks:
        t = b.get("type")
        type_counts[t] = type_counts.get(t, 0) + 1
    n_q = sum(c for t, c in type_counts.items() if t in Q_TYPES)
    return {
        "tier": tier(code),
        "n_blocks": len(blocks),
        "n_questions": n_q,
        "type_counts": type_counts,
    }


def all_codes() -> list[str]:
    return sorted({normalize_manifest_code(c) for c in (
        set(DEV7_LESSONS) | set(TEST15_CATALOG_CODES) | set(CATALOG_LESSONS)
    )})


def build_snapshot() -> dict:
    snap = {}
    for code in all_codes():
        s = snapshot_one(code)
        if s is not None:
            snap[code] = s
    return snap


def load_baseline() -> dict:
    if not BASELINE_PATH.exists():
        print(f"baseline not found: {BASELINE_PATH} — run --rebaseline-all first", file=sys.stderr)
        sys.exit(2)
    return json.loads(BASELINE_PATH.read_text())


def save_baseline(b: dict) -> None:
    BASELINE_PATH.write_text(json.dumps(b, ensure_ascii=False, indent=2))


def check() -> int:
    baseline = load_baseline()
    regressions = []
    improvements = []
    for code, base in baseline.items():
        cur = snapshot_one(code)
        if cur is None:
            regressions.append((code, "spotlight 整個 load 不出（曾有 {} blocks）".format(base["n_blocks"])))
            continue
        if cur["n_blocks"] < base["n_blocks"]:
            regressions.append((code, f"blocks {base['n_blocks']}→{cur['n_blocks']} (掉 {base['n_blocks']-cur['n_blocks']})"))
        if cur["n_questions"] < base["n_questions"]:
            regressions.append((code, f"題型塊 {base['n_questions']}→{cur['n_questions']} (掉題目)"))
        # lost a question TYPE entirely
        lost_types = [t for t in base["type_counts"] if t in Q_TYPES
                      and base["type_counts"][t] > 0
                      and cur["type_counts"].get(t, 0) == 0]
        if lost_types:
            regressions.append((code, f"題型消失: {lost_types}"))
        if cur["n_blocks"] > base["n_blocks"] or cur["n_questions"] > base["n_questions"]:
            improvements.append((code, f"blocks {base['n_blocks']}→{cur['n_blocks']}, Q {base['n_questions']}→{cur['n_questions']}"))
    # lessons newly loading that weren't in baseline (new content) — informational
    new_codes = [c for c in build_snapshot() if c not in baseline]

    print(f"=== Spotlight 回歸檢查 (baseline {len(baseline)} 課) ===")
    if improvements:
        print(f"\n⬆️  改善 {len(improvements)} 課（修好了,記得 --rebaseline 鎖住新地板）:")
        for c, d in improvements[:30]:
            print(f"   {c}: {d}")
    if new_codes:
        print(f"\n🆕 新增 {len(new_codes)} 課（baseline 沒有,--rebaseline-all 納入）: {new_codes[:15]}")
    if regressions:
        print(f"\n❌ REGRESSION {len(regressions)} 課 —— 有東西被修壞了:")
        for c, d in regressions:
            print(f"   {c}: {d}")
        print("\nSPOTLIGHT_REGRESSION=FAIL")
        return 1
    print("\n✅ 0 regression — 前面的課都沒被修壞")
    print("SPOTLIGHT_REGRESSION=PASS")
    return 0


def rebaseline(codes: list[str]) -> None:
    baseline = load_baseline() if BASELINE_PATH.exists() else {}
    lifted = []
    for raw in codes:
        code = normalize_manifest_code(raw)
        cur = snapshot_one(code)
        if cur is None:
            print(f"  ⚠️ {code}: load 不出,跳過(不能 rebaseline 成空)")
            continue
        old = baseline.get(code)
        baseline[code] = cur
        lifted.append((code, old, cur))
    save_baseline(baseline)
    print(f"=== rebaseline {len(lifted)} 課（地板升級）===")
    for code, old, cur in lifted:
        ob = old["n_blocks"] if old else 0
        print(f"   {code}: blocks {ob}→{cur['n_blocks']}, Q {cur['n_questions']}")


def main() -> int:
    args = sys.argv[1:]
    if args and args[0] == "--rebaseline-all":
        save_baseline(build_snapshot())
        b = load_baseline()
        print(f"=== rebaseline-all: {len(b)} 課 全部重設為當前結構 ===")
        return 0
    if args and args[0] == "--rebaseline":
        rebaseline(args[1:])
        return 0
    return check()


if __name__ == "__main__":
    sys.exit(main())
