#!/usr/bin/env python3
"""
Build radical-meanings.json v2.0 from Traditional Chinese (zh-TW) open-data sources.

Sources (by priority):
  1. 手動 43 字 in radicals.ts — highest quality, overrides at runtime
  2. branneman/214-kangxi-radicals — base list, English meanings, stroke counts
  3. moedict (教育部重編國語辭典) — Traditional Chinese definitions (MOE open data)
  4. makemeahanzi — relatedChars via etymology.semantic (LGPL)

Note: saigyo excluded — it uses Simplified Chinese (zh-CN).

Usage:
  python3 scripts/build-radical-database.py \
    --branneman data/raw/radical-sources/branneman-214-radicals.json \
    --moedict /tmp/moedict.json \
    --makemeahanzi /tmp/makemeahanzi.txt \
    --output frontend/src/data/radical-meanings.json
"""

import argparse
import json
import sys
from collections import defaultdict
from datetime import date

# ---------------------------------------------------------------------------
# Variant → base radical mapping
# ---------------------------------------------------------------------------

VARIANT_TO_BASE: dict[str, str] = {
    "氵": "水",
    "冫": "水",
    "扌": "手",
    "龵": "手",
    "忄": "心",
    "亻": "人",
    "讠": "言",
    "訁": "言",
    "钅": "金",
    "釒": "金",
    "饣": "食",
    "飠": "食",
    "纟": "糸",
    "糹": "糸",
    "犭": "犬",
    "礻": "示",
    "衤": "衣",
    "灬": "火",
    "刂": "刀",
    "阝": "阜",
}

# Variant chars with their English description and stroke count
VARIANT_CHARS_INFO: dict[str, tuple[str, int]] = {
    "氵": ("water (flowing form)", 3),
    "冫": ("ice / water (side form)", 2),
    "扌": ("hand (side form)", 3),
    "忄": ("heart / mind (side form)", 3),
    "亻": ("person (side form)", 2),
    "讠": ("speech / language (simplified side)", 2),
    "訁": ("speech / language (traditional side)", 2),
    "钅": ("metal / gold (simplified side)", 5),
    "釒": ("metal / gold (traditional side)", 8),
    "饣": ("food (simplified side)", 3),
    "飠": ("food (traditional side)", 8),
    "纟": ("silk / thread (simplified side)", 3),
    "糹": ("silk / thread (traditional side)", 6),
    "犭": ("dog / animal (side form)", 3),
    "礻": ("spirit / altar (side form)", 4),
    "衤": ("clothing (side form)", 5),
    "灬": ("fire (bottom form)", 4),
    "刂": ("knife (side form)", 2),
}


# ---------------------------------------------------------------------------
# Loaders
# ---------------------------------------------------------------------------

def load_branneman(path: str) -> list:
    """Load branneman 214 Kangxi radicals JSON.
    Fields: id, radical, pinyin, english, strokeCount
    """
    print(f"Loading branneman 214 radicals from {path}...", file=sys.stderr)
    with open(path, encoding="utf-8") as f:
        data = json.load(f)
    print(f"  Loaded {len(data)} radicals", file=sys.stderr)
    return data


def load_moedict(path: str) -> dict:
    """Load moedict and return char → first Traditional Chinese definition."""
    print(f"Loading moedict from {path}...", file=sys.stderr)
    with open(path, encoding="utf-8") as f:
        data = json.load(f)

    lookup: dict[str, str] = {}
    for entry in data:
        title = entry.get("title", "")
        if not title:
            continue
        # Skip entries with curly-brace encoded variant chars
        if title.startswith("{") and title.endswith("}"):
            continue
        heteronyms = entry.get("heteronyms", [])
        if not heteronyms:
            continue
        defs = heteronyms[0].get("definitions", [])
        if not defs:
            continue
        first_def = defs[0].get("def", "").strip()
        if first_def and title not in lookup:
            lookup[title] = first_def

    print(f"  Loaded {len(lookup)} moedict entries", file=sys.stderr)
    return lookup


