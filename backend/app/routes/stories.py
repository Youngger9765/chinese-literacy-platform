"""
Stories API — serves platform lessons from in-memory YAML data.
No database dependency for platform content.
"""

import time
from fastapi import APIRouter, Query, HTTPException, Depends, Request
from sqlalchemy.orm import Session

from ..database import get_db
from ..models.user import User
from ..models.school import ClassroomStudent, ClassroomText
from ..auth.dependencies import get_optional_user, get_current_user
from ..auth.rate_limiter import ai_rate_limiter, get_client_key
from ..services.lesson_loader import search_lessons, get_lesson_by_id, get_available_grades
from ..services.ai_service import generate_story_structure
from ..services.ai_usage_tracker import last_usage, log_ai_usage
from ..schemas.story import StoryListItem, StoryDetail, StoryListResponse, StoryIntroSchema

# ---------------------------------------------------------------------------
# Simple TTL cache for story structure results (avoids redundant Gemini calls)
# ---------------------------------------------------------------------------

_structure_cache: dict[str, tuple[float, object]] = {}
_CACHE_TTL = 86400  # 24 hours


def _get_cached_structure(story_id: str):
    entry = _structure_cache.get(story_id)
    if entry and time.time() - entry[0] < _CACHE_TTL:
        return entry[1]
    return None


def _set_cached_structure(story_id: str, result):
    _structure_cache[story_id] = (time.time(), result)

router = APIRouter(tags=["stories"])


@router.get("/stories", response_model=StoryListResponse)
def list_stories(
    grade: int | None = Query(None, ge=1, le=12),
    genre: str | None = Query(None),
    category: str | None = Query(None),
    search: str | None = Query(None, max_length=100),
    page: int = Query(1, ge=1),
    page_size: int = Query(60, ge=1, le=100),
    user: User | None = Depends(get_optional_user),
    db: Session = Depends(get_db),
):
    """List published platform stories with optional filters.

    If the authenticated user is enrolled in classroom(s), only stories
    assigned to those classrooms are returned. Anonymous users and users
    without classroom enrollment see all stories (backward compatible).
    """
    all_results = search_lessons(grade=grade, genre=genre, category=category, search=search)

    # Filter to classroom-assigned stories when the user is enrolled
    results = all_results
    if user is not None:
        enrollments = (
            db.query(ClassroomStudent.classroom_id)
            .filter(ClassroomStudent.student_id == user.id)
            .all()
        )
        if enrollments:
            classroom_ids = [e.classroom_id for e in enrollments]
            assigned_text_ids = (
                db.query(ClassroomText.text_id)
                .filter(ClassroomText.classroom_id.in_(classroom_ids))
                .distinct()
                .all()
            )
            # text_id is stored as String; compare against integer lesson_number
            assigned_ids = {int(t.text_id) for t in assigned_text_ids}
            results = [s for s in all_results if s["lesson_number"] in assigned_ids]

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
    # Normalize "L06" → "6" format (assignments store story_id with L-prefix)
    normalized = story_id.lstrip("Ll")
    try:
        numeric_id = int(normalized)
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
    normalized = story_id.lstrip("Ll")
    try:
        numeric_id = int(normalized)
    except (ValueError, TypeError):
        raise HTTPException(status_code=404, detail="Story not found")
    story = get_lesson_by_id(numeric_id)
    if not story:
        raise HTTPException(status_code=404, detail="Story not found")

    # Cache hit — return immediately without consuming rate limit quota
    cached = _get_cached_structure(story_id)
    if cached is not None:
        return cached

    # Cache miss — enforce rate limit before calling AI
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
    _set_cached_structure(normalized, result)
    latency_ms = int((time.monotonic() - start_time) * 1000)

    # Track AI usage (Issue #874)
    usage = last_usage.get()
    log_ai_usage(
        db,
        endpoint=f"/stories/{normalized}/structure",
        step="structure",
        student_id=current_user.id,
        story_id=normalized,
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
