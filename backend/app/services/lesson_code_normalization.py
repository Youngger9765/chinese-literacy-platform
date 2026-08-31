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
        文-L08  -> 文-L8   (classical-Chinese prefix, same leading-zero strip)
    """
    if code.startswith("WW-"):
        m = re.search(r"L(\d+)", code)
        if m:
            return f"文-L{int(m.group(1))}"
        return code
    # Grade prefix is either Gn (G4, G9…) or 文 (classical Chinese). Both share
    # the same leading-zero strip; without 文 here, 文-L08 stayed padded and
    # never matched the unpadded parsed YAML (文-L8.yml) — splitting one lesson
    # into a "padded" duplicate the keypoints manifest / content gate missed.
    m = re.match(r"(G\d+|文)-L(\d+)(.*)", code)
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
    # EMPTY BY DESIGN (#2683).
    #
    # The first edition parsed several consecutive lessons into one compound YAML
    # (`G4-L20-22.yml`), so a catalogue code had to be redirected to that file. The
    # second edition extracts one file per lesson, and those compound stems do not
    # exist — leaving the pairs in place rewrote three live codes (G4-L20, G5-L24,
    # G9-L15) into filenames nothing can resolve.
}

MULTI_LESSON_MAP: dict[str, str] = {
    # EMPTY BY DESIGN (#2683) — see MULTI_LESSON_PRIMARY. Same compound-file
    # redirect, for the non-primary members of each range.
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
    # EMPTY BY DESIGN (#2683).
    #
    # This held 20-odd hand-maintained pairs patching a numbering offset between the
    # catalogue and Layer-2 — "catalog G8-L4 means parsed G8-L5", growing by one at
    # each a/b split. The offset existed because there were two layers with two
    # numbering schemes. There is one source now, so a code means itself.
    #
    # Leaving the first-edition pairs in place was not neutral: the second edition
    # renumbered every lesson, so the table quietly redirected live lookups to a
    # DIFFERENT lesson. `keypoints_manifest_verify` was reading G8-L7
    # (集中營裡的一門課) while checking G8-L9 (「按讚」背後的真相) and reporting the
    # mismatch as a stale manifest.
    #
    # Do not repopulate. If two numbering schemes ever coexist again, the answer is
    # a version_id on the uid, not a lookup table keyed by position.
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

    原本寫著「Mirrors ``load_layer2_lessons`` resolution (#1669)」——
    ⛔ 那支函式在一修（#2683）封存 Layer-2 來源之後就被移掉了，
    這行從此指著一個不存在的東西（2026-08-31 清理時發現）。
    現在的行為就寫在下面幾行：先正規化課號，再依序查
    MULTI_LESSON_PRIMARY → CATALOG_TO_PARSED_OVERRIDE。
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
