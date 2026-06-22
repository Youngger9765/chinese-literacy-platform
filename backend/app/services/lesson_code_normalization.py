"""
Lesson code normalization: static override maps + manifest code normalization.

Extracted from lesson_loader.py (Issue #1889).

Public API:
    CATALOG_TO_PARSED_OVERRIDE   — exported dict (public name, no underscore prefix)
    MULTI_LESSON_PRIMARY         — exported dict
    MULTI_LESSON_MAP             — exported dict
    normalize_manifest_code()    — public wrapper (preferred by new callers)
    halfwidth()                  — public wrapper

Internal aliases (_CATALOG_TO_PARSED_OVERRIDE etc.) are re-exported for
backward compatibility with existing tests that import the underscore names
directly from lesson_loader.
"""

import re


# ---------------------------------------------------------------------------
# Character normalization
# ---------------------------------------------------------------------------

def halfwidth(code: str) -> str:
    """Convert fullwidth ASCII letters (Ａ-Ｚ, ａ-ｚ) to halfwidth (A-Z, a-z).

    YAML fill_in_blank answers are sometimes typed as fullwidth (Ａ, Ｂ…)
    while vocab_bank keys are always halfwidth (A, B…), causing mismatches.
    """
    return "".join(
        chr(ord(c) - 0xFEE0) if 0xFF01 <= ord(c) <= 0xFF5E else c
        for c in (code or "")
    )


# ---------------------------------------------------------------------------
# Manifest code normalization
# ---------------------------------------------------------------------------

def normalize_manifest_code(code: str) -> str:
    """Normalize curriculum manifest lesson_code to match _parsed/*.yml lesson_code format.

    Examples:
        G4-L01  -> G4-L1
        G4-L03a -> G4-L3a
        WW-L01  -> 文-L1
    """
    if code.startswith("WW-"):
        m = re.search(r"L(\d+)", code)
        if m:
            return f"文-L{int(m.group(1))}"
        return code
    m = re.match(r"(G\d+)-L(\d+)(.*)", code)
    if m:
        grade_part = m.group(1)
        num = int(m.group(2))
        suffix = m.group(3)  # '', 'a', 'b'
        return f"{grade_part}-L{num}{suffix}"
    return code


# ---------------------------------------------------------------------------
# Multi-lesson YAML edge-case maps
# ---------------------------------------------------------------------------

# Curriculum slots that are covered by a multi-lesson YAML.
#
# Primary slots: curriculum code → compound lesson_code in parsed YAML
#   (these are loaded and exposed under the primary curriculum code)
# Secondary slots: curriculum code → compound lesson_code in parsed YAML
#   (these are skipped — content is accessible via the primary slot)
MULTI_LESSON_PRIMARY: dict[str, str] = {
    "G4-L20": "G4-L20-22",
    "G5-L24": "G5-L24-25",
    "G9-L15": "G9-L15-16",
    "G9-L17": "G9-L17-19",
}

MULTI_LESSON_MAP: dict[str, str] = {
    "G4-L21": "G4-L20-22",
    "G4-L22": "G4-L20-22",
    "G5-L25": "G5-L24-25",
    "G9-L16": "G9-L15-16",
    "G9-L18": "G9-L17-19",
    "G9-L19": "G9-L17-19",
}


# ---------------------------------------------------------------------------
# Catalog→parsed override maps
# ---------------------------------------------------------------------------

