"""
Stories API — serves platform lessons from in-memory YAML data.
No database dependency for platform content.
"""

import copy
import re
import time
from fastapi import APIRouter, Query, HTTPException, Depends, Request
from pydantic import BaseModel
from sqlalchemy.orm import Session

from ..database import get_db
from ..models.user import User
from ..auth.dependencies import get_current_user
from ..auth.rate_limiter import ai_rate_limiter, get_client_key
from ..services.lesson_loader import search_lessons, get_lesson_by_id, get_available_grades
from ..utils.slug import normalize_story_slug
from ..services.ai_service import generate_story_structure, grade_story_structure
from ..services.ai_usage_tracker import last_usage, log_ai_usage
from ..services.story_structure_cell_parser import cell_to_structure_fields
from ..schemas.story import StoryListItem, StoryDetail, StoryListResponse, StoryIntroSchema

# ---------------------------------------------------------------------------
# Simple TTL cache for story structure results (avoids redundant Gemini calls)
# v2 cache key prefix — invalidates old non-interactive cache entries (#1082)
# ---------------------------------------------------------------------------

_structure_cache: dict[str, tuple[float, object]] = {}
_CACHE_TTL = 86400  # 24 hours
_CACHE_VERSION = "v4"  # label_blanks + checkbox via cell_to_structure_fields

_BLANK_RE = re.compile(r"【([^】]*)】")


def _cell_to_row_dict(label: str, value: str) -> dict:
    """Build a StructureRow dict from a label + value string."""
    return cell_to_structure_fields(label, value)


def _cache_key(story_id: str) -> str:
    return f"{_CACHE_VERSION}:{story_id}"


def _get_cached_structure(story_id: str):
    entry = _structure_cache.get(_cache_key(story_id))
    if entry and time.time() - entry[0] < _CACHE_TTL:
        return entry[1]
    return None


def _set_cached_structure(story_id: str, result):
    _structure_cache[_cache_key(story_id)] = (time.time(), result)


# ---------------------------------------------------------------------------
# YAML-first: convert story_structure_table → API response (no AI call)
# ---------------------------------------------------------------------------

def _strip_blank_answers(text: str) -> str:
    """Replace 【answer】 with empty blanks for student-facing display."""
    return _BLANK_RE.sub("【　　　】", text)


def _sanitize_row_for_client(row: dict) -> dict:
    """Remove grading answers from a structure row before API response."""
    out = {k: v for k, v in row.items() if k not in ("hint", "blank_hints")}
    if out.get("interactive_type") == "fill_blank":
        if out.get("blank_in_label") and out.get("label"):
            out["label"] = _strip_blank_answers(out["label"])
        if out.get("value"):
            out["value"] = _strip_blank_answers(out["value"])
    sub_rows = out.get("sub_rows")
    if sub_rows:
        out["sub_rows"] = [_sanitize_row_for_client(sr) for sr in sub_rows]
    return out


def _infer_structure_template_kind(title: str | None, labels: list[str]) -> str:
    """Infer coach/demo template from table title + row labels."""
    blob = " ".join([title or "", *labels])
    if re.search(r"假說|驗證|步驟|探究", blob):
        return "scientific"
    if re.search(r"問題", blob) and re.search(r"解決|結果|影響|成效", blob):
        return "psr"
    if re.search(r"主題|事實|主角|事例|論點", blob):
        return "theme_facts"
    return "generic"


def _derive_interaction_profile(structure: dict) -> dict:
    """Summarize how students interact with this structure table.

    Attached to GET /structure so the frontend demo/coach can branch without
    re-deriving from rows. New table formats only need to populate rows with
    interactive_type — profile fields stay stable.
    """
    fill_blank_count = 0
    checkbox_count = 0
    primary_labels: list[str] = []
    section_labels: list[str] = []

    def tally_row(row: dict) -> None:
        nonlocal fill_blank_count, checkbox_count
        itype = row.get("interactive_type")
        label = str(row.get("label") or "").strip()
        if itype == "fill_blank":
            fill_blank_count += 1
            if label:
                primary_labels.append(label)
        elif itype == "checkbox":
            checkbox_count += 1
            if label:
                primary_labels.append(label)

    for row in structure.get("rows") or []:
        parent_label = str(row.get("label") or "").strip()
        if parent_label:
            section_labels.append(parent_label)
        sub_rows = row.get("sub_rows") or []
        if sub_rows:
            for sub in sub_rows:
                tally_row(sub)
        else:
            tally_row(row)

    if fill_blank_count and checkbox_count:
        mode = "mixed"
    elif fill_blank_count:
        mode = "fill_blank"
    elif checkbox_count:
        mode = "checkbox"
    else:
        mode = "display_only"

    return {
        "mode": mode,
        "template_kind": _infer_structure_template_kind(
            structure.get("title"),
            primary_labels + section_labels,
        ),
        "fill_blank_count": fill_blank_count,
        "checkbox_count": checkbox_count,
        "primary_labels": primary_labels[:4],
        "layout": structure.get("layout") or "cards",
    }


