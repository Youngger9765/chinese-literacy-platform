"""Teacher story tags endpoints: difficulty levels and custom labels for stories."""
import logging

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from ...auth.dependencies import get_current_user
from ...database import get_db
from ...models.story_tag import StoryTag
from ...models.user import User
from .teacher_schemas import StoryTagResponse, StoryTagUpsertRequest

router = APIRouter(tags=["teacher"])
logger = logging.getLogger(__name__)

VALID_DIFFICULTY_LEVELS = {"easy", "medium", "hard"}
MAX_CUSTOM_TAGS = 10
MAX_TAG_LENGTH = 30


def _get_or_create_story_tag(
    teacher_id: int, story_ref: str, db: Session
) -> StoryTag:
    tag = db.query(StoryTag).filter(
        StoryTag.teacher_id == teacher_id,
        StoryTag.story_ref == story_ref,
    ).first()
    if not tag:
        tag = StoryTag(teacher_id=teacher_id, story_ref=story_ref)
        db.add(tag)
    return tag


@router.get(
    "/teacher/story-tags/{story_ref}",
    response_model=StoryTagResponse,
)
def get_story_tag(
    story_ref: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Get the teacher's difficulty and custom tags for a story.

    story_ref: lesson_number string for platform stories (e.g. "3"),
               or "text:{id}" for teacher-created texts (e.g. "text:42").
    Returns default values if no tag record exists yet.
    """
    tag = db.query(StoryTag).filter(
        StoryTag.teacher_id == current_user.id,
        StoryTag.story_ref == story_ref,
    ).first()
    if not tag:
        return StoryTagResponse(
            story_ref=story_ref,
            difficulty_level=None,
            custom_tags=[],
        )
    return StoryTagResponse(
        story_ref=story_ref,
        difficulty_level=tag.difficulty_level,
        custom_tags=tag.custom_tags or [],
    )


@router.put(
    "/teacher/story-tags/{story_ref}",
    response_model=StoryTagResponse,
)
def upsert_story_tag(
    story_ref: str,
    body: StoryTagUpsertRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Set or update difficulty and custom tags for a story.

    story_ref: lesson_number string for platform stories (e.g. "3"),
               or "text:{id}" for teacher-created texts (e.g. "text:42").
    Passing null for difficulty_level clears the override (falls back to auto-detect).
    Passing an empty list for custom_tags clears all tags.
    """
    if body.difficulty_level is not None and body.difficulty_level not in VALID_DIFFICULTY_LEVELS:
        raise HTTPException(
            status_code=422,
            detail=f"difficulty_level must be one of: {sorted(VALID_DIFFICULTY_LEVELS)}",
        )
    if body.custom_tags is not None:
        if len(body.custom_tags) > MAX_CUSTOM_TAGS:
            raise HTTPException(
                status_code=422,
                detail=f"custom_tags cannot exceed {MAX_CUSTOM_TAGS} items",
            )
        for t in body.custom_tags:
            if len(t.strip()) == 0:
                raise HTTPException(status_code=422, detail="Tag names cannot be empty")
            if len(t) > MAX_TAG_LENGTH:
                raise HTTPException(
                    status_code=422,
                    detail=f"Each tag must be {MAX_TAG_LENGTH} characters or fewer",
                )

    tag = _get_or_create_story_tag(current_user.id, story_ref, db)
    if body.difficulty_level is not None or (
        body.difficulty_level is None and "difficulty_level" in body.model_fields_set
    ):
        tag.difficulty_level = body.difficulty_level
    if body.custom_tags is not None:
        tag.custom_tags = [t.strip() for t in body.custom_tags if t.strip()]

    db.commit()
    db.refresh(tag)
    return StoryTagResponse(
        story_ref=story_ref,
        difficulty_level=tag.difficulty_level,
        custom_tags=tag.custom_tags or [],
    )


@router.delete(
    "/teacher/story-tags/{story_ref}",
    status_code=204,
)
def delete_story_tag(
    story_ref: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Remove all custom tags and difficulty override for a story."""
    tag = db.query(StoryTag).filter(
        StoryTag.teacher_id == current_user.id,
        StoryTag.story_ref == story_ref,
    ).first()
    if tag:
        db.delete(tag)
        db.commit()


@router.get(
    "/teacher/story-tags",
    response_model=list[StoryTagResponse],
)
def list_story_tags(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """List all story tag settings created by the authenticated teacher."""
    tags = db.query(StoryTag).filter(
        StoryTag.teacher_id == current_user.id
    ).order_by(StoryTag.updated_at.desc()).all()
    return [
        StoryTagResponse(
            story_ref=t.story_ref,
            difficulty_level=t.difficulty_level,
            custom_tags=t.custom_tags or [],
        )
        for t in tags
    ]
