"""
Lesson layer loaders: I/O for Layer-1 (L*.yml) and Layer-2 (_parsed_2026-05-01/*.yml).

Extracted from lesson_loader.py (Issue #1889).

Public API:
    GENRE_TO_CATEGORY    — static genre→display category map
    ENRICHMENT_FIELDS    — tuple of field names merged from Layer-2 into Layer-1
    build_intro()        — construct intro dict from raw lesson data
    normalize_fill_in_blank_item()  — tag and normalize fill_in_blank items
    load_curriculum_manifest()      — load manifest.yml → code→meta index
    load_layer1_lessons()           — load production L*.yml lessons

⛔ 這裡曾經列著 `load_layer2_lessons()` 與 `build_layer2_enrichment_index()`，
   但一修（#2683）封存 Layer-2 來源目錄之後那兩支就被移掉了 —— docstring 卻留著，
   宣傳了兩支不存在的 API。2026-08-31 清 worktree 時發現（有一支測試 import 它們，
   在新 base 上直接 AttributeError）。
   同族還有 `lesson_code_normalization.py:151` 的註解也還指著 `load_layer2_lessons`。
"""

import logging
import re
from pathlib import Path

import yaml

from app.services.content_mapping_registry import get_story_structure_override
from app.services.lesson_code_normalization import (
    halfwidth,
    normalize_manifest_code,
    catalog_to_parsed_code,
    MULTI_LESSON_PRIMARY,
    MULTI_LESSON_MAP,
    CATALOG_TO_PARSED_OVERRIDE,
    AB_SECONDARY_MAP,
)
from app.services.spotlight_figure_images import merge_spotlight_images
from app.services.spotlight_v2_loader import load_spotlight_v2

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Paths (must match lesson_loader.py)
# ---------------------------------------------------------------------------

_LESSONS_DIR = Path(__file__).parent.parent.parent / "data" / "lessons"
_PARSED_DIR = _LESSONS_DIR / "_parsed_2026-05-01"
_CURRICULUM_MANIFEST = Path(__file__).parent.parent.parent / "data" / "curriculum" / "manifest.yml"
# Checked-in manifest listing grade_codes that have a .docx in GCS worksheets/ (#2207)
_DOCX_MANIFEST = Path(__file__).parent.parent.parent / "data" / "worksheet_docx_codes.txt"
_KEY_READING_PASSAGES = Path(__file__).parent.parent.parent / "data" / "key_reading_passages.yml"

# ---------------------------------------------------------------------------
# 重點朗讀指定段落對照表 (Issue #2562) — lesson_code -> key_reading passage
# 由紙本學習單 PDF 抽取（skill lingoleap-worksheet-pdf）。以 lesson_code (grade_code,
# 例 "G4-L01") 為 key，後端在 story 詳情合併進 key_reading，map 優先於課文檔內既有值
# （新規則：只取老師 ☞ 指定的那一段，取代舊的「☞→全文結尾」pilot 值）。
# 讀一次快取；缺檔或解析失敗回空 dict（前端 fallback 唸全文，不 fail）。
# ---------------------------------------------------------------------------
_KEY_READING_CACHE: dict | None = None


def get_key_reading_passages() -> dict:
    """回傳 {lesson_code: {"passage": str, "source": str}}，載入一次後快取。"""
    global _KEY_READING_CACHE
    if _KEY_READING_CACHE is not None:
        return _KEY_READING_CACHE
    result: dict = {}
    try:
        with open(_KEY_READING_PASSAGES, encoding="utf-8") as f:
            data = yaml.safe_load(f) or {}
        for code, entry in (data.get("passages") or {}).items():
            passage = (entry or {}).get("passage")
            if not passage:
                continue
            result[code] = {"passage": passage, "source": "worksheet-pdf-extract"}
    except FileNotFoundError:
        logger.warning("key_reading_passages.yml 不存在：%s（重點朗讀將 fallback 唸全文）", _KEY_READING_PASSAGES)
    except Exception as exc:  # 解析錯誤不可讓課程 API 掛掉
        logger.warning("解析 key_reading_passages.yml 失敗：%s（重點朗讀將 fallback 唸全文）", exc)
        result = {}
    _KEY_READING_CACHE = result
    return result


# Offset added to curriculum display_order to generate synthetic integer IDs
# for Layer-2 lessons (avoids collision with Layer-1 ids 1–57).
LAYER2_ID_OFFSET = 1000


# ---------------------------------------------------------------------------
# Module-level docx code set — loaded once at import, never re-read per lesson
# ---------------------------------------------------------------------------

def _load_docx_codes() -> frozenset[str]:
    """Load grade_codes that have a GCS worksheet docx from the checked-in manifest."""
    if not _DOCX_MANIFEST.exists():
        return frozenset()
    with open(_DOCX_MANIFEST, "r", encoding="utf-8") as f:
        return frozenset(line.strip() for line in f if line.strip())


_DOCX_CODES: frozenset[str] = _load_docx_codes()

# Issue #2486: lingoleap-assets went private (was public-read, letting anyone
# enumerate + bulk-download the whole course library). All URLs we derive now
# point at our own same-origin proxy (backend `/assets/*` route, fronted by
# the Firebase Hosting `/assets/**` rewrite) instead of the GCS host directly.
_ASSET_PROXY_BASE = "/assets"
_GCS_ABSOLUTE_PREFIX = "https://storage.googleapis.com/lingoleap-assets/"
_GCS_DOCX_BASE = f"{_ASSET_PROXY_BASE}/worksheets"