def _sanitize_structure_for_client(structure: dict) -> dict:
    """Return a deep copy of structure with answers stripped for student UI."""
    result = copy.deepcopy(structure)
    result["rows"] = [_sanitize_row_for_client(r) for r in result.get("rows", [])]
    for ws in result.get("worksheet_rows") or []:
        if ws.get("kind") == "pair":
            ws["label"] = _strip_blank_answers(ws.get("label") or "")
            ws["value"] = _strip_blank_answers(ws.get("value") or "")
        elif ws.get("kind") == "section_block":
            for item in ws.get("items") or []:
                item["label"] = _strip_blank_answers(item.get("label") or "")
                item["value"] = _strip_blank_answers(item.get("value") or "")
    result["interaction_profile"] = _derive_interaction_profile(result)
    return result


def _parse_yaml_table_row(raw_row: list) -> dict | None:
    """Parse one YAML story_structure_table row into a normalized item."""
    if not isinstance(raw_row, list) or not raw_row:
        return None

    n = len(raw_row)
    if n == 1:
        return {"kind": "title", "text": str(raw_row[0]).strip()}

    if n == 2:
        return {
            "kind": "pair",
            "label": str(raw_row[0]).strip(),
            "value": str(raw_row[1]).strip(),
        }

    if n == 3:
        return {
            "kind": "nested_triple",
            "section": str(raw_row[0]).strip(),
            "sub_label": str(raw_row[1]).strip(),
            "value": str(raw_row[2]).strip(),
        }

    label = str(raw_row[0]).strip()
    remainder = [str(c) for c in raw_row[1:]]
    if len(remainder) % 2 == 0:
        return {
            "kind": "paired_block",
            "label": label,
            "pairs": [
                {"sub_label": remainder[i], "value": remainder[i + 1]}
                for i in range(0, len(remainder), 2)
            ],
        }

    return {
        "kind": "pair",
        "label": label,
        "value": " ".join(remainder),
    }


def _merge_parsed_to_structure_rows(parsed: list[dict]) -> list[dict]:
    """Convert parsed items into grading-friendly rows (group nested triples)."""
    rows: list[dict] = []
    i = 0
    while i < len(parsed):
        item = parsed[i]
        kind = item["kind"]

        if kind == "title":
            rows.append({
                "label": item["text"],
                "value": "",
                "interactive_type": "display",
            })
            i += 1
            continue

        if kind == "pair":
            rows.append(_cell_to_row_dict(item["label"], item["value"]))
            i += 1
            continue

        if kind == "nested_triple":
            section = item["section"]
            sub_rows: list[dict] = []
            while (
                i < len(parsed)
                and parsed[i]["kind"] == "nested_triple"
                and parsed[i]["section"] == section
            ):
                cur = parsed[i]
                sub_rows.append(_cell_to_row_dict(cur["sub_label"], cur["value"]))
                i += 1
            rows.append({
                "label": section,
                "value": "",
                "interactive_type": "display",
                "sub_rows": sub_rows,
            })
            continue

        if kind == "paired_block":
            sub_rows = [
                _cell_to_row_dict(p["sub_label"], p["value"])
                for p in item["pairs"]
            ]
            rows.append({
                "label": item["label"],
                "value": "",
                "interactive_type": "display",
                "sub_rows": sub_rows,
            })
            i += 1
            continue

        i += 1

    return rows