# Catalog code → parsed YAML lesson_code overrides (#1669).
#
# Two distinct correction patterns covered here:
#
# 1. G8 catalog↔Layer-2 offset (5 課): catalog uses curriculum sub-letter
#    numbering (G8-L03a/03b/04/05/...), Layer-2 uses sequential parse-order
#    (G8-L1/L2/L3/...). The default normalize_manifest_code produces the
#    wrong file (e.g. G8-L04 → G8-L4 = 植物肉, real story is G8-L5 = 玻璃娃娃).
#
# 2. G8 a/b sub-letter (8 課): each catalog a/b code maps to its own
#    distinct Layer-2 file (a/b are SEPARATE stories, NOT shared content).
#    This replaces the older _AB_SECONDARY_MAP design which incorrectly
#    assumed a/b sub-letters share one parsed file.
#
# 3. G7-L31 (1 課): shares Layer-2 G7-L23 (multi-text 第一篇/第二篇).
CATALOG_TO_PARSED_OVERRIDE: dict[str, str] = {
    # Category A: G8 offset (#1669) — catalog uses curriculum sub-letter
    # numbering, Layer-2 uses sequential parse-order. The offset grows by 1
    # each time an a/b split occurs in the curriculum.
    "G8-L4": "G8-L5",    # 好心沒好報玻璃娃娃 (catalog G8-L04 after normalize)
    "G8-L5": "G8-L6",    # 戲院賭場檳榔攤 (catalog G8-L05 after normalize)
    "G8-L7": "G8-L9",    # 讓黑猩猩被看見 (catalog G8-L07 after normalize)
    "G8-L8": "G8-L10",   # 按讚背後的真相 (catalog G8-L08 after normalize)
    "G8-L10": "G8-L13",  # 構樹 (catalog G8-L10 after normalize)
    "G8-L11": "G8-L14",  # 蝴蝶蘭花期密碼 (catalog G8-L11 after normalize)
    "G8-L13": "G8-L17",  # 我能不能選擇告別方式 (catalog G8-L13 after normalize)
    "G8-L14": "G8-L18",  # 石虎保育 (catalog G8-L14 after normalize)
    "G8-L15": "G8-L19",  # 核能的兩難抉擇 (catalog G8-L15 after normalize)
    # Category B: G8 sub-letter (each a/b has own parsed file)
    "G8-L3a": "G8-L3",   # 集中營的一門課
    "G8-L3b": "G8-L4",   # 新奇植物肉
    "G8-L6a": "G8-L7",   # 讓你口中的甜蜜
    "G8-L6b": "G8-L8",   # 隱形的征服者
    "G8-L9a": "G8-L11",  # 虎襲事件的真相
    "G8-L9b": "G8-L12",  # 語言的足跡
    "G8-L12a": "G8-L15", # 球場上的另類指揮家
    "G8-L12b": "G8-L16", # 我的阿嬤
    # Category C: G7-L31 (旅人鴿 = 第二篇 of G7-L23 multi-text docx)
    # Removed: G7-L31 now has its own parsed YAML (G7-L31.yml) built in #2392.
    # normalize_manifest_code("G7-L31") already returns "G7-L31" directly,
    # so no CATALOG_TO_PARSED_OVERRIDE entry is needed.
}

# Legacy: kept for backward compat; superseded by CATALOG_TO_PARSED_OVERRIDE.
# G8-L*b entries are now correctly routed to their own Layer-2 files (not
# shared with the a slot). Other entries here remain inert.
AB_SECONDARY_MAP: dict[str, str] = {}


# ---------------------------------------------------------------------------
# Backward-compat underscore aliases (used by lesson_loader.py internally
# and by tests that import private names directly from lesson_loader)
# ---------------------------------------------------------------------------

_MULTI_LESSON_PRIMARY = MULTI_LESSON_PRIMARY
_MULTI_LESSON_MAP = MULTI_LESSON_MAP
_CATALOG_TO_PARSED_OVERRIDE = CATALOG_TO_PARSED_OVERRIDE
_AB_SECONDARY_MAP = AB_SECONDARY_MAP


def catalog_to_parsed_code(catalog_code: str) -> str:
    """Map curriculum catalog code → parsed YAML ``lesson_code`` / filename stem.

    Mirrors ``load_layer2_lessons`` resolution (#1669).
    """
    norm = normalize_manifest_code(catalog_code)
    if norm in MULTI_LESSON_PRIMARY:
        return MULTI_LESSON_PRIMARY[norm]
    if norm in CATALOG_TO_PARSED_OVERRIDE:
        return CATALOG_TO_PARSED_OVERRIDE[norm]
    return norm


def parsed_to_catalog_codes(parsed_code: str) -> list[str]:
    """Reverse lookup: catalog slot(s) that load this parsed YAML file.

    DOCX batch / keypoints use parsed filenames (e.g. G8-L10 = 按讚 yaml).
    Loader ``grade_code`` uses catalog slots (e.g. G8-L8 = 按讚 in UI).
    """
    codes: list[str] = []
    for catalog, parsed in CATALOG_TO_PARSED_OVERRIDE.items():
        if parsed == parsed_code:
            codes.append(catalog)
    for catalog, compound in MULTI_LESSON_PRIMARY.items():
        if compound == parsed_code:
            codes.append(catalog)
    norm = normalize_manifest_code(parsed_code)
    if norm not in codes:
        codes.append(norm)
    return codes
