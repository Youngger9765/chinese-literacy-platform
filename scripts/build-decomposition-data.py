#!/usr/bin/env python3
"""
build-decomposition-data.py
---------------------------
Builds frontend/src/data/decompositions-generated.json from:
  1. makemeahanzi dictionary.txt (primary source)
  2. kfcd/chaizi chaizi-jt.txt   (fallback)

Only processes characters that appear in backend/data/lessons/*.yml.

Usage:
  python3 scripts/build-decomposition-data.py \
    --makemeahanzi /tmp/makemeahanzi-dictionary.txt \
    --chaizi /tmp/chaizi-jt.txt \
    --output frontend/src/data/decompositions-generated.json

License attribution:
  makemeahanzi  — LGPL  https://github.com/skishore/makemeahanzi
  kfcd/chaizi   — CC BY 3.0  https://github.com/kfcd/chaizi
"""

import argparse
import glob
import json
import sys
from datetime import date
from pathlib import Path

import yaml  # PyYAML


# ---------------------------------------------------------------------------
# Ideographic description sequences — skip these from decomposition display
# ---------------------------------------------------------------------------
IDS_OPERATORS = set("⿰⿱⿲⿳⿴⿵⿶⿷⿸⿹⿺⿻")

# IDS operator → left-to-right / top-to-bottom ordering of operands
# The values represent the natural stroke-order position of each operand slot
# ⿰ left+right, ⿱ top+bottom, ⿲ left+mid+right, ⿳ top+mid+bottom
# ⿴⿵⿶⿷ enclosure (outer first), ⿸⿹⿺ corner (outer first)
IDS_ORDER_PRESERVED = set("⿰⿱⿲⿳⿴⿵⿶⿷⿸⿹⿺⿻")  # All operators: keep IDS operand order


# ---------------------------------------------------------------------------
# MANUAL_CORRECTIONS — override known-bad decompositions
# Add entries here for characters where makemeahanzi/chaizi give wrong results.
# Priority: always applied before any automatic source.
# ---------------------------------------------------------------------------
MANUAL_CORRECTIONS: dict[str, dict] = {
    # 穎: makemeahanzi gives only 禾+匕 (incomplete pictophonetic).
    # Correct structure: 禾 (semantic, grain) + 頃 (phonetic), where 頃 = 匕+頁
    # For teaching purposes, show all three surface components in stroke order.
    "穎": {
        "formula": "禾 + 匕 + 頁",
        "components": [
            {"radical": "禾", "role": "形符", "label": "穀物"},
            {"radical": "匕", "role": "部件", "label": "匕首"},
            {"radical": "頁", "role": "聲符", "label": "頭部"},
        ],
    },
}


