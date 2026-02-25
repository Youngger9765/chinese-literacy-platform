"""
Stories API — serves platform lessons from in-memory YAML data.
No database dependency for platform content.
"""

from fastapi import APIRouter, Query, HTTPException

from ..services.lesson_loader import search_lessons, get_lesson_by_id, get_available_grades
from ..schemas.story import StoryListItem, StoryDetail, StoryListResponse, StoryIntroSchema

router = APIRouter(tags=["stories"])


@router.get("/stories", response_model=StoryListResponse)
def list_stories(
    grade: int | None = Query(None, ge=1, le=12),
    genre: str | None = Query(None),
    category: str | None = Query(None),
    search: str | None = Query(None, max_length=100),
    page: int = Query(1, ge=1),
    page_size: int = Query(60, ge=1, le=100),
):
    """List published platform stories with optional filters."""
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
def get_story(story_id: int):
    """Get full story detail by ID (lesson_number)."""
    story = get_lesson_by_id(story_id)
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
        reading_benchmark=story["reading_benchmark"],
        text_type=story["text_type"],
        source_file=story["source_file"],
    )
