from fastapi import APIRouter, Depends, Query, HTTPException
from sqlalchemy.orm import Session

from ..database import get_db
from ..models.story import Story
from ..schemas.story import StoryListItem, StoryDetail, StoryListResponse, StoryIntroSchema
from ..config import settings

router = APIRouter(tags=["stories"])


def _thumbnail_url(path: str | None) -> str | None:
    if not path:
        return None
    return f"{settings.gcs_public_url}/{path}"


def _build_intro(story: Story) -> StoryIntroSchema:
    author = story.genre
    if story.reading_strategy:
        author = f"{story.genre} · {story.reading_strategy}"
    background = ""
    if story.paragraphs and len(story.paragraphs) > 0:
        p = story.paragraphs[0]
        background = p[:100] + "..." if len(p) > 100 else p
    return StoryIntroSchema(author=author, background=background)


@router.get("/stories", response_model=StoryListResponse)
def list_stories(
    grade: int | None = Query(None, ge=4, le=9),
    genre: str | None = Query(None),
    category: str | None = Query(None),
    search: str | None = Query(None, max_length=100),
    page: int = Query(1, ge=1),
    page_size: int = Query(60, ge=1, le=100),
    db: Session = Depends(get_db),
):
    query = db.query(Story).filter(Story.is_published == True)  # noqa: E712
    if grade:
        query = query.filter(Story.grade == grade)
    if genre:
        query = query.filter(Story.genre == genre)
    if category:
        query = query.filter(Story.category == category)
    if search:
        query = query.filter(Story.title.ilike(f"%{search}%"))

    total = query.count()
    stories = query.order_by(Story.lesson_number).offset((page - 1) * page_size).limit(page_size).all()
    grades = [r[0] for r in db.query(Story.grade).filter(Story.is_published == True).distinct().order_by(Story.grade).all()]  # noqa: E712

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
                thumbnail_url=_thumbnail_url(s.thumbnail_path),
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
    story = db.query(Story).filter(Story.id == story_id, Story.is_published == True).first()  # noqa: E712
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
        thumbnail_url=_thumbnail_url(story.thumbnail_path),
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