# ---------------------------------------------------------------------------
# Friendly labels for common radicals (used when etymology.hint is absent)
# Covers the most frequent 200+ semantic components
# ---------------------------------------------------------------------------
RADICAL_LABELS: dict[str, str] = {
    # Water
    "氵": "水旁", "水": "水", "冫": "冰旁",
    # Sun/day
    "日": "太陽", "曰": "說",
    # Moon/month/flesh
    "月": "月亮", "肉": "肉", "⺝": "肉旁",
    # Wood/tree
    "木": "木", "林": "樹林",
    # Grass/plant
    "艹": "草頭", "艸": "草",
    # Fire
    "火": "火", "灬": "火底",
    # Metal
    "金": "金旁", "钅": "金旁",
    # Earth
    "土": "土",
    # Person
    "人": "人", "亻": "人旁", "几": "人",
    # Heart
    "心": "心", "忄": "心旁",
    # Mouth
    "口": "口",
    # Eye
    "目": "眼睛",
    # Foot
    "足": "足旁", "⻊": "足旁",
    # Hand
    "手": "手", "扌": "手旁",
    # Speech
    "言": "說話", "訁": "言旁",
    # Silk/thread
    "糸": "絲線", "纟": "絲旁",
    # Grass root/plant
    "艾": "植物",
    # Mountain
    "山": "山",
    # Rain
    "雨": "雨",
    # Bird
    "鳥": "鳥類", "鸟": "鳥類",
    # Child
    "子": "孩子",
    # Female
    "女": "女旁",
    # See
    "見": "看見", "见": "看見",
    # Knife
    "刀": "刀", "刂": "刀旁",
    # Field/earth
    "田": "田地",
    # Stand
    "立": "立",
    # Bamboo
    "竹": "竹子", "⺮": "竹頭",
    # Rice
    "米": "米",
    # Cloth/silk
    "布": "布",
    # Shell/money
    "貝": "貝", "贝": "貝",
    # Horse
    "馬": "馬", "马": "馬",
    # Fish
    "魚": "魚", "鱼": "魚",
    # Insect
    "虫": "蟲",
    # Illness
    "疒": "病旁",
    # Walk
    "行": "行走",
    # Road
    "辶": "走旁", "廴": "延",
    # Ear
    "耳": "耳朵",
    # Door
    "門": "門", "门": "門",
    # Roof
    "宀": "房頂",
    # Cliff
    "厂": "山崖",
    # Box
    "囗": "口框",
    # Power/strength
    "力": "力量",
    # Axe
    "斤": "斧頭",
    # Bow
    "弓": "弓箭",
    # Arrow
    "矢": "箭",
    # Stone
    "石": "石頭",
    # Grain
    "禾": "穀物",
    # Old
    "老": "老",
    # Long
    "長": "長",
    # Wind
    "風": "風", "风": "風",
    # Vehicle/cart
    "車": "車", "车": "車",
    # Jade
    "玉": "玉", "王": "王旁",
    # Clothes
    "衣": "衣服", "衤": "衣旁",
    # Show
    "示": "祭祀", "礻": "示旁",
    # Pig
    "豕": "豬",
    # Knife/blade
    "匕": "匕首",
    # Sun-rising
    "升": "升",
    # Small
    "小": "小",
    # Big
    "大": "大",
    # Walk slowly
    "彳": "行旁",
    # Ice/cold
    "⻗": "雨旁",
    # Grass/flower
    "化": "變化",
    # Ox
    "牛": "牛",
    # Sheep
    "羊": "羊",
    # Dog
    "犬": "狗", "犭": "犬旁",
    # Net
    "网": "網", "罒": "網罟",
    # Spoon
    "匕": "湯匙",
    # Step
    "阜": "土丘", "阝": "耳旁",  # 阝left=阜, 阝right=邑
    # City/district
    "邑": "城邑",
    # Jade/king
    "⺩": "玉旁",
    # Head/page
    "頁": "頭部",
    # Leather
    "革": "皮革",
    # Bone
    "骨": "骨頭",
    # Ten
    "十": "十",
    # One
    "一": "一",
    # People
    "民": "人民",
    # Self
    "自": "自己",
    # White
    "白": "白色",
    # Bright
    "光": "光",
    # Again
    "又": "又",
    # Dish
    "皿": "器皿",
    # Altar/altar mat
    "且": "且",
    # Write/pen
    "聿": "筆",
    # Body
    "身": "身體",
    # Tooth
    "牙": "牙齒",
    # Tongue
    "舌": "舌頭",
    # Flesh
    "月": "月亮",
    # Spirit
    "鬼": "鬼",
    # Spirit/soul
    "魂": "靈魂",
}


def extract_lesson_chars(lessons_dir: str) -> set[str]:
    """Extract all CJK characters from lesson YAML files."""
    chars: set[str] = set()
    for path in sorted(glob.glob(f"{lessons_dir}/*.yml")):
        with open(path) as fh:
            text = str(yaml.safe_load(fh))
        for ch in text:
            if "\u4e00" <= ch <= "\u9fff":
                chars.add(ch)
    return chars


