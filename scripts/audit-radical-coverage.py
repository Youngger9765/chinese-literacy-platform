#!/usr/bin/env python3
"""
Audit radical (部件) coverage — reports which component radicals used in
decompositions-generated.json lack meaning/related-chars data in
radical-meanings.json + the hand-curated radicalMap.

Usage:
  python3 scripts/audit-radical-coverage.py              # print ranked list
  python3 scripts/audit-radical-coverage.py --top 50     # only top 50
  python3 scripts/audit-radical-coverage.py --json out.json
"""

import argparse
import json
import re
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DECOMP_PATH = ROOT / "frontend/src/data/decompositions-generated.json"
MEANINGS_PATH = ROOT / "frontend/src/data/radical-meanings.json"
RADICALS_TS_PATH = ROOT / "frontend/src/data/radicals.ts"


def parse_radical_map_keys(ts_path: Path) -> set[str]:
    """Extract top-level keys from the radicalMap object in radicals.ts."""
    text = ts_path.read_text(encoding="utf-8")
    start = text.find("export const radicalMap")
    if start < 0:
        return set()
    body = text[start:]
    end_marker = "\nexport "
    end = body.find(end_marker, 50)
    if end > 0:
        body = body[:end]
    return set(re.findall(r"^\s+'([^']+)':\s*\{", body, re.MULTILINE))


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--top", type=int, default=0, help="limit to top N (0 = all)")
    ap.add_argument("--json", type=Path, help="also write machine-readable output")
    args = ap.parse_args()

    decomp = json.loads(DECOMP_PATH.read_text(encoding="utf-8"))
    meanings = json.loads(MEANINGS_PATH.read_text(encoding="utf-8"))
    radical_map_keys = parse_radical_map_keys(RADICALS_TS_PATH)

    counts: Counter[str] = Counter()
    usage_chars: dict[str, list[str]] = {}
    for ch, data in decomp.items():
        for comp in data.get("components", []):
            r = comp["radical"]
            counts[r] += 1
            usage_chars.setdefault(r, []).append(ch)

    covered_by_meanings = set(meanings.keys())
    covered = covered_by_meanings | radical_map_keys

    missing = [(r, n) for r, n in counts.most_common() if r not in covered]
    total_positions = sum(counts.values())
    missing_positions = sum(n for _, n in missing)

    print(f"Total unique radicals used as components: {len(counts)}")
    print(f"  Covered by radicalMap:         {len(radical_map_keys)}")
    print(f"  Covered by radical-meanings:   {len(covered_by_meanings)}")
    print(f"  Covered (union):               {len(covered)}")
    print(f"  Missing:                       {len(missing)}")
    print()
    print(f"Click positions total:   {total_positions}")
    print(f"Click positions missing: {missing_positions} ({100*missing_positions/total_positions:.1f}%)")
    print()

    limit = args.top if args.top > 0 else len(missing)
    print(f"Top {limit} missing radicals (by usage count):")
    print(f"{'rank':>4}  {'radical':<4} {'count':>5}  example chars")
    for i, (r, n) in enumerate(missing[:limit], 1):
        examples = " ".join(usage_chars[r][:8])
        print(f"{i:>4}  {r:<4} {n:>5}  {examples}")

    if args.json:
        payload = {
            "summary": {
                "totalUniqueRadicals": len(counts),
                "coveredRadicalMap": len(radical_map_keys),
                "coveredMeanings": len(covered_by_meanings),
                "missing": len(missing),
                "totalPositions": total_positions,
                "missingPositions": missing_positions,
            },
            "missing": [
                {"radical": r, "count": n, "examples": usage_chars[r][:20]}
                for r, n in missing[:limit]
            ],
        }
        args.json.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
        print(f"\nWrote {args.json}")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
