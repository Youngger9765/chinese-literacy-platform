from fastapi import APIRouter, Depends, Query, HTTPException
from sqlalchemy.orm import Session
from sqlalchemy import select

from ..database import get_db
from ..models.text import Text, VisibilityLevel, TextStatus
from ..schemas.story import StoryListItem, StoryDetail, StoryListResponse, StoryIntroSchema
from ..config import settings

router = APIRouter(tags=["stories"])


def _build_thumbnail_url(path: str | None) -> str | None:
    if not path:
        return None
    return f"{settings.gcs_public_url}/{path}"


def _build_intro(text: Text) -> StoryIntroSchema:
    """Replicate lessonLoader.ts intro construction logic."""
    author = text.genre
    if text.reading_strategy:
        author = f"{text.genre} · {text.reading_strategy}"

    background = ""
    if text.paragraphs and len(text.paragraphs) > 0:
        p = text.paragraphs[0]
        background = p[:100] + "..." if len(p) > 100 else p

    return StoryIntroSchema(author=author, background=background)


@router.get("/stories", response_model=StoryListResponse)
def list_stories(
    grade: int | None = Query(None, ge=1, le=12),
    genre: str | None = Query(None),
    category: str | None = Query(None),
    search: str | None = Query(None, max_length=100),
    page: int = Query(1, ge=1),
    page_size: int = Query(60, ge=1, le=100),
    db: Session = Depends(get_db),
):
    """List published stories with optional filters."""
    query = db.query(Text).filter(
        Text.status == TextStatus.published,
        Text.visibility == VisibilityLevel.platform,
    )

    if grade is not None:
        query = query.filter(Text.grade == grade)
    if genre:
        query = query.filter(Text.genre == genre)
    if category:
        query = query.filter(Text.category == category)
    if search:
        query = query.filter(Text.title.ilike(f"%{search}%"))

    total = query.count()
    stories = (
        query.order_by(Text.lesson_number.asc().nulls_last(), Text.id)
        .offset((page - 1) * page_size)
        .limit(page_size)
        .all()
    )

    grades = [
        row[0]
        for row in db.query(Text.grade)
        .filter(Text.status == TextStatus.published, Text.visibility == VisibilityLevel.platform)
        .distinct()
        .order_by(Text.grade)
        .all()
    ]

    return StoryListResponse(
        stories=[
            StoryListItem(
                id=s.id,
                lesson_number=s.lesson_number,
                title=s.title,
                grade=s.grade,
                grade_code=s.grade_code,
                genre=s.genre,
                category=s.category,
                char_count=s.char_count,
                thumbnail_url=_build_thumbnail_url(s.thumbnail_path),
                reading_strategy=s.reading_strategy,
                intro=_build_intro(s),
            )
            for s in stories
        ],
        total=total,
        grades=grades,
    )


@router.get("/stories/{story_id}", response_model=StoryDetail)
def get_story(story_id: int, db: Session = Depends(get_db)):
    """Get full story detail by ID."""
    story = (
        db.query(Text)
        .filter(Text.id == story_id, Text.status == TextStatus.published)
        .first()
    )
    if not story:
        raise HTTPException(status_code=404, detail="Story not found")

    return StoryDetail(
        id=story.id,
        lesson_number=story.lesson_number,
        title=story.title,
        grade=story.grade,
        grade_code=story.grade_code,
        genre=story.genre,
        category=story.category,
        char_count=story.char_count,
        thumbnail_url=_build_thumbnail_url(story.thumbnail_path),
        reading_strategy=story.reading_strategy,
        intro=_build_intro(story),
        paragraphs=story.paragraphs,
        vocabulary=story.vocabulary,
        fill_in_blank=story.fill_in_blank,
        multiple_choice=story.multiple_choice,
        reading_benchmark=story.reading_benchmark,
        text_type=story.text_type,
        source_file=story.source_file,
    )