def _build_worksheet_rows(parsed: list[dict]) -> tuple[str | None, list[dict]]:
    """Build 紙本學習單 HTML table rows (title / pair / section_block)."""
    title: str | None = None
    worksheet_rows: list[dict] = []
    i = 0

    while i < len(parsed):
        item = parsed[i]
        kind = item["kind"]

        if kind == "title":
            title = item["text"]
            i += 1
            continue

        if kind == "pair":
            worksheet_rows.append({
                "kind": "pair",
                "label": item["label"],
                "value": item["value"],
            })
            i += 1
            continue

        if kind == "nested_triple":
            section = item["section"]
            items: list[dict] = []
            while (
                i < len(parsed)
                and parsed[i]["kind"] == "nested_triple"
                and parsed[i]["section"] == section
            ):
                cur = parsed[i]
                items.append({
                    "label": cur["sub_label"],
                    "value": cur["value"],
                })
                i += 1
            worksheet_rows.append({
                "kind": "section_block",
                "section": section,
                "items": items,
            })
            continue

        if kind == "paired_block":
            worksheet_rows.append({
                "kind": "section_block",
                "section": item["label"],
                "items": [
                    {"label": p["sub_label"], "value": p["value"]}
                    for p in item["pairs"]
                ],
            })
            i += 1
            continue

        i += 1

    return title, worksheet_rows


def _format_yaml_structure_table(table: list) -> dict:
    """Convert story_structure_table YAML list → API shape.

    YAML row formats:
      [title]                   → 1-cell display row (title of the whole table)
      [label, value]            → simple row (fill_blank if has 【…】, else display)
      [label, sub_label, sub_value]  → nested PSR row (merged by shared section label)
      [label, sub1, val1, sub2, val2, ...] → paired sub_rows under one section

    Returns rows for grading plus worksheet_rows for 紙本 table rendering when
    the source table has a title row or nested PSR blocks.
    """
    parsed = [
        item for raw in table
        if (item := _parse_yaml_table_row(raw)) is not None
    ]
    rows = _merge_parsed_to_structure_rows(parsed)
    title, worksheet_rows = _build_worksheet_rows(parsed)

    result: dict = {"rows": rows}
    has_nested = any(p["kind"] in ("nested_triple", "paired_block") for p in parsed)
    if title or has_nested or any(p["kind"] == "pair" for p in parsed):
        result["layout"] = "worksheet_table"
        if title:
            result["title"] = title
        if worksheet_rows:
            result["worksheet_rows"] = worksheet_rows
    return result


# ---------------------------------------------------------------------------
# Request / Response schemas for grading
# ---------------------------------------------------------------------------

class StructureAnswerItem(BaseModel):
    row_index: int
    sub_row_index: int | None = None
    blank_index: int | None = None
    value: str | None = None          # for fill_blank
    selected_options: list[int] | None = None  # for checkbox


class GradeStructureRequest(BaseModel):
    answers: list[StructureAnswerItem]

router = APIRouter(tags=["stories"])


@router.get("/stories", response_model=StoryListResponse)
def list_stories(
    grade: int | None = Query(None, ge=1, le=12),
    genre: str | None = Query(None),
    category: str | None = Query(None),
    search: str | None = Query(None, max_length=100),
    page: int = Query(1, ge=1),
    page_size: int = Query(60, ge=1, le=300),
):
    """List published platform stories with optional filters.

    Returns all published platform stories with optional filters.

    Note: classroom-specific filtering is handled by
    GET /api/classrooms/{id}/texts and the frontend classroom library mode.
    """
    results = search_lessons(grade=grade, genre=genre, category=category, search=search)

    total = len(results)
    start = (page - 1) * page_size
    page_results = results[start : start + page_size]

    return StoryListResponse(
        stories=[
            StoryListItem(
                id=s["id"],
                lesson_number=s["lesson_number"],
                title=s["title"],
                grade=s["grade"],
                grade_code=s["grade_code"],
                genre=s["genre"],
                category=s["category"],
                char_count=s["char_count"],
                thumbnail_url=s["thumbnail_url"],
                reading_strategy=s["reading_strategy"],
                intro=StoryIntroSchema(**s["intro"]),
            )
            for s in page_results
        ],
        total=total,
        grades=get_available_grades(),
    )