def _to_asset_proxy_url(url: str | None) -> str | None:
    """Rewrite a legacy absolute GCS URL to our same-origin ``/assets/`` proxy path.

    320+ YAML source files under ``backend/data/curriculum/lessons/`` still carry
    literal ``https://storage.googleapis.com/lingoleap-assets/...`` strings for
    ``worksheet_pdf_url`` (hand-editing every file was out of scope for #2486) —
    this is the single point where those get rewritten before reaching an API
    response. Idempotent: a value that's already relative (or unrelated to this
    bucket) passes through unchanged. ``None``/empty pass through unchanged.
    """
    if not url:
        return url
    if url.startswith(_GCS_ABSOLUTE_PREFIX):
        return _ASSET_PROXY_BASE + "/" + url[len(_GCS_ABSOLUTE_PREFIX):]
    return url


def _derive_docx_url(grade_code: str | None) -> str | None:
    """Return the proxied docx URL if grade_code is in the checked-in manifest, else None.

    YAML-explicit worksheet_docx_url always takes priority over this derived value
    (callers use ``_to_asset_proxy_url(data.get("worksheet_docx_url")) or _derive_docx_url(grade_code)``).

    🔴 #2845（2026-08-31 實測）：**上面那句話目前不成立 —— 沒有人呼叫這支。**
    `routes/stories.py` 只讀 yml 的 `worksheet_docx_url`，所以 `/api/stories` 的
    175 課 `worksheet_docx_url` 全是 None，即使 manifest 有 139 個 code 對得上。

    ⛔ 現在**刻意不接**：`/assets/worksheets/*.docx` 在 staging 一律 404
    （正向對照：同一個 proxy 拿 `/assets/lesson/L0011/thumbnail.webp` 回 200 / 17KB，
    所以 proxy 是好的，是**檔案沒上傳**）。接上去只會讓 139 課長出按下去就失敗的按鈕。

    檔案上傳之後要一起做兩件事：接上這支 + 更新
    `backend/tests/test_worksheet_url_is_not_silently_dead_2845.py`。
    """
    if not grade_code or grade_code not in _DOCX_CODES:
        return None
    return f"{_GCS_DOCX_BASE}/{grade_code}.docx"


# ---------------------------------------------------------------------------
# Static maps
# ---------------------------------------------------------------------------

GENRE_TO_CATEGORY: dict[str, str] = {
    "記敘文": "Fable",
    "說明文": "Science",
    "説明文": "Science",
    "議論文": "History",
    "文言文": "History",
    "應用文": "Daily",
}

# Fields copied from Layer-2 parsed data onto matching Layer-1 entries (#1666).


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def normalize_fill_in_blank_item(item: dict) -> dict:
    """Normalize a fill_in_blank item, tagging new-format items for frontend detection.

    Two schemas coexist in the data:
      Legacy (Layer-1 / old parsed):
        { sentence: "孟嘗君（　　）逃離秦國。", answer: "A" }
        answer is a letter code that matches a vocab_bank key.

      New-format (5/1 curriculum batch, Layer-2):
        { id, answer: "模仿雞叫", context_before: "...", context_after: "...",
          context_paragraph_idx: N }
        answer is freetext (strategy worksheet cloze), NOT a vocab_bank letter code.

    FillInBlankExercise.tsx expects legacy format: item.sentence (string) and
    item.answer (letter code matching vocab_bank). New-format items cannot be used
    with the current exercise component because answers are freetext, not letter codes.

    This function:
    1. Synthesizes a sentence string for new-format items (context_before + blank + context_after)
       so the sentence text is available for future exercise types.
    2. Adds _schema flag to distinguish schema types without fragile duck-typing in callers.

    Frontend api.ts filters by _schema: items with _schema="context_fill" are dropped
    from fillInBlank → hasData=false → NoDataFallback renders (correct for 6/1 demo).
    When a proper cloze exercise component is built, this flag enables clean routing.

    Related: #1559, #1563
    """
    if "context_before" in item and "sentence" not in item:
        before = item.get("context_before") or ""
        after = item.get("context_after") or ""
        return {**item, "sentence": f"{before}（　　）{after}", "_schema": "context_fill"}
    # Legacy format: no change needed, but tag it too for symmetry.
    return {**item, "_schema": "legacy"}


def build_intro(lesson: dict) -> dict:
    """Replicate frontend lessonLoader.ts intro construction."""
    genre = lesson.get("genre", "")
    strategy = lesson.get("reading_strategy")

    author = genre
    if strategy and strategy != "無":
        author = f"{genre} · {strategy}"

    paragraphs = lesson.get("paragraphs", [])
    background = ""
    if paragraphs:
        p = paragraphs[0]
        background = p[:100] + "..." if len(p) > 100 else p

    return {"author": author, "background": background}


# ---------------------------------------------------------------------------
# Curriculum manifest loader
# ---------------------------------------------------------------------------



def _spotlight_enrichment(data: dict, grade_code: str) -> dict:
    """spotlight_v2 + images[] merged from figure block assets."""
    spotlight_v2 = load_spotlight_v2(grade_code, data.get("title"))
    images = merge_spotlight_images(data.get("images") or [], spotlight_v2)
    return {"spotlight_v2": spotlight_v2, "images": images}


# ---------------------------------------------------------------------------
# Layer-1 loader
# ---------------------------------------------------------------------------



# ---------------------------------------------------------------------------
# Layer-2 loader
# ---------------------------------------------------------------------------



# ---------------------------------------------------------------------------
# Layer-2 enrichment index builder
# ---------------------------------------------------------------------------

