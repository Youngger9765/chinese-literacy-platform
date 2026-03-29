#!/usr/bin/env python3
"""
Build radical-meanings.json from open data sources:
  1. moedict (教育部重編國語辭典) — Chinese meanings
  2. makemeahanzi — relatedChars via etymology.semantic
  3. branneman 214 radicals — base list with English meanings + stroke counts

Usage:
  python3 scripts/build-radical-meanings.py \
    --moedict /tmp/moedict.json \
    --makemeahanzi /tmp/makemeahanzi.txt \
    --radicals214 /tmp/radicals-214.json \
    --output frontend/src/data/radical-meanings.json
"""

import argparse
import json
import sys
from datetime import date
from collections import defaultdict

# ---------------------------------------------------------------------------
# Variant → base radical mapping
# ---------------------------------------------------------------------------

VARIANT_TO_BASE = {
    # Water
    "氵": "水",
    "冫": "水",
    # Hand
    "扌": "手",
    "龵": "手",
    # Heart/mind
    "忄": "心",
    # Person
    "亻": "人",
    # Speech
    "讠": "言",
    "訁": "言",
    # Metal/gold
    "钅": "金",
    "釒": "金",
    # Food
    "饣": "食",
    "飠": "食",
    # Silk/thread
    "纟": "糸",
    "糹": "糸",
    # Dog/animal
    "犭": "犬",
    # Spirit/show
    "礻": "示",
    # Clothing
    "衤": "衣",
    # Fire (bottom form)
    "灬": "火",
    # Knife (side form)
    "刂": "刀",
    # Mound/hill (left 阝)
    # Note: 阝 on left = 阜, on right = 邑. We treat left as 阜.
    # We handle this by adding both mappings and letting the data context decide.
    # For simplicity, map to 阜 (most common educational mapping).
    "阝": "阜",
}

# All the radicals we want to include (214 Kangxi + common variants)
VARIANT_CHARS = set(VARIANT_TO_BASE.keys())


def load_moedict(path: str) -> dict:
    """Load moedict and return a lookup dict: character → first definition."""
    print(f"Loading moedict from {path}...", file=sys.stderr)
    with open(path, encoding="utf-8") as f:
        data = json.load(f)

    lookup = {}
    for entry in data:
        title = entry.get("title", "")
        if not title:
            continue
        # Skip entries with curly-brace encoded titles (rare variant chars)
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
    Load makemeahanzi and return:
      semantic_char_map: semantic_radical → [characters that use it semantically]
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


def load_radicals214(path: str) -> list:
    """Load branneman 214 radicals JSON."""
    print(f"Loading 214 radicals from {path}...", file=sys.stderr)
    with open(path, encoding="utf-8") as f:
        data = json.load(f)
    print(f"  Loaded {len(data)} radicals", file=sys.stderr)
    return data


def truncate_moedict_meaning(full_def: str, radical: str) -> str:
    """
    Extract a short, educational meaning from a moedict full definition.
    Takes up to the first sentence-ending punctuation or 30 characters.
    """
    # Remove citation-like text in parentheses at the end
    import re
    # Take only up to first period, semicolon, or 'see' reference
    # Split on common full stops in Chinese
    for sep in ["。", "；", "，", "：", "、"]:
        idx = full_def.find(sep)
        if idx != -1 and idx < 50:
            return full_def[:idx]
    # Fallback: take first 40 chars
    return full_def[:40]


