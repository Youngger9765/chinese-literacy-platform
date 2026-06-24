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
import hashlib
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
from app.services.content_mapping_registry import get_spotlight_source_code  # noqa: E402
from app.services.lesson_loader import get_lesson_by_code  # noqa: E402

BASELINE_PATH = REPO_ROOT / "backend" / "data" / "curriculum_qa" / "spotlight_regression_baseline.json"
Q_TYPES = {"single", "multi", "free_text", "fill_table", "fill_blank", "sort", "match"}


def tier(code: str) -> str:
    n = normalize_manifest_code(code)
    if code in DEV7_LESSONS or n in DEV7_LESSONS:
        return "dev7"
    if code in TEST15_CATALOG_CODES or n in TEST15_CATALOG_CODES:
        return "test15"
    return "catalog"


def _block_text(blocks: list) -> str:
    """All readable text across blocks (for the content fingerprint)."""
    out = []
    for b in blocks:
        for k in ("text", "prompt", "instruction", "heading", "title"):
            v = b.get(k)
            if isinstance(v, str) and v.strip():
                out.append(v.strip())
        for p in b.get("paragraphs", []) or []:
            if isinstance(p, str):
                out.append(p.strip())
        for opt in b.get("options", []) or []:
            out.append(opt if isinstance(opt, str) else str(opt.get("text", "") if isinstance(opt, dict) else ""))
    return "\n".join(out)


def snapshot_one(code: str) -> dict | None:
    """Structural + content + source-binding snapshot for a lesson (#2397).

    content_hash + source_code make the ratchet catch the 放錯課/rebinding class
    (deterministic): if a lesson's content silently changes topic (overwrite /
    registry rebinding drift), the hash/source moves — even when block counts go
    UP (the structural-only ratchet missed exactly this: 石虎 overwrote 蝴蝶蘭).
    """
    sp = load_spotlight_v2(code)
    if not sp:
        return None
    blocks = sp.get("blocks", [])
    type_counts: dict[str, int] = {}
    for b in blocks:
        t = b.get("type")
        type_counts[t] = type_counts.get(t, 0) + 1
    n_q = sum(c for t, c in type_counts.items() if t in Q_TYPES)
    content_hash = hashlib.sha256(_block_text(blocks).encode("utf-8")).hexdigest()[:16]
    n = normalize_manifest_code(code)
    try:
        src = get_spotlight_source_code(n, (get_lesson_by_code(code) or {}).get("title"))
    except Exception:
        src = None
    return {
        "tier": tier(code),
        "n_blocks": len(blocks),
        "n_questions": n_q,
        "type_counts": type_counts,
        "content_hash": content_hash,
        "source_code": normalize_manifest_code(src) if src else None,
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
    content_drifts = []  # 放錯課防線:內容指紋變了(改過要 rebaseline;沒改卻變=ripple/放錯課)
    for code, base in baseline.items():
        cur = snapshot_one(code)
        if cur is None:
            regressions.append((code, "spotlight 整個 load 不出（曾有 {} blocks）".format(base["n_blocks"])))
            continue
        if cur["n_blocks"] < base["n_blocks"]:
            regressions.append((code, f"blocks {base['n_blocks']}→{cur['n_blocks']} (掉 {base['n_blocks']-cur['n_blocks']})"))
        if cur["n_questions"] < base["n_questions"]:
            regressions.append((code, f"題型塊 {base['n_questions']}→{cur['n_questions']} (掉題目)"))
        # Lost a question TYPE entirely — only a regression if total questions did
        # NOT increase. Restructuring 1 free_text into 8 single questions is an
        # UPGRADE, not a degrade; flag a lost type only when it isn't offset by
        # more questions overall.
        lost_types = [t for t in base["type_counts"] if t in Q_TYPES
                      and base["type_counts"][t] > 0
                      and cur["type_counts"].get(t, 0) == 0]
        if lost_types and cur["n_questions"] <= base["n_questions"]:
            regressions.append((code, f"題型消失且題數未增: {lost_types}"))
        # 放錯課防線 (#2397, deterministic): 源綁定漂移 = rebinding 到別課的檔 = 幾乎必為 bug
        if base.get("source_code") != cur.get("source_code"):
            regressions.append((code, f"源綁定漂移 source {base.get('source_code')}→{cur.get('source_code')} (rebinding/放錯課風險)"))
        # 內容指紋變:結構沒退步但內容換了。改過該 rebaseline;沒改卻變 = 別課 ripple(石虎覆蓋蝴蝶蘭那種)
        elif base.get("content_hash") and cur.get("content_hash") != base.get("content_hash"):
            content_drifts.append((code, f"內容指紋 {base.get('content_hash')}→{cur.get('content_hash')}"))
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
    if content_drifts:
        print(f"\n⚠️  內容指紋漂移 {len(content_drifts)} 課（改過→--rebaseline 鎖住;沒改卻漂移=別課 ripple/放錯課,要查!）:")
        for c, d in content_drifts:
            print(f"   {c}: {d}")
    if regressions:
        print(f"\n❌ REGRESSION {len(regressions)} 課 —— 有東西被修壞了:")
        for c, d in regressions:
            print(f"   {c}: {d}")
        print("\nSPOTLIGHT_REGRESSION=FAIL")
        return 1
    drift_note = f"（⚠️ {len(content_drifts)} 課內容指紋漂移待 review/rebaseline）" if content_drifts else ""
    print(f"\n✅ 0 結構/源綁定 regression — 前面的課都沒被修壞 {drift_note}")
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