@router.get("/stories/{story_id}", response_model=StoryDetail)
def get_story(story_id: str):
    """Get full story detail by ID (lesson_number).

    Accepts a numeric string (e.g. "3") or L-prefixed format (e.g. "L06").
    Non-numeric or unknown IDs return 404.
    This prevents 422 errors when legacy sessions store slug-format story_slugs.
    """
    # Normalize slug: "L06" / "06" / "6" → "6"
    try:
        numeric_id = int(normalize_story_slug(story_id))
    except (ValueError, TypeError):
        raise HTTPException(status_code=404, detail="Story not found")
    story = get_lesson_by_id(numeric_id)
    if not story:
        raise HTTPException(status_code=404, detail="Story not found")

    return StoryDetail(
        id=story["id"],
        lesson_number=story["lesson_number"],
        title=story["title"],
        grade=story["grade"],
        grade_code=story["grade_code"],
        genre=story["genre"],
        category=story["category"],
        char_count=story["char_count"],
        thumbnail_url=story["thumbnail_url"],
        reading_strategy=story["reading_strategy"],
        intro=StoryIntroSchema(**story["intro"]),
        paragraphs=story["paragraphs"],
        vocabulary=story["vocabulary"],
        fill_in_blank=story["fill_in_blank"],
        multiple_choice=story["multiple_choice"],
        vocab_bank=story.get("vocab_bank"),
        knowledge_video_url=story.get("knowledge_video_url"),
        # Full video list (#1683): catalog has multiple videos; frontend KnowledgeStation renders all.
        video_links=story.get("video_links"),
        reading_benchmark=story["reading_benchmark"],
        text_type=story["text_type"],
        source_file=story["source_file"],
        strategy_exercise=story.get("strategy_exercise"),
        spotlight_v2=story.get("spotlight_v2"),
        step_sequence=story.get("step_sequence"),
        # Plugin-pattern dispatch fields (#1404):
        reading_strategy_type=story.get("reading_strategy_type") or "general",
        layout_mode=story.get("layout_mode") or "standard",
        # Image gallery for graphic-text layout (#1341)
        images=story.get("images") or [],
        # Worksheet metadata (#1434) — surface to API
        worksheet_section_order=story.get("worksheet_section_order"),
        worksheet_intro=story.get("worksheet_intro"),
        # Lesson intro (#1443) — docx 說明/導讀 or excel fallback
        lesson_intro=story.get("lesson_intro"),
        # 紙本學習單 PDF (#1444) — public GCS URL or None
        worksheet_pdf_url=story.get("worksheet_pdf_url"),
        # Direct docx URL when soffice PDF conversion is broken (#2073)
        worksheet_docx_url=story.get("worksheet_docx_url"),
        # 紙本表格 (#1685) — extracted tables for 圖文表整合 lessons; None for others
        tables=story.get("tables"),
        # Story structure scaffold (#1683 item 4): YAML data for StoryStructure step.
        # story_structure_table: list-of-lists from docx parser (G7-L28/L29/L30).
        # story_structure_rows: AI-generated dict rows (richer shape). Both may be None.
        story_structure_table=story.get("story_structure_table"),
        story_structure_rows=story.get("story_structure_rows"),
    )


# ── ⑤ 文章重點表 AI endpoint (#615) ──────────────────────────────────────────

