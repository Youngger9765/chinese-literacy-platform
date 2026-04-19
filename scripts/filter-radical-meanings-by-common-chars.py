#!/usr/bin/env python3
"""
Rebuild each radical's relatedChars in frontend/src/data/radical-meanings.json
from actual decomposition data, filtered by common-chars whitelist.

Why two-step rewrite (#1099):
  makemeahanzi's etymology.semantic data (the original source for relatedChars)
  is unreliable for pedagogy — 戈's list was 戕 戗 戤 戡 戩 戧 戮, missing the
  obvious 我 或 找 戰 戴 戒. The right signal is structural decomposition:
  for each radical, list every character whose component breakdown contains
  it, intersected with what students will recognize.

Common-chars whitelist = union of:
  (1) 教育部《常用國字標準字體表》 4,808 chars (1982)
  (2) chars appearing in backend/data/lessons/*.yml (57 課文)
  → ~4,903 chars total

Ranking (primary → tie-breaker):
  1. lesson frequency desc (appears in the curriculum → learner familiarity)
  2. MOE-standard listed first
  3. stable (original decomposition order)

Usage:
  python3 scripts/filter-radical-meanings-by-common-chars.py [--keep N]
"""

import argparse
import json
from collections import Counter, defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
LESSONS = ROOT / "backend/data/lessons"
MEANINGS = ROOT / "frontend/src/data/radical-meanings.json"
DECOMPS = ROOT / "frontend/src/data/decompositions-generated.json"
MOE_LIST = ROOT / "data/raw/common-chars/moe-standard-4808.txt"


def build_lesson_freq() -> Counter:
    freq: Counter = Counter()
    for f in sorted(LESSONS.glob("*.yml")):
        for ch in f.read_text(encoding="utf-8"):
            if "\u4e00" <= ch <= "\u9fff":
                freq[ch] += 1
    return freq


def load_moe_chars() -> set[str]:
    chars: set[str] = set()
    for line in MOE_LIST.read_text(encoding="utf-8").splitlines():
        if line.startswith("#") or not line.strip():
            continue
        c = line.split("\t", 1)[0].strip()
        if c and "\u4e00" <= c[0] <= "\u9fff":
            chars.add(c)
    return chars


def build_radical_to_chars() -> dict[str, list[str]]:
    """radical → ordered list of chars that contain it as a component."""
    decomp = json.loads(DECOMPS.read_text(encoding="utf-8"))
    idx: dict[str, list[str]] = defaultdict(list)
    for ch, data in decomp.items():
        for comp in data.get("components", []):
            idx[comp["radical"]].append(ch)
    return idx


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--keep", type=int, default=12, help="max relatedChars per radical")
    args = ap.parse_args()

    lesson_freq = build_lesson_freq()
    moe_chars = load_moe_chars()
    common = set(lesson_freq) | moe_chars
    radical_to_chars = build_radical_to_chars()

    data = json.loads(MEANINGS.read_text(encoding="utf-8"))

    before_total = sum(len(e.get("relatedChars", [])) for e in data.values())
    kept_total = 0
    emptied = 0
    radicals_touched = 0

    def rank_key(c: str) -> tuple:
        return (-lesson_freq.get(c, 0), 0 if c in moe_chars else 1)

    for radical, entry in data.items():
        original = entry.get("relatedChars") or []
        # Primary source: all decomposition-containing chars
        decomp_chars = radical_to_chars.get(radical, [])
        # Union with original relatedChars (keeps etymology data as supplement)
        seen: set[str] = set()
        combined: list[str] = []
        for c in decomp_chars + original:
            if c != radical and c not in seen and c in common:
                seen.add(c)
                combined.append(c)
        combined.sort(key=rank_key)
        trimmed = combined[: args.keep]
        if trimmed != original:
            radicals_touched += 1
            entry["relatedChars"] = trimmed
            orig_src = entry.get("relatedCharsSource", "makemeahanzi")
            entry["relatedCharsSource"] = f"decomposition+moe4808 (from {orig_src})"
        if not trimmed:
            emptied += 1
        kept_total += len(trimmed)

    MEANINGS.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    print(f"Common-char whitelist: {len(common):,}  "
          f"(MOE 4808: {len(moe_chars):,} ∪ lessons: {len(lesson_freq):,})")
    print(f"Radicals in file: {len(data)}")
    print(f"Radicals modified: {radicals_touched}")
    print(f"relatedChars total: {before_total} → {kept_total}")
    print(f"Radicals with 0 relatedChars after filter: {emptied}")
    for spot in ["戈", "言", "貝", "土", "日", "月", "心", "水",
                 "老", "舌", "豆", "瓜", "血", "赤", "豸", "角", "臣"]:
        if spot in data:
            print(f"  {spot}: {data[spot].get('relatedChars')}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
