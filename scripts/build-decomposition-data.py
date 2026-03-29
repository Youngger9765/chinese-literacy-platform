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
    # --------------------------------------------------------------------------
    # Characters where makemeahanzi pictophonetic only has semantic OR phonetic
    # (missing the other half), so the auto-builder emits only 1 component.
    # Fixed by listing all visible surface components in stroke order.
    # --------------------------------------------------------------------------

    # 雜: decomp ⿰⿳亠从木隹 — semantic missing; phonetic=隹; surface: 九+木+隹
    "雜": {
        "formula": "九 + 木 + 隹",
        "components": [
            {"radical": "九", "role": "部件", "label": "九"},
            {"radical": "木", "role": "部件", "label": "木"},
            {"radical": "隹", "role": "聲符", "label": "短尾鳥"},
        ],
    },
    # 德: decomp ⿰彳⿱⿱十罒⿱一心 — phonetic missing; semantic=心; surface: 彳+十+罒+心
    "德": {
        "formula": "彳 + 十 + 罒 + 心",
        "components": [
            {"radical": "彳", "role": "形符", "label": "行旁"},
            {"radical": "十", "role": "部件", "label": "十"},
            {"radical": "罒", "role": "部件", "label": "網罟"},
            {"radical": "心", "role": "部件", "label": "心"},
        ],
    },
    # 惱: decomp ⿰忄⿱巛囟 — phonetic missing; semantic=忄; surface: 忄+囟
    "惱": {
        "formula": "忄 + 囟",
        "components": [
            {"radical": "忄", "role": "形符", "label": "心旁"},
            {"radical": "囟", "role": "聲符", "label": "腦頂"},
        ],
    },
    # 贏: decomp ⿵吂⿲⺼貝？ — phonetic missing; semantic=貝; surface: 亡+口+月+貝+凡
    "贏": {
        "formula": "亡 + 口 + 月 + 貝 + 凡",
        "components": [
            {"radical": "亡", "role": "部件", "label": "亡"},
            {"radical": "口", "role": "部件", "label": "口"},
            {"radical": "月", "role": "部件", "label": "月亮"},
            {"radical": "貝", "role": "形符", "label": "貝"},
            {"radical": "凡", "role": "部件", "label": "凡"},
        ],
    },
    # 參: decomp ⿳厽人彡 — semantic missing; phonetic=彡; surface: ⺶+大+彡
    "參": {
        "formula": "⺶ + 大 + 彡",
        "components": [
            {"radical": "⺶", "role": "部件", "label": "羊頭"},
            {"radical": "大", "role": "部件", "label": "大"},
            {"radical": "彡", "role": "聲符", "label": "紋飾"},
        ],
    },
    # 霸: decomp ⿱雨⿰革月 — phonetic missing; semantic=雨; surface: 雨+革+月
    "霸": {
        "formula": "雨 + 革 + 月",
        "components": [
            {"radical": "雨", "role": "形符", "label": "雨"},
            {"radical": "革", "role": "部件", "label": "皮革"},
            {"radical": "月", "role": "部件", "label": "月亮"},
        ],
    },
    # 但: decomp ⿰亻旦 — semantic missing; phonetic=旦; surface: 亻+旦
    "但": {
        "formula": "亻 + 旦",
        "components": [
            {"radical": "亻", "role": "形符", "label": "人旁"},
            {"radical": "旦", "role": "聲符", "label": "旦"},
        ],
    },
    # 低: decomp ⿰亻氐 — semantic missing; phonetic=氐; surface: 亻+氐
    "低": {
        "formula": "亻 + 氐",
        "components": [
            {"radical": "亻", "role": "形符", "label": "人旁"},
            {"radical": "氐", "role": "聲符", "label": "氐"},
        ],
    },
    # 列: decomp ⿰歹刂 — phonetic missing; semantic=刂; surface: 歹+刂
    "列": {
        "formula": "歹 + 刂",
        "components": [
            {"radical": "歹", "role": "部件", "label": "歹"},
            {"radical": "刂", "role": "形符", "label": "刀旁"},
        ],
    },
    # 沒: decomp ⿰氵⿱？又 — phonetic missing; semantic=氵; surface: 氵+殳
    "沒": {
        "formula": "氵 + 殳",
        "components": [
            {"radical": "氵", "role": "形符", "label": "水旁"},
            {"radical": "殳", "role": "聲符", "label": "殳"},
        ],
    },
    # 沿: decomp ⿰氵⿱几口 — phonetic missing; semantic=氵; surface: 氵+几+口
    "沿": {
        "formula": "氵 + 几 + 口",
        "components": [
            {"radical": "氵", "role": "形符", "label": "水旁"},
            {"radical": "几", "role": "部件", "label": "几"},
            {"radical": "口", "role": "部件", "label": "口"},
        ],
    },
    # 春: decomp ⿱？日 — phonetic missing; semantic=日; surface: 三+人+日 (屯+日)
    "春": {
        "formula": "三 + 人 + 日",
        "components": [
            {"radical": "三", "role": "部件", "label": "三"},
            {"radical": "人", "role": "部件", "label": "人"},
            {"radical": "日", "role": "形符", "label": "太陽"},
        ],
    },
    # 黑: decomp ⿱？灬 — ideographic; surface: 口+土+灬
    "黑": {
        "formula": "口 + 土 + 灬",
        "components": [
            {"radical": "口", "role": "部件", "label": "口"},
            {"radical": "土", "role": "部件", "label": "土"},
            {"radical": "灬", "role": "部件", "label": "火底"},
        ],
    },
    # 約: decomp ⿰糹勺 — phonetic missing; semantic=糹; surface: 糹+勺
    "約": {
        "formula": "糹 + 勺",
        "components": [
            {"radical": "糹", "role": "形符", "label": "絲線"},
            {"radical": "勺", "role": "聲符", "label": "勺"},
        ],
    },
    # 探: decomp ⿰扌⿱？木 — phonetic missing; semantic=扌; surface: 扌+穴+木
    "探": {
        "formula": "扌 + 穴 + 木",
        "components": [
            {"radical": "扌", "role": "形符", "label": "手旁"},
            {"radical": "穴", "role": "部件", "label": "穴"},
            {"radical": "木", "role": "部件", "label": "木"},
        ],
    },
    # 拋: decomp ⿰扌⿺尢力 — phonetic missing; semantic=扌; surface: 扌+九+力
    "拋": {
        "formula": "扌 + 九 + 力",
        "components": [
            {"radical": "扌", "role": "形符", "label": "手旁"},
            {"radical": "九", "role": "部件", "label": "九"},
            {"radical": "力", "role": "部件", "label": "力量"},
        ],
    },
    # 拖: decomp ⿰扌⿱亻也 — phonetic missing; semantic=扌; surface: 扌+它
    "拖": {
        "formula": "扌 + 它",
        "components": [
            {"radical": "扌", "role": "形符", "label": "手旁"},
            {"radical": "它", "role": "聲符", "label": "它"},
        ],
    },
    # 塌: decomp ⿰土⿱日羽 — phonetic missing; semantic=土; surface: 土+日+羽
    "塌": {
        "formula": "土 + 日 + 羽",
        "components": [
            {"radical": "土", "role": "形符", "label": "土"},
            {"radical": "日", "role": "部件", "label": "太陽"},
            {"radical": "羽", "role": "部件", "label": "羽毛"},
        ],
    },
    # 塞: decomp ⿱宀⿱？土 — phonetic missing; semantic=土; surface: 宀+二+土
    "塞": {
        "formula": "宀 + 二 + 土",
        "components": [
            {"radical": "宀", "role": "部件", "label": "房頂"},
            {"radical": "二", "role": "部件", "label": "二"},
            {"radical": "土", "role": "形符", "label": "土"},
        ],
    },
    # 員: decomp ⿱口貝 — phonetic missing; semantic=貝; surface: 口+貝
    "員": {
        "formula": "口 + 貝",
        "components": [
            {"radical": "口", "role": "部件", "label": "口"},
            {"radical": "貝", "role": "形符", "label": "貝"},
        ],
    },
    # 容: decomp ⿱宀谷 — phonetic missing; semantic=宀; surface: 宀+谷
    "容": {
        "formula": "宀 + 谷",
        "components": [
            {"radical": "宀", "role": "形符", "label": "房頂"},
            {"radical": "谷", "role": "聲符", "label": "山谷"},
        ],
    },
    # 疫: decomp ⿸疒殳 — phonetic missing; semantic=疒; surface: 疒+殳
    "疫": {
        "formula": "疒 + 殳",
        "components": [
            {"radical": "疒", "role": "形符", "label": "病旁"},
            {"radical": "殳", "role": "聲符", "label": "殳"},
        ],
    },
    # 秀: decomp ⿱禾乃 — phonetic missing; semantic=禾; surface: 禾+乃
    "秀": {
        "formula": "禾 + 乃",
        "components": [
            {"radical": "禾", "role": "形符", "label": "穀物"},
            {"radical": "乃", "role": "部件", "label": "乃"},
        ],
    },
    # 款: decomp ⿰⿱士示欠 — phonetic missing; semantic=欠; surface: 士+示+欠
    "款": {
        "formula": "士 + 示 + 欠",
        "components": [
            {"radical": "士", "role": "部件", "label": "士"},
            {"radical": "示", "role": "部件", "label": "祭祀"},
            {"radical": "欠", "role": "形符", "label": "欠"},
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
