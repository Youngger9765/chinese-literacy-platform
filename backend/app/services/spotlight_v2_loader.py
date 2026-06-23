"""
spotlight_v2_loader.py — load checked-in block-sequence spotlight schemas.

Priority: dev7 (curated) → test15 (curated) → catalog (bulk-promoted).
"""

import re

from app.services.content_mapping_registry import get_spotlight_source_code
from app.services.lesson_code_normalization import (
    MULTI_LESSON_MAP,
    normalize_manifest_code,
)
from app.services.spotlight_contract import (
    CATALOG_LESSONS,
    DEV7_LESSONS,
    TEST15_CATALOG_CODES,
    load_catalog_spotlight,
    load_dev7_spotlight,
    load_test15_spotlight,
    test15_fixture_for_catalog,
)


_ZERO_PADDED_GRADE_CODE_RE = re.compile(r"^G\d+-L0\d+[ab]?$")

# Padded aliases confirmed to cross-bind to a neighboring catalog spotlight.
_PADDED_ALIAS_DENYLIST = frozenset({
    "G4-L02",
    "G4-L03",
})

# Secondary slot backed by a shared multi-text source docx.
# Fail-closed: do not route to a blended spotlight file for this slot.
_SECONDARY_MULTI_TEXT_SPOTLIGHT_DENYLIST = frozenset({
})

# Temporarily fail-closed for slots with unresolved source identity drift.
# Do not bind to a spotlight file unless a verified per-lesson source exists.
_UNVERIFIED_SPOTLIGHT_SLOT_DENYLIST = frozenset({
    "G4-L17",
    "G5-L15",
    "G7-L7",
    # Vision-judge confirmed the strategy scaffold embeds ANOTHER lesson's
    # example/practice text (verified full render content, not snippet):
    "G5-L11",   # example uses 田鼠阿飛 (≠ 陳念琴)
    "G6-L12",   # 找主題句 example uses 烏龍茶 (≠ 愛冒險逞強的雄性動物)
    "G7-L31",   # 跳過卡關 practice text is 雨林裡的奇蹟藥物 (≠ 旅人鴿)
    "G9-L8",    # 折線圖 example is 性別比/新生兒 population data (≠ 閱讀力)
})


# Render-confirmed cross_lesson via the LEGACY strategy_exercise fallback (#2397).
# These slots have no verified spotlight source (already in known_gaps + the
# unverified denylist above → spotlight_v2 None), but their legacy
# strategy_exercise embeds a FOREIGN worked example that is NEVER applied to the
# lesson's own passage (verified: the example text is absent from the lesson
# paragraphs). The frontend StrategyExercisePage falls back to strategy_exercise
# when spotlight_v2 is empty → student sees another topic's example. Nulling the
# legacy field makes the honest "no spotlight yet" placeholder render instead.
# gap >> 放錯課.
#
# Scope is deliberately NARROW: lessons whose legacy strategy_exercise is itself
# faithful (e.g. G7-L31 旅人鴿 — its strategy quotes the lesson's own passage)
# must keep rendering it, so they are NOT listed here even though their
# spotlight_v2 is fail-closed above.
_LEGACY_STRATEGY_EXERCISE_DENYLIST = frozenset({
    "G5-L15",  # 上位概念 example = 大安森林公園裝置藝術 (≠ 信件的力量; absent from passage)
    "G6-L12",  # 找主題句 example = 烏龍茶製程 (≠ 愛冒險逞強的雄性動物; absent from passage)
    "G7-L7",   # 折線圖判讀 example = 臺北市平均氣溫 (≠ 人口負成長; absent from passage)
    "G9-L8",   # 圖表判讀 example = 新生兒性別比 (≠ 臺灣學生閱讀力; absent from passage)
})


def should_suppress_legacy_strategy_exercise(lesson_code: str) -> bool:
    """True when the lesson's legacy strategy_exercise must be nulled (#2397).

    Verified by content evidence: the strategy's worked example does not appear
    in the lesson's own passage, so rendering the legacy fallback shows another
    topic's content. See _LEGACY_STRATEGY_EXERCISE_DENYLIST.
    """
    raw = (lesson_code or "").strip()
    norm = normalize_manifest_code(raw)
    return (
        raw in _LEGACY_STRATEGY_EXERCISE_DENYLIST
        or norm in _LEGACY_STRATEGY_EXERCISE_DENYLIST
    )


def _is_zero_padded_grade_code(code: str) -> bool:
    return bool(_ZERO_PADDED_GRADE_CODE_RE.match(code or ""))


def is_spotlight_v2_lesson(lesson_code: str) -> bool:
    raw = (lesson_code or "").strip()
    norm = normalize_manifest_code(raw)
    if raw in _PADDED_ALIAS_DENYLIST:
        return False
    if norm in _SECONDARY_MULTI_TEXT_SPOTLIGHT_DENYLIST:
        return False
    if norm in _UNVERIFIED_SPOTLIGHT_SLOT_DENYLIST:
        return False
    if norm in MULTI_LESSON_MAP:
        return False
    if raw in DEV7_LESSONS or raw in TEST15_CATALOG_CODES or raw in CATALOG_LESSONS:
        return True
    return (
        norm in DEV7_LESSONS
        or norm in TEST15_CATALOG_CODES
        or norm in CATALOG_LESSONS
    )


def load_spotlight_v2(lesson_code: str, lesson_title: str | None = None) -> dict | None:
    raw = (lesson_code or "").strip()
    norm = normalize_manifest_code(raw)
    rebound = get_spotlight_source_code(norm, lesson_title)
    source_raw = rebound or raw
    source_norm = normalize_manifest_code(source_raw)

    if raw in _PADDED_ALIAS_DENYLIST:
        return None
    if norm in _SECONDARY_MULTI_TEXT_SPOTLIGHT_DENYLIST:
        return None
    if norm in _UNVERIFIED_SPOTLIGHT_SLOT_DENYLIST:
        return None
    if norm in MULTI_LESSON_MAP:
        return None

    # First, try exact-code lookup to avoid accidental cross-binding.
    if source_raw in DEV7_LESSONS:
        return load_dev7_spotlight(source_raw)
    fixture_id = test15_fixture_for_catalog(source_raw)
    if fixture_id:
        return load_test15_spotlight(fixture_id)
    if source_raw in CATALOG_LESSONS:
        return load_catalog_spotlight(source_raw)

    # Only then allow normalized fallback.
    if source_norm in DEV7_LESSONS:
        return load_dev7_spotlight(source_norm)
    fixture_id = test15_fixture_for_catalog(source_norm)
    if fixture_id:
        return load_test15_spotlight(fixture_id)
    if source_norm in CATALOG_LESSONS:
        return load_catalog_spotlight(source_norm)
    return None