def build_output(radicals214, moedict_lookup, makemeahanzi_map) -> dict:
    """Assemble the radical-meanings.json output."""

    result = {
        "_metadata": {
            "sources": [
                {
                    "name": "moedict (教育部重編國語辭典)",
                    "url": "https://github.com/g0v/moedict-data",
                    "license": "MOE open data",
                },
                {
                    "name": "makemeahanzi",
                    "url": "https://github.com/skishore/makemeahanzi",
                    "license": "LGPL",
                },
                {
                    "name": "214 Kangxi radicals",
                    "url": "https://gist.github.com/branneman/f93d596ac236f0dbd9fb5b1a5099122f",
                    "license": "none declared",
                },
            ],
            "generatedAt": str(date.today()),
            "totalRadicals": 0,  # filled at end
        }
    }

    def process_radical(radical_char: str, english_meaning: str, stroke_count: int,
                        base_radical: str | None = None) -> dict:
        """Build a single radical entry."""
        entry: dict = {}

        # Chinese meaning from moedict
        lookup_char = base_radical if base_radical else radical_char
        moe_full = moedict_lookup.get(lookup_char, "")
        if moe_full:
            short_meaning = truncate_moedict_meaning(moe_full, lookup_char)
            if base_radical:
                short_meaning = f"{short_meaning}（{base_radical}的變體）"
            entry["meaning"] = short_meaning
            entry["meaningSource"] = "moedict"
            entry["meaningSourceUrl"] = "https://github.com/g0v/moedict-data"
        else:
            entry["meaning"] = english_meaning
            entry["meaningSource"] = "branneman-214"
            entry["meaningSourceUrl"] = "https://gist.github.com/branneman/f93d596ac236f0dbd9fb5b1a5099122f"

        entry["englishMeaning"] = english_meaning
        entry["strokeCount"] = stroke_count

        if base_radical:
            entry["baseRadical"] = base_radical

        # Related chars from makemeahanzi (cap at 10)
        # Try the radical itself first, then base radical
        related_raw = makemeahanzi_map.get(radical_char, [])
        if not related_raw and base_radical:
            related_raw = makemeahanzi_map.get(base_radical, [])

        # Filter: only include CJK unified ideographs (U+4E00–U+9FFF range)
        related_filtered = [
            c for c in related_raw
            if len(c) == 1 and 0x4E00 <= ord(c) <= 0x9FFF and c != radical_char and c != base_radical
        ]
        # Deduplicate while preserving order
        seen = set()
        deduped = []
        for c in related_filtered:
            if c not in seen:
                seen.add(c)
                deduped.append(c)

        if deduped:
            entry["relatedChars"] = deduped[:10]
            entry["relatedCharsSource"] = "makemeahanzi"
            entry["relatedCharsSourceUrl"] = "https://github.com/skishore/makemeahanzi"
        else:
            entry["relatedChars"] = []
            entry["relatedCharsSource"] = "none"

        return entry

    # Process all 214 Kangxi radicals
    for rad in radicals214:
        char = rad["radical"]
        english = rad.get("english", "")
        strokes = rad.get("strokeCount", 0)
        entry = process_radical(char, english, strokes, base_radical=None)
        result[char] = entry

    # Process common variants
    variants_info = {
        "氵": ("water (flowing)", 3),
        "冫": ("ice / water (side)", 2),
        "扌": ("hand (side)", 3),
        "忄": ("heart / mind (side)", 3),
        "亻": ("person (side)", 2),
        "讠": ("speech / language (simplified)", 2),
        "訁": ("speech / language (traditional side)", 2),
        "钅": ("metal / gold (simplified side)", 5),
        "釒": ("metal / gold (traditional side)", 8),
        "饣": ("food (simplified side)", 3),
        "飠": ("food (traditional side)", 8),
        "纟": ("silk / thread (simplified side)", 3),
        "糹": ("silk / thread (traditional side)", 6),
        "犭": ("dog / animal (side)", 3),
        "礻": ("spirit / altar (side)", 4),
        "衤": ("clothing (side)", 5),
        "灬": ("fire (bottom)", 4),
        "刂": ("knife (side)", 2),
    }

    for var_char, (var_english, var_strokes) in variants_info.items():
        base = VARIANT_TO_BASE.get(var_char)
        entry = process_radical(var_char, var_english, var_strokes, base_radical=base)
        result[var_char] = entry

    # Update count (exclude _metadata key)
    result["_metadata"]["totalRadicals"] = len(result) - 1

    return result


def main():
    parser = argparse.ArgumentParser(description="Build radical-meanings.json")
    parser.add_argument("--moedict", default="/tmp/moedict.json")
    parser.add_argument("--makemeahanzi", default="/tmp/makemeahanzi.txt")
    parser.add_argument("--radicals214", default="/tmp/radicals-214.json")
    parser.add_argument("--output", default="frontend/src/data/radical-meanings.json")
    args = parser.parse_args()

    moedict_lookup = load_moedict(args.moedict)
    makemeahanzi_map = load_makemeahanzi(args.makemeahanzi)
    radicals214 = load_radicals214(args.radicals214)

    print("Building output...", file=sys.stderr)
    output = build_output(radicals214, moedict_lookup, makemeahanzi_map)

    total = output["_metadata"]["totalRadicals"]
    print(f"  Generated {total} radical entries", file=sys.stderr)

    with open(args.output, "w", encoding="utf-8") as f:
        json.dump(output, f, ensure_ascii=False, indent=2)

    print(f"Written to {args.output}", file=sys.stderr)

    # Quick sanity check
    for check_char in ["氵", "心", "口", "日", "月", "火", "木", "水"]:
        if check_char in output:
            e = output[check_char]
            print(f"  {check_char}: meaning={e.get('meaning', '')[:30]!r}  relatedChars={e.get('relatedChars', [])[:3]}")
        else:
            print(f"  WARNING: {check_char} not found in output!", file=sys.stderr)


if __name__ == "__main__":
    main()
