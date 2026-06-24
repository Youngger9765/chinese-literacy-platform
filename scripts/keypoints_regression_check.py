#!/usr/bin/env python
"""重點表 (story_structure_table) regression check — keypoints 版的決定性 ratchet (#2397).

聚光燈有 spotlight_regression_check.py;重點表這支是它的姊妹。Young 要「不假綠」——
重點表 QA board 的 ⑥「結構 ✓決定性」必須有一個可重跑、同表同輸出的 gate 撐,不是嘴上講。

Ratchet 語意:品質只能往上。每課重點表的決定性指紋(從 story_structure_table 重算):
  - row_count    列數(原始 table rows)
  - n_blanks     填空格數(【 】literal 計數)
  - n_section_rows 三欄(段落/上位概念)列數
  - content_hash 所有 cell 文字的 sha256(放錯課/內容被換的防線)

REGRESSION = FAIL 條件:
  - 整張表 load 不出(曾有資料)
  - row_count / n_blanks 下降(掉內容)
  - content_hash 漂移卻沒 --rebaseline(沒改卻變 = 別課 ripple / 放錯課;改過要 rebaseline 鎖)

⚠️ 誠實邊界(同聚光燈):此 gate 只抓「結構/內容漂移/放錯課」這類決定性退步,
**抓不到教學內容品質**(重點抄錯、年級不符、上位概念分類錯)——那要人工抽樣 gold。
ratchet 只保證「不比 baseline 差」,不保證「baseline 是對的」。

Workflow:
  python scripts/keypoints_regression_check.py                  # 驗有沒有被改壞
  python scripts/keypoints_regression_check.py --rebaseline G6-L22 ...   # 修好某課→鎖新地板
  python scripts/keypoints_regression_check.py --rebaseline-all # 首次/全重設(慎用)

Exit 0 = PASS, 1 = FAIL.
"""
import hashlib
import json
import re
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO_ROOT / "backend"))

from app.services.lesson_loader import get_lesson_by_code  # noqa: E402
from app.services.lesson_code_normalization import normalize_manifest_code  # noqa: E402

BASELINE_PATH = REPO_ROOT / "backend" / "data" / "curriculum_qa" / "keypoints_regression_baseline.json"
MANIFEST_PATH = REPO_ROOT / "backend" / "data" / "curriculum_qa" / "keypoints_manifest.json"
BLANK_RE = re.compile(r"【[^】]*】")


def all_codes() -> list[str]:
    man = json.loads(MANIFEST_PATH.read_text())["lessons"]
    return sorted({normalize_manifest_code(m["lesson_id"]) for m in man})


def snapshot_one(code: str) -> dict | None:
    rows = (get_lesson_by_code(code) or {}).get("story_structure_table") or []
    if not rows:
        return None
    n_blanks = 0
    n_section_rows = 0
    flat = []
    for r in rows:
        for cell in r:
            if isinstance(cell, str):
                n_blanks += len(BLANK_RE.findall(cell))
                flat.append(cell)
        if len(r) >= 3:
            n_section_rows += 1
    content_hash = hashlib.sha256("\n".join(flat).encode("utf-8")).hexdigest()[:16]
    return {
        "row_count": len(rows),
        "n_blanks": n_blanks,
        "n_section_rows": n_section_rows,
        "content_hash": content_hash,
    }


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
    drifts = []
    improvements = []
    for code, base in baseline.items():
        cur = snapshot_one(code)
        if cur is None:
            regressions.append((code, "重點表整個 load 不出（曾有 {} 列）".format(base["row_count"])))
            continue
        if cur["row_count"] < base["row_count"]:
            regressions.append((code, f"列數 {base['row_count']}→{cur['row_count']} (掉列)"))
        if cur["n_blanks"] < base["n_blanks"]:
            regressions.append((code, f"填空 {base['n_blanks']}→{cur['n_blanks']} (掉填空)"))
        if base.get("content_hash") and cur["content_hash"] != base["content_hash"]:
            drifts.append((code, f"內容指紋 {base['content_hash']}→{cur['content_hash']}"))
        if cur["row_count"] > base["row_count"] or cur["n_blanks"] > base["n_blanks"]:
            improvements.append((code, f"列 {base['row_count']}→{cur['row_count']}, 填空 {base['n_blanks']}→{cur['n_blanks']}"))
    new_codes = [c for c in build_snapshot() if c not in baseline]

    print(f"=== 重點表 回歸檢查 (baseline {len(baseline)} 課) ===")
    if improvements:
        print(f"\n⬆️  改善 {len(improvements)} 課（修好了,記得 --rebaseline 鎖新地板）:")
        for c, d in improvements[:30]:
            print(f"   {c}: {d}")
    if new_codes:
        print(f"\n🆕 新增 {len(new_codes)} 課（baseline 沒有,--rebaseline-all 納入）: {new_codes[:15]}")
    if drifts:
        print(f"\n❌ 內容指紋漂移 {len(drifts)} 課 —— 內容變了卻沒 rebaseline（改過→`--rebaseline <code>` 鎖;沒改卻漂移=別課 ripple/放錯課,要查!）:")
        for c, d in drifts:
            print(f"   {c}: {d}")
    if regressions:
        print(f"\n❌ REGRESSION {len(regressions)} 課 —— 結構退步:")
        for c, d in regressions:
            print(f"   {c}: {d}")
    if regressions or drifts:
        print("\nKEYPOINTS_REGRESSION=FAIL")
        return 1
    print("\n✅ 0 regression/漂移 — 列數+填空+內容指紋全鎖住,重點表沒被修壞也沒放錯課")
    print("KEYPOINTS_REGRESSION=PASS")
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
        ob = old["row_count"] if old else 0
        print(f"   {code}: 列 {ob}→{cur['row_count']}, 填空 {cur['n_blanks']}")


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
