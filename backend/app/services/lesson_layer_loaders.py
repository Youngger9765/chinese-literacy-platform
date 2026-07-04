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
    load_layer2_lessons()           — load _parsed_2026-05-01/*.yml lessons
    build_layer2_enrichment_index() — build title→Layer-2 data dict for enrichment
"""

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


# ---------------------------------------------------------------------------
# Paths (must match lesson_loader.py)
# ---------------------------------------------------------------------------

_LESSONS_DIR = Path(__file__).parent.parent.parent / "data" / "lessons"
_PARSED_DIR = _LESSONS_DIR / "_parsed_2026-05-01"
_CURRICULUM_MANIFEST = Path(__file__).parent.parent.parent / "data" / "curriculum" / "manifest.yml"
# Checked-in manifest listing grade_codes that have a .docx in GCS worksheets/ (#2207)
_DOCX_MANIFEST = Path(__file__).parent.parent.parent / "data" / "worksheet_docx_codes.txt"

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
ENRICHMENT_FIELDS = (
    "step_sequence",
    "worksheet_section_order",
    "worksheet_intro",
    "lesson_intro",
    "worksheet_pdf_url",
    # Direct docx URL when soffice PDF conversion is broken (#2073)
    "worksheet_docx_url",
    "layout_mode",
    "reading_strategy_type",
    "images",
    "strategy_exercise",
    "story_structure_table",
    "story_structure_rows",
    # 紙本表格 (#1685): some Layer-2 lessons (G7-L28, G7-L30) carry extracted
    # tables; copy onto matching Layer-1 entries to preserve back-compat.
    "tables",
    # Block-sequence spotlight v2 (#2205) — Layer-2 fixture onto Layer-1 back-compat slots
    "spotlight_v2",
)


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

def load_curriculum_manifest() -> dict[str, dict]:
    """Load curriculum/manifest.yml and return a dict keyed by normalized lesson_code.

    Returns {} if the manifest file does not exist.
    """
    if not _CURRICULUM_MANIFEST.exists():
        return {}

    with open(_CURRICULUM_MANIFEST, "r", encoding="utf-8") as f:
        manifest = yaml.safe_load(f)

    index: dict[str, dict] = {}
    for entry in manifest.get("lessons", []):
        norm_code = normalize_manifest_code(entry["lesson_code"])
        index[norm_code] = entry
    return index


def _spotlight_enrichment(data: dict, grade_code: str) -> dict:
    """spotlight_v2 + images[] merged from figure block assets."""
    spotlight_v2 = load_spotlight_v2(grade_code, data.get("title"))
    images = merge_spotlight_images(data.get("images") or [], spotlight_v2)
    return {"spotlight_v2": spotlight_v2, "images": images}


# ---------------------------------------------------------------------------
# Layer-1 loader
# ---------------------------------------------------------------------------

def load_layer1_lessons() -> list[dict]:
    """Load existing production lessons: backend/data/lessons/L*.yml

    These have integer lesson_number fields and form the original 57-lesson set.
    """
    lessons: list[dict] = []

    if not _LESSONS_DIR.exists():
        return lessons

    for yml_path in sorted(_LESSONS_DIR.glob("L*.yml")):
        with open(yml_path, "r", encoding="utf-8") as f:
            data = yaml.safe_load(f)

        if not data or "lesson_number" not in data:
            continue

        genre = data.get("genre", "")
        strategy = data.get("reading_strategy")
        if strategy == "無":
            strategy = None

        story_structure_table = data.get("story_structure_table")
        story_structure_rows = data.get("story_structure_rows")

        lesson = {
            "id": data["lesson_number"],
            "lesson_number": data["lesson_number"],
            "lesson_code": data.get("grade_code", ""),  # e.g. "G4-1"
            "title": data["title"],
            "grade": data["grade"],
            "grade_code": data.get("grade_code", ""),
            "genre": genre,
            "text_type": data.get("text_type", "單"),
            "category": GENRE_TO_CATEGORY.get(genre, "Daily"),
            "reading_strategy": strategy,
            "paragraphs": data.get("paragraphs", []),
            "full_text": data.get("story_text"),
            "char_count": data.get("char_count", 0),
            "thumbnail_url": (
                f"{_ASSET_PROXY_BASE}/stories/"
                f"thumbnails/lesson-{data['lesson_number']}.webp"
            ),
            "vocabulary": data.get("vocabulary") or [],
            "fill_in_blank": [
                {**normalize_fill_in_blank_item(item), "answer": halfwidth(item.get("answer", ""))}
                for item in (data.get("fill_in_blank") or [])
            ] or None,
            "multiple_choice": data.get("multiple_choice"),
            "vocab_bank": data.get("vocab_bank"),
            "knowledge_video_url": data.get("knowledge_video_url"),
            # Full video list (#1683) — for Layer-1 lessons, derive single-item
            # list from knowledge_video_url if no explicit video_links field.
            "video_links": data.get("video_links") or (
                [{"title": "影片", "url": data["knowledge_video_url"]}]
                if data.get("knowledge_video_url") else None
            ),
            "reading_benchmark": data.get("reading_benchmark"),
            "source_file": data.get("source_file"),
            "strategy_exercise": data.get("strategy_exercise"),
            # Schema-driven step composition (#1374): pass through if present in YAML.
            # None (absent) means frontend uses DEFAULT_STEP_SEQUENCE.
            "step_sequence": data.get("step_sequence") or None,
            "story_structure_table": story_structure_table,
            "story_structure_rows": story_structure_rows,
            # Plugin-pattern dispatch fields (#1404):
            "reading_strategy_type": data.get("reading_strategy_type") or "general",
            "layout_mode": data.get("layout_mode") or "standard",
            **_spotlight_enrichment(data, data.get("grade_code", "")),
            "intro": build_intro(data),
            # 學習單 section order + intro metadata (#1434) — None for Layer-1
            "worksheet_section_order": data.get("worksheet_section_order"),
            "worksheet_intro": data.get("worksheet_intro"),
            # Lesson intro (#1443): docx 說明/導讀 or excel fallback
            "lesson_intro": data.get("lesson_intro"),
            # Public PDF URL of the original 紙本學習單 (#1444). YAML source
            # still has the absolute GCS URL (#2486) — rewritten to our
            # same-origin proxy here, the single point of truth.
            "worksheet_pdf_url": _to_asset_proxy_url(data.get("worksheet_pdf_url")),
            # Direct docx URL — YAML field takes priority; derive from GCS manifest
            # for all other lessons that have a .docx in worksheets/ (#2073, #2207)
            "worksheet_docx_url": (
                _to_asset_proxy_url(data.get("worksheet_docx_url"))
                or _derive_docx_url(data.get("grade_code", ""))
            ),
            # 紙本表格 HTML render (#1685) — None when lesson has no extracted tables
            "tables": data.get("tables"),
            "_layer": 1,
        }
        lessons.append(lesson)

    return lessons


# ---------------------------------------------------------------------------
# Layer-2 loader
# ---------------------------------------------------------------------------

def load_layer2_lessons(
    manifest_index: dict[str, dict],
    layer1_titles: set[str],
) -> list[dict]:
    """Load new parsed lessons from _parsed_2026-05-01/*.yml.

    Assigns synthetic integer IDs using curriculum display_order + LAYER2_ID_OFFSET.
    Skips lessons whose title already appears in Layer-1 (dedup).
    Skips secondary multi-lesson and a/b slots (only the primary is exposed).
    """
    if not _PARSED_DIR.exists():
        return []

    # Build index: parsed lesson_code -> (data, path)
    parsed_index: dict[str, tuple[dict, Path]] = {}
    for yml_path in _PARSED_DIR.glob("*.yml"):
        with open(yml_path, "r", encoding="utf-8") as f:
            data = yaml.safe_load(f)
        if data and data.get("lesson_code"):
            parsed_index[data["lesson_code"]] = (data, yml_path)

    lessons: list[dict] = []

    for norm_code, meta in manifest_index.items():
        # Skip secondary multi-lesson slots (covered by the primary)
        if norm_code in MULTI_LESSON_MAP:
            continue
        # Skip secondary a/b slots (covered by the primary a-slot)
        if norm_code in AB_SECONDARY_MAP:
            continue

        # Resolve which parsed YAML handles this curriculum slot
        parsed_code = catalog_to_parsed_code(norm_code)

        if parsed_code not in parsed_index:
            # For a/b primary slots (e.g. G8-L3a), the parsed file is G8-L3 (no suffix)
            # Try stripping trailing 'a' suffix → base code (e.g. G8-L3a → G8-L3)
            base_code = re.sub(r"a$", "", parsed_code)
            if base_code != parsed_code and base_code in parsed_index:
                parsed_code = base_code
            else:
                # No parsed YAML available
                continue

        data, _ = parsed_index[parsed_code]

        # Title: prefer catalog manifest title when a catalog→parsed override
        # is in effect (#1669). This prevents catalog G7-L31 from displaying
        # parsed G7-L23.yml's title (which would collide with G7-L23's own
        # entry and confuse the lesson card UI).
        if norm_code in CATALOG_TO_PARSED_OVERRIDE:
            title = meta.get("title") or data.get("title", "")
        else:
            title = data.get("title", "")
        # Deduplicate: if title already in Layer-1, skip
        if title in layer1_titles:
            continue

        display_order = meta.get("display_order", 0)
        lesson_id = LAYER2_ID_OFFSET + display_order

        genre = data.get("genre", "")
        strategy = data.get("reading_strategy") or meta.get("strategy_name")
        if strategy in ("", "無", "general"):
            strategy = None

        # Grade: use manifest grade (authoritative). Parsed grade=0 for 文言文 → map to 8
        grade = meta.get("grade") or data.get("grade") or 0
        if grade == 0:
            grade = 8  # 文言文 is pitched at G8 per curriculum

        # Vocabulary: parsed YAML may have empty list for 文言文/graphic-text → keep as empty list
        vocabulary = data.get("vocabulary") or []

        # Video links: prefer manifest (has cleaned URLs), fall back to parsed
        video_links = meta.get("video_links") or data.get("video_links")

        # Content mapping is a title-anchor guard for known catalog slots.
        # It should never force table→rows degradation in runtime payload.
        structure_override = get_story_structure_override(norm_code, title)
        is_multi_text_primary_slot = norm_code in MULTI_LESSON_PRIMARY
        allow_multi_text_table = bool(structure_override)
        if is_multi_text_primary_slot and not allow_multi_text_table:
            # Fail-closed for unverified multi-text primary slots.
            story_structure_table = None
            story_structure_rows = None
        else:
            story_structure_table = data.get("story_structure_table")
            story_structure_rows = data.get("story_structure_rows")

        lesson = {
            "id": lesson_id,
            "lesson_number": lesson_id,  # kept for backward compat with schemas
            "lesson_code": norm_code,
            "title": title,
            "grade": grade,
            "grade_code": norm_code,
            "genre": genre,
            "text_type": data.get("text_type") or meta.get("text_type") or "單",
            "category": GENRE_TO_CATEGORY.get(genre, "Daily"),
            "reading_strategy": strategy,
            "paragraphs": data.get("paragraphs", []),
            "full_text": data.get("story_text"),
            "char_count": data.get("char_count", 0),
            "thumbnail_url": (
                f"{_ASSET_PROXY_BASE}/stories/"
                f"thumbnails/{norm_code}.webp"
            ),
            "vocabulary": vocabulary,
            "fill_in_blank": [
                {**normalize_fill_in_blank_item(item), "answer": halfwidth(item.get("answer", ""))}
                for item in (data.get("fill_in_blank") or [])
            ] or None,
            "multiple_choice": data.get("multiple_choice"),
            "vocab_bank": data.get("vocab_bank"),
            "knowledge_video_url": (
                video_links[0].get("url") if video_links else None
            ),
            # Full video list (#1683) — KnowledgeStation renders all videos.
            "video_links": video_links,
            "reading_benchmark": data.get("reading_benchmark"),
            "source_file": data.get("source_file"),
            # Accept both keys: 'strategy_exercise' (singular, guided_steps shape — Gemini
            # structured output from #1418) OR 'strategy_exercises' (plural, legacy skeleton
            # list shape for G7 圖文整合). Singular takes priority.
            "strategy_exercise": (
                data.get("strategy_exercise") or data.get("strategy_exercises")
            ),
            "story_structure_table": story_structure_table,
            "story_structure_rows": story_structure_rows,
            "display_order": display_order,
            # Schema-driven step composition (#1374): pass through if present in YAML.
            # None (absent) means frontend uses DEFAULT_STEP_SEQUENCE.
            "step_sequence": data.get("step_sequence") or None,
            # Plugin-pattern dispatch fields (#1404):
            "reading_strategy_type": data.get("reading_strategy_type") or "general",
            "layout_mode": data.get("layout_mode") or "standard",
            **_spotlight_enrichment(data, norm_code),
            "intro": build_intro({**data, "reading_strategy": strategy}),
            # 學習單 section order + intro metadata (#1434)
            "worksheet_section_order": data.get("worksheet_section_order"),
            "worksheet_intro": data.get("worksheet_intro"),
            # Lesson intro (#1443): docx 說明/導讀 or excel fallback
            "lesson_intro": data.get("lesson_intro"),
            # Public PDF URL of the original 紙本學習單 (#1444). YAML source
            # still has the absolute GCS URL (#2486) — rewritten to our
            # same-origin proxy here, the single point of truth.
            "worksheet_pdf_url": _to_asset_proxy_url(data.get("worksheet_pdf_url")),
            # Direct docx URL — YAML field takes priority; derive from GCS manifest
            # for all other lessons that have a .docx in worksheets/ (#2073, #2207)
            "worksheet_docx_url": (
                _to_asset_proxy_url(data.get("worksheet_docx_url"))
                or _derive_docx_url(norm_code)
            ),
            # 紙本表格 HTML render (#1685) — None when lesson has no extracted tables
            "tables": data.get("tables"),
            "_layer": 2,
        }
        lessons.append(lesson)

    return lessons


# ---------------------------------------------------------------------------
# Layer-2 enrichment index builder
# ---------------------------------------------------------------------------

def build_layer2_enrichment_index() -> dict[str, dict]:
    """Build title→Layer-2 raw data index for enriching Layer-1 lessons.

    Reads all _parsed_2026-05-01/*.yml files regardless of whether they were
    kept after dedup — this ensures Layer-1 lessons get enrichment fields even
    when their Layer-2 counterpart was skipped during load_layer2_lessons().
    """
    layer2_by_title: dict[str, dict] = {}
    if not _PARSED_DIR.exists():
        return layer2_by_title

    for yml_path in _PARSED_DIR.glob("*.yml"):
        with open(yml_path, "r", encoding="utf-8") as f:
            data = yaml.safe_load(f)
        if not data:
            continue
        title = data.get("title", "")
        if title:
            # Issue #2486 (part 3): ENRICHMENT_FIELDS (below) copies this dict's
            # worksheet_pdf_url / worksheet_docx_url verbatim onto matching
            # Layer-1 lessons (lesson_indexes.py). load_layer2_lessons() above
            # already rewrites those fields via _to_asset_proxy_url before they
            # reach an API response — but this index is a *separate* raw read
            # of the same YAML files, so without the same rewrite here, a
            # Layer-1 lesson enriched from this index would silently regain the
            # literal storage.googleapis.com URL. Confirmed via real-browser QA:
            # GET /api/stories/3 returned a same-origin /assets/... thumbnail_url
            # (thumbnail_url isn't in ENRICHMENT_FIELDS, so Layer-1's own already
            # -correct value was untouched) alongside an absolute-GCS
            # worksheet_pdf_url — CSP frame-src widening alone can't fix a URL
            # that was never routed through the proxy in the first place.
            # _to_asset_proxy_url is idempotent (already-relative or falsy
            # values pass through unchanged), so this only rewrites the literal
            # legacy-absolute case — no other enrichment behavior changes.
            data["worksheet_pdf_url"] = _to_asset_proxy_url(data.get("worksheet_pdf_url"))
            data["worksheet_docx_url"] = _to_asset_proxy_url(data.get("worksheet_docx_url"))
            layer2_by_title[title] = data

    return layer2_by_title