@router.get("/stories/{story_id}/structure")
async def get_story_structure(
    request: Request,
    story_id: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Generate AI story structure table (⑤ 文章重點表) for a lesson.

    Returns a list of rows with label/value (and optional sub_rows).
    Genre-aware: 記敘文 / 說明文 / 議論文 each get different templates.

    Requires authentication. Rate-limited to 5 req/min per user (cache miss only).
    Responses are cached in-memory for 24 h to avoid redundant Gemini calls.
    """
    try:
        numeric_id = int(normalize_story_slug(story_id))
    except (ValueError, TypeError):
        raise HTTPException(status_code=404, detail="Story not found")
    story = get_lesson_by_id(numeric_id)
    if not story:
        raise HTTPException(status_code=404, detail="Story not found")

    # ── YAML-first: use pre-stored structure data if available (#1377, #1398, #2205) ──
    # Priority 1: story_structure_table — DOCX/keypoints ground truth (preserves layout)
    yaml_table = story.get("story_structure_table")
    if yaml_table:
        result = _format_yaml_structure_table(yaml_table)
        # Store full structure (with answers) in cache for grading
        _set_cached_structure(story_id, result)
        log_ai_usage(
            db,
            endpoint=f"/stories/{story_id}/structure",
            step="structure",
            student_id=current_user.id,
            story_id=story_id,
            story_title=story["title"],
            input_tokens=0,
            output_tokens=0,
            model="yaml",
            latency_ms=0,
            success=True,
            model_version=None,
            prompt_char_count=None,
            response_char_count=None,
            content_filtered=False,
            cache_hit=True,
            prompt_template_id="story_structure_yaml",
        )
        return _sanitize_structure_for_client(result)

    # Priority 2: story_structure_rows — AI-generated dict rows (checkbox fallback)
    yaml_rows = story.get("story_structure_rows")
    if yaml_rows and isinstance(yaml_rows, list):
        result = {"rows": yaml_rows}
        _set_cached_structure(story_id, result)
        log_ai_usage(
            db,
            endpoint=f"/stories/{story_id}/structure",
            step="structure",
            student_id=current_user.id,
            story_id=story_id,
            story_title=story["title"],
            input_tokens=0,
            output_tokens=0,
            model="yaml",
            latency_ms=0,
            success=True,
            model_version=None,
            prompt_char_count=None,
            response_char_count=None,
            content_filtered=False,
            cache_hit=True,
            prompt_template_id="story_structure_rows_yaml",
        )
        return _sanitize_structure_for_client(result)

    # ── In-memory cache hit — return immediately without rate-limit quota ───
    cached = _get_cached_structure(story_id)
    if cached is not None:
        return _sanitize_structure_for_client(cached)

    # ── Cache miss — enforce rate limit before calling AI ───────────────────
    rl_key = f"ai:{get_client_key(request)}"
    if not ai_rate_limiter.check(rl_key, max_requests=5, window_seconds=60):
        raise HTTPException(status_code=429, detail="AI endpoint rate limit exceeded. Please wait before retrying.")

    story_text = story.get("full_text") or "\n".join(story.get("paragraphs", []))
    start_time = time.monotonic()
    result = await generate_story_structure(
        story_title=story["title"],
        story_text=story_text,
        genre=story.get("genre"),
    )
    _set_cached_structure(story_id, result)
    latency_ms = int((time.monotonic() - start_time) * 1000)

    # Track AI usage (Issue #874)
    usage = last_usage.get()
    log_ai_usage(
        db,
        endpoint=f"/stories/{story_id}/structure",
        step="structure",
        student_id=current_user.id,
        story_id=story_id,
        story_title=story["title"],
        input_tokens=usage.input_tokens if usage else 0,
        output_tokens=usage.output_tokens if usage else 0,
        model=usage.model if usage else "gemini-2.5-flash-lite",
        latency_ms=latency_ms,
        success=True,
        model_version=usage.model_version if usage else None,
        prompt_char_count=usage.prompt_char_count if usage else None,
        response_char_count=usage.response_char_count if usage else None,
        content_filtered=usage.content_filtered if usage else False,
        cache_hit=False,
        prompt_template_id="story_structure",
    )
    return _sanitize_structure_for_client(result)


# ── ⑤ 文章重點表 批改 endpoint (#1082) ────────────────────────────────────────

@router.post("/stories/{story_id}/structure/grade")
async def grade_story_structure_endpoint(
    request: Request,
    story_id: str,
    body: GradeStructureRequest,
    current_user: User = Depends(get_current_user),
):
    """Grade student answers for the interactive story structure table (#1082).

    Requires authentication. Uses the cached structure (must have called GET first).
    For fill_blank rows: fuzzy Chinese text match.
    For checkbox rows: exact index match against correct_options.

    Rate limited: 5 requests per minute per user/IP (Issue #1253).
    Returns {results: [...], score: 0-100}.
    """
    try:
        numeric_id = int(normalize_story_slug(story_id))
    except (ValueError, TypeError):
        raise HTTPException(status_code=404, detail="Story not found")
    story = get_lesson_by_id(numeric_id)
    if not story:
        raise HTTPException(status_code=404, detail="Story not found")

    cached = _get_cached_structure(story_id)
    if cached is None:
        raise HTTPException(
            status_code=400,
            detail="Structure not yet generated. Call GET /api/stories/{story_id}/structure first.",
        )

    # Rate limit only after all early-return checks pass, so failed pre-flight requests don't burn quota
    rl_key = f"ai:{get_client_key(request)}"
    if not ai_rate_limiter.check(rl_key, max_requests=5, window_seconds=60):
        raise HTTPException(status_code=429, detail="AI endpoint rate limit exceeded. Please wait before retrying.")

    story_text = story.get("full_text") or "\n".join(story.get("paragraphs", []))
    answers_payload = [a.model_dump() for a in body.answers]
    result = await grade_story_structure(
        structure=cached,
        answers=answers_payload,
        story_text=story_text,
    )
    return result
