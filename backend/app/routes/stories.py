"""
Stories API — serves platform lessons from in-memory YAML data.
No database dependency for platform content.
"""

from fastapi import APIRouter, Query, HTTPException, Depends
from sqlalchemy.orm import Session

from ..database import get_db
from ..models.user import User
from ..models.school import ClassroomStudent, ClassroomText
from ..auth.dependencies import get_optional_user
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
        reading_benchmark=story["reading_benchmark"],
        text_type=story["text_type"],
        source_file=story["source_file"],
    )
