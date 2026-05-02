"""
Stories API — serves platform lessons from in-memory YAML data.
No database dependency for platform content.
"""

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
from ..schemas.story import StoryListItem, StoryDetail, StoryListResponse, StoryIntroSchema

# ---------------------------------------------------------------------------
# Simple TTL cache for story structure results (avoids redundant Gemini calls)
# v2 cache key prefix — invalidates old non-interactive cache entries (#1082)
# ---------------------------------------------------------------------------

_structure_cache: dict[str, tuple[float, object]] = {}
_CACHE_TTL = 86400  # 24 hours
_CACHE_VERSION = "v2"  # bump when schema changes to auto-invalidate


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

_BLANK_RE = re.compile(r"【([^】]*)】")


def _classify_cell(text: str) -> str:
    """Return 'fill_blank' if the cell has 【…】 blanks, else 'display'."""
    return "fill_blank" if _BLANK_RE.search(text) else "display"


def _cell_to_row_dict(label: str, value: str) -> dict:
    """Build a StructureRow dict from a label + value string."""
    itype = _classify_cell(value)
    row: dict = {
        "label": label.strip(),
        "value": value.strip(),
        "interactive_type": itype,
    }
    if itype == "fill_blank":
        # Extract first blank content as the reference answer hint
        m = _BLANK_RE.search(value)
        if m:
            row["hint"] = m.group(1).strip()
    return row


def _format_yaml_structure_table(table: list) -> dict:
    """Convert story_structure_table YAML list → {'rows': [...]} API shape.

    YAML row formats:
      [title]                   → 1-cell display row (title of the whole table)
      [label, value]            → simple row (fill_blank if has 【…】, else display)
      [label, sub_label, sub_value, ...]  → row with sub_rows (pairs after label)
      [label, col1, col2, col3] → header row or row with 3 sub-cells (display)

    All interactive_type values are 'fill_blank' or 'display'.
    Checkbox interactivity is NOT reproduced from YAML (requires AI options arrays);
    cells with □ checkbox markers are treated as 'display'.
    """
    rows: list[dict] = []

    for raw_row in table:
        if not isinstance(raw_row, list) or not raw_row:
            continue

        n = len(raw_row)

        if n == 1:
            # Title row — display spanning label
            rows.append({
                "label": str(raw_row[0]).strip(),
                "value": "",
                "interactive_type": "display",
            })

        elif n == 2:
            # [label, value]
            rows.append(_cell_to_row_dict(str(raw_row[0]), str(raw_row[1])))

        elif n == 3:
            # [label, sub_label, sub_value] — row with one sub_row
            row = {
                "label": str(raw_row[0]).strip(),
                "value": "",
                "interactive_type": "display",
                "sub_rows": [
                    _cell_to_row_dict(str(raw_row[1]), str(raw_row[2])),
                ],
            }
            rows.append(row)

        else:
            # n >= 4: treat as row with (n-1)/2 paired sub_rows if n is odd,
            # or as a display row with all remaining cells joined if even
            label = str(raw_row[0]).strip()
            remainder = [str(c) for c in raw_row[1:]]

            # Try to pair as (sub_label, sub_value) only when length is even
            if len(remainder) % 2 == 0:
                sub_rows = []
                for i in range(0, len(remainder), 2):
                    sub_rows.append(_cell_to_row_dict(remainder[i], remainder[i + 1]))
                rows.append({
                    "label": label,
                    "value": "",
                    "interactive_type": "display",
                    "sub_rows": sub_rows,
                })
            else:
                # Odd remainder — join all as a single display row
                combined = " ".join(remainder)
                rows.append({
                    "label": label,
                    "value": combined,
                    "interactive_type": "display",
                })

    return {"rows": rows}


# ---------------------------------------------------------------------------
# Request / Response schemas for grading
# ---------------------------------------------------------------------------

class StructureAnswerItem(BaseModel):
    row_index: int
    sub_row_index: int | None = None
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
        reading_benchmark=story["reading_benchmark"],
        text_type=story["text_type"],
        source_file=story["source_file"],
        strategy_exercise=story.get("strategy_exercise"),
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

    # ── YAML-first: use pre-stored structure data if available (#1377, #1398) ──
    # Priority 1: story_structure_rows — AI-generated dict rows (full checkbox support)
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
        return result

    # Priority 2: story_structure_table — docx-parsed list-of-lists (ground truth)
    yaml_table = story.get("story_structure_table")
    if yaml_table:
        result = _format_yaml_structure_table(yaml_table)
        # Store in cache so grade endpoint can use it; log as zero-cost hit
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
        return result

    # ── In-memory cache hit — return immediately without rate-limit quota ───
    cached = _get_cached_structure(story_id)
    if cached is not None:
        return cached

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
        model=usage.model if usage else "gemini-2.5-flash",
        latency_ms=latency_ms,
        success=True,
        model_version=usage.model_version if usage else None,
        prompt_char_count=usage.prompt_char_count if usage else None,
        response_char_count=usage.response_char_count if usage else None,
        content_filtered=usage.content_filtered if usage else False,
        cache_hit=False,
        prompt_template_id="story_structure",
    )
    return result


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