def load_makemeahanzi(path: str) -> dict:
    """
    Load makemeahanzi etymology.json (one JSON object per line).
    Returns: semantic_radical → [characters that use it semantically]
    """
    print(f"Loading makemeahanzi from {path}...", file=sys.stderr)
    semantic_map: dict[str, list[str]] = defaultdict(list)

    with open(path, encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                entry = json.loads(line)
            except json.JSONDecodeError:
                continue
            char = entry.get("character", "")
            if not char:
                continue
            etym = entry.get("etymology") or {}
            semantic = etym.get("semantic", "")
            if semantic:
                semantic_map[semantic].append(char)

    print(f"  Found {len(semantic_map)} semantic radicals in makemeahanzi", file=sys.stderr)
    return dict(semantic_map)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def truncate_moedict_meaning(full_def: str) -> str:
    """Extract a short educational meaning from a full moedict definition."""
    for sep in ["。", "；", "，", "：", "、"]:
        idx = full_def.find(sep)
        if idx != -1 and idx < 50:
            return full_def[:idx]
    return full_def[:40]


def build_related_chars(
    radical_char: str,
    base_radical: str | None,
    makemeahanzi_map: dict,
) -> list[str]:
    """Return up to 10 related chars from makemeahanzi semantic map."""
    related_raw = makemeahanzi_map.get(radical_char, [])
    if not related_raw and base_radical:
        related_raw = makemeahanzi_map.get(base_radical, [])

    # Filter to CJK unified ideographs only
    related_filtered = [
        c for c in related_raw
        if len(c) == 1 and 0x4E00 <= ord(c) <= 0x9FFF
        and c != radical_char and c != base_radical
    ]

    seen: set[str] = set()
    deduped: list[str] = []
    for c in related_filtered:
        if c not in seen:
            seen.add(c)
            deduped.append(c)

    return deduped[:10]


# ---------------------------------------------------------------------------
# Main builder
# ---------------------------------------------------------------------------

def build_output(
    branneman: list,
    moedict_lookup: dict,
    makemeahanzi_map: dict,
) -> dict:
    """Assemble radical-meanings.json v2.0."""

    result: dict = {
        "_metadata": {
            "version": "2.0",
            "generatedAt": str(date.today()),
            "totalRadicals": 0,
            "sources": [
                {
                    "name": "手動編寫 (radicals.ts)",
                    "priority": 1,
                    "license": "internal",
                    "description": "Hand-curated entries in radicals.ts override this file at runtime",
                },
                {
                    "name": "branneman/214-kangxi-radicals",
                    "priority": 2,
                    "url": "https://gist.github.com/branneman/f93d596ac236f0dbd9fb5b1a5099122f",
                    "downloadUrl": "https://gist.githubusercontent.com/branneman/f93d596ac236f0dbd9fb5b1a5099122f/raw/radicals.json",
                    "downloadedAt": str(date.today()),
                    "license": "none declared",
                    "description": "214 Kangxi radicals with English meanings, pinyin, stroke counts",
                },
                {
                    "name": "moedict (教育部重編國語辭典)",
                    "priority": 3,
                    "url": "https://github.com/g0v/moedict-data",
                    "license": "MOE open data",
                    "description": "Ministry of Education Traditional Chinese dictionary — zh-TW definitions",
                },
                {
                    "name": "makemeahanzi",
                    "priority": 4,
                    "url": "https://github.com/skishore/makemeahanzi",
                    "license": "LGPL",
                    "description": "etymology.json — semantic radical → related characters mapping",
                },
            ],
        }
    }

    branneman_url = "https://gist.github.com/branneman/f93d596ac236f0dbd9fb5b1a5099122f"
    moedict_url = "https://github.com/g0v/moedict-data"
    makemeahanzi_url = "https://github.com/skishore/makemeahanzi"

    def build_entry(
        radical_char: str,
        english_meaning: str,
        stroke_count: int,
        base_radical: str | None = None,
    ) -> dict:
        entry: dict = {}

        # --- meaning (Traditional Chinese): moedict first ---
        lookup_char = base_radical if base_radical else radical_char
        moe_full = moedict_lookup.get(lookup_char, "")
        if moe_full:
            short = truncate_moedict_meaning(moe_full)
            if base_radical:
                short = f"{short}（{base_radical}的變體）"
            entry["meaning"] = short
            entry["meaningSource"] = "moedict"
            entry["meaningSourceUrl"] = moedict_url
        else:
            entry["meaning"] = english_meaning
            entry["meaningSource"] = "branneman"
            entry["meaningSourceUrl"] = branneman_url

        # --- englishMeaning ---
        if english_meaning:
            entry["englishMeaning"] = english_meaning

        # --- strokeCount ---
        entry["strokeCount"] = stroke_count

        # --- baseRadical for variant forms ---
        if base_radical:
            entry["baseRadical"] = base_radical

        # --- relatedChars from makemeahanzi semantic map ---
        related = build_related_chars(radical_char, base_radical, makemeahanzi_map)
        if related:
            entry["relatedChars"] = related
            entry["relatedCharsSource"] = "makemeahanzi"
            entry["relatedCharsSourceUrl"] = makemeahanzi_url
        else:
            entry["relatedChars"] = []
            entry["relatedCharsSource"] = "none"

        return entry

    # --- 214 Kangxi radicals ---
    for rad in branneman:
        char = rad["radical"]
        english = rad.get("english", "")
        strokes = rad.get("strokeCount", 0)
        result[char] = build_entry(char, english, strokes, base_radical=None)

    # --- Common variant forms ---
    for var_char, (var_english, var_strokes) in VARIANT_CHARS_INFO.items():
        base = VARIANT_TO_BASE.get(var_char)
        result[var_char] = build_entry(var_char, var_english, var_strokes, base_radical=base)

    # Update metadata count (exclude _metadata key)
    result["_metadata"]["totalRadicals"] = len(result) - 1
    return result


# ---------------------------------------------------------------------------
# Verify
# ---------------------------------------------------------------------------

def verify_output(output: dict, lesson_chars_path: str | None = None) -> bool:
    """Run sanity checks. Returns True if all pass."""
    ok = True
    radicals = {k: v for k, v in output.items() if k != "_metadata"}

    print("\n=== Verification ===", file=sys.stderr)
    print(f"  Total radical entries: {len(radicals)}", file=sys.stderr)

    # 214 Kangxi radicals coverage
    branneman_path = "data/raw/radical-sources/branneman-214-radicals.json"
    try:
        kangxi = json.load(open(branneman_path))
        missing = [r["radical"] for r in kangxi if r["radical"] not in radicals]
        if missing:
            print(f"  WARNING: Missing {len(missing)} Kangxi radicals: {missing[:10]}", file=sys.stderr)
            ok = False
        else:
            print(f"  OK: All 214 Kangxi radicals present", file=sys.stderr)
    except FileNotFoundError:
        print(f"  SKIP: branneman file not found for coverage check", file=sys.stderr)

    # relatedChars coverage
    with_related = sum(1 for v in radicals.values() if v.get("relatedChars"))
    print(f"  relatedChars coverage: {with_related}/{len(radicals)} ({100*with_related//len(radicals) if radicals else 0}%)", file=sys.stderr)

    # moedict meaning coverage
    with_moe = sum(1 for v in radicals.values() if v.get("meaningSource") == "moedict")
    print(f"  moedict meaning coverage: {with_moe}/{len(radicals)} ({100*with_moe//len(radicals) if radicals else 0}%)", file=sys.stderr)

    # Spot check key pedagogical radicals
    spot_check = ["氵", "扌", "忄", "口", "木", "火", "水", "人", "亻", "心"]
    print("  Spot check:", file=sys.stderr)
    for char in spot_check:
        entry = radicals.get(char, {})
        meaning = entry.get("meaning", "MISSING")[:20]
        related_count = len(entry.get("relatedChars", []))
        source = entry.get("meaningSource", "?")
        print(f"    {char}: [{source}] {meaning!r}  relatedChars={related_count}", file=sys.stderr)
        if char not in radicals:
            ok = False

    # Lesson char coverage (optional — decompositions-generated.json keys)
    if lesson_chars_path:
        try:
            lesson_data = json.load(open(lesson_chars_path))
            if isinstance(lesson_data, dict):
                all_chars = set(lesson_data.keys())
            else:
                all_chars = set(lesson_data)
            covered = sum(1 for c in all_chars if c in radicals)
            pct = 100 * covered // len(all_chars) if all_chars else 0
            print(f"  Lesson char coverage: {covered}/{len(all_chars)} ({pct}%)", file=sys.stderr)
            if pct < 95:
                print(f"  INFO: lesson char coverage {pct}% (radicals != lesson chars, this is expected)", file=sys.stderr)
        except FileNotFoundError:
            pass

    return ok


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

def main():
    parser = argparse.ArgumentParser(description="Build radical-meanings.json v2.0 (zh-TW only)")
    parser.add_argument("--branneman", default="data/raw/radical-sources/branneman-214-radicals.json",
                        help="Path to branneman 214 radicals JSON")
    parser.add_argument("--moedict", default="/tmp/moedict.json",
                        help="Path to moedict.json (optional, skipped if not found)")
    parser.add_argument("--makemeahanzi", default="/tmp/makemeahanzi.txt",
                        help="Path to makemeahanzi etymology.json lines (optional)")
    parser.add_argument("--output", default="frontend/src/data/radical-meanings.json",
                        help="Output path")
    parser.add_argument("--lesson-chars", default=None,
                        help="Optional: decompositions-generated.json path for coverage check")
    args = parser.parse_args()

    branneman = load_branneman(args.branneman)

    moedict_lookup: dict = {}
    try:
        moedict_lookup = load_moedict(args.moedict)
    except FileNotFoundError:
        print(f"  WARNING: moedict not found at {args.moedict}, Chinese meanings will fall back to English", file=sys.stderr)

    makemeahanzi_map: dict = {}
    try:
        makemeahanzi_map = load_makemeahanzi(args.makemeahanzi)
    except FileNotFoundError:
        print(f"  WARNING: makemeahanzi not found at {args.makemeahanzi}, relatedChars will be empty", file=sys.stderr)

    print("Building radical database v2.0 (zh-TW)...", file=sys.stderr)
    output = build_output(branneman, moedict_lookup, makemeahanzi_map)

    verify_output(output, lesson_chars_path=args.lesson_chars)

    with open(args.output, "w", encoding="utf-8") as f:
        json.dump(output, f, ensure_ascii=False, indent=2)

    total = output["_metadata"]["totalRadicals"]
    print(f"\nWritten {total} radical entries to {args.output}", file=sys.stderr)


if __name__ == "__main__":
    main()