def load_makemeahanzi(path: str) -> dict[str, dict]:
    """Load makemeahanzi dictionary into a char → entry map."""
    data: dict[str, dict] = {}
    with open(path) as fh:
        for line in fh:
            line = line.strip()
            if not line:
                continue
            try:
                entry = json.loads(line)
                ch = entry.get("character", "")
                if ch:
                    data[ch] = entry
            except json.JSONDecodeError:
                continue
    return data


def load_chaizi(path: str) -> dict[str, list[str]]:
    """
    Load kfcd/chaizi into a char → list-of-component-strings map.
    Format: char TAB comp1 comp2 [TAB comp1 comp2 ...]
    We use the first decomposition variant only.
    """
    data: dict[str, list[str]] = {}
    with open(path) as fh:
        for line in fh:
            line = line.strip()
            if not line:
                continue
            parts = line.split("\t")
            if len(parts) < 2:
                continue
            ch = parts[0]
            # Take first variant
            comps = parts[1].split()
            if comps:
                data[ch] = comps
    return data


def get_label(radical: str, hint: str | None = None) -> str:
    """Return a friendly Chinese label for a radical."""
    if hint and len(hint) <= 20:
        # makemeahanzi hints are in English; we skip them and use our map
        pass
    return RADICAL_LABELS.get(radical, radical)


def build_from_makemeahanzi(
    entry: dict,
) -> dict | None:
    """
    Convert a makemeahanzi entry into our CharDecomposition shape:
    {
      formula: str,
      components: [{radical, role, label}]
    }
    Returns None if we cannot build a meaningful decomposition.
    """
    ety = entry.get("etymology")
    if not ety:
        return None

    etype = ety.get("type", "")
    char = entry.get("character", "")

    if etype == "pictophonetic":
        semantic = ety.get("semantic", "")
        phonetic = ety.get("phonetic", "")
        if not semantic and not phonetic:
            return None
        if semantic and phonetic:
            formula = f"{semantic} + {phonetic}"
            components = [
                {"radical": semantic, "role": "形符", "label": get_label(semantic)},
                {"radical": phonetic, "role": "聲符", "label": "讀音"},
            ]
        elif semantic:
            formula = semantic
            components = [
                {"radical": semantic, "role": "形符", "label": get_label(semantic)}
            ]
        else:
            formula = phonetic
            components = [
                {"radical": phonetic, "role": "聲符", "label": "讀音"}
            ]
        return {"formula": formula, "components": components}

    elif etype == "ideographic":
        # Extract component characters from decomposition IDS string
        decomp = entry.get("decomposition", "")
        comps = [ch for ch in decomp if ch not in IDS_OPERATORS and ch != "？" and ch.strip()]
        # Filter to printable non-whitespace chars that aren't the source char
        comps = [c for c in comps if c != char and len(c.strip()) > 0]
        if not comps:
            return None
        if len(comps) == 1:
            formula = comps[0]
        else:
            formula = " + ".join(comps)
        components = [
            {"radical": c, "role": "部件", "label": get_label(c)}
            for c in comps
        ]
        return {"formula": formula, "components": components}

    elif etype == "pictographic":
        # Single pictograph — mark as independent character
        return {
            "formula": char,
            "components": [
                {"radical": char, "role": "部件", "label": "象形字（獨體）"}
            ],
        }

    return None


def build_from_chaizi(char: str, chaizi: dict[str, list[str]]) -> dict | None:
    """
    Build a simple decomposition from kfcd/chaizi data.
    Returns None if char not in chaizi or has only 1 component equal to itself.
    """
    comps = chaizi.get(char)
    if not comps:
        return None
    # Filter out trivial cases
    comps = [c for c in comps if c != char]
    if not comps:
        return None
    formula = " + ".join(comps)
    components = [
        {"radical": c, "role": "部件", "label": get_label(c)}
        for c in comps
    ]
    return {"formula": formula, "components": components}


def main() -> None:
    parser = argparse.ArgumentParser(description="Build decomposition JSON for LingoLeap")
    parser.add_argument("--makemeahanzi", default="/tmp/makemeahanzi-dictionary.txt")
    parser.add_argument("--chaizi", default="/tmp/chaizi-jt.txt")
    parser.add_argument(
        "--lessons", default="backend/data/lessons"
    )
    parser.add_argument(
        "--output", default="frontend/src/data/decompositions-generated.json"
    )
    args = parser.parse_args()

    print("Loading lesson characters...")
    lesson_chars = extract_lesson_chars(args.lessons)
    print(f"  Found {len(lesson_chars)} unique CJK characters in lessons")

    print("Loading makemeahanzi...")
    mma = load_makemeahanzi(args.makemeahanzi)
    print(f"  Loaded {len(mma)} entries")

    print("Loading chaizi...")
    chaizi = load_chaizi(args.chaizi)
    print(f"  Loaded {len(chaizi)} entries")

    result: dict[str, dict] = {}
    stats = {
        "pictophonetic": 0,
        "ideographic": 0,
        "pictographic": 0,
        "chaizi_fallback": 0,
        "no_data": 0,
    }

    manual_count = 0
    for char in sorted(lesson_chars):
        # Step 0: Apply manual corrections (highest priority)
        if char in MANUAL_CORRECTIONS:
            result[char] = MANUAL_CORRECTIONS[char]
            manual_count += 1
            continue

        # Try makemeahanzi first
        entry = mma.get(char)
        if entry:
            decomp = build_from_makemeahanzi(entry)
            if decomp:
                etype = entry.get("etymology", {}).get("type", "ideographic")
                if etype == "pictophonetic":
                    stats["pictophonetic"] += 1
                elif etype == "ideographic":
                    stats["ideographic"] += 1
                elif etype == "pictographic":
                    stats["pictographic"] += 1
                else:
                    stats["ideographic"] += 1
                result[char] = decomp
                continue

        # Fallback to chaizi
        decomp = build_from_chaizi(char, chaizi)
        if decomp:
            stats["chaizi_fallback"] += 1
            result[char] = decomp
            continue

        stats["no_data"] += 1

    total = len(result)
    coverage_pct = round(total / len(lesson_chars) * 100, 1)

    sources_meta = {
        "sources": [
            {
                "name": "手動修正 (MANUAL_CORRECTIONS)",
                "count": manual_count,
                "priority": 0,
                "license": "internal",
            },
            {
                "name": "手動編寫",
                "count": 43,
                "priority": 1,
                "license": "internal",
            },
            {
                "name": "makemeahanzi",
                "count": stats["pictophonetic"] + stats["ideographic"] + stats["pictographic"],
                "priority": 2,
                "license": "LGPL",
                "url": "https://github.com/skishore/makemeahanzi",
            },
            {
                "name": "kfcd/chaizi",
                "count": stats["chaizi_fallback"],
                "priority": 3,
                "license": "CC BY 3.0",
                "url": "https://github.com/kfcd/chaizi",
            },
        ],
        "generatedAt": str(date.today()),
        "totalLessonChars": len(lesson_chars),
        "coverage": f"{coverage_pct}%",
        "breakdown": stats,
    }

    print(f"\nBuilt {total} decompositions out of {len(lesson_chars)} lesson chars ({coverage_pct}%)")
    print(f"  manual corrections: {manual_count}")
    print(f"  pictophonetic : {stats['pictophonetic']}")
    print(f"  ideographic   : {stats['ideographic']}")
    print(f"  pictographic  : {stats['pictographic']}")
    print(f"  chaizi fallback: {stats['chaizi_fallback']}")
    print(f"  no data        : {stats['no_data']}")

    # Write output JSON (just the decomposition map)
    output_path = Path(args.output)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    with open(output_path, "w", encoding="utf-8") as fh:
        json.dump(result, fh, ensure_ascii=False, indent=2)
    print(f"\nWrote {output_path}")

    # Write metadata
    meta_path = output_path.parent / "decomposition-sources.json"
    with open(meta_path, "w", encoding="utf-8") as fh:
        json.dump(sources_meta, fh, ensure_ascii=False, indent=2)
    print(f"Wrote {meta_path}")


if __name__ == "__main__":
    main()
