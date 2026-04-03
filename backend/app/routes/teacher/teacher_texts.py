"""Teacher custom text library endpoints: my-texts CRUD."""
import logging
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from ...auth.dependencies import get_current_user
from ...database import get_db
from ...models.text import Text, TextStatus, VisibilityLevel
from ...models.user import User
from ...services.input_sanitizer import sanitize_ai_input
from .teacher_schemas import (
    TeacherTextCreateRequest,
    TeacherTextDetail,
    TeacherTextItem,
    TeacherTextListResponse,
    TeacherTextUpdateRequest,
)

router = APIRouter(tags=["teacher"])
logger = logging.getLogger(__name__)

_GENRE_TO_CATEGORY = {
    "記敘文": "Fable",
    "說明文": "Science",
    "説明文": "Science",
    "議論文": "History",
    "文言文": "History",
    "應用文": "Daily",
}

_GRADE_CODE_MAP = {
    4: "G4",
    5: "G5",
    6: "G6",
    7: "G7",
    8: "G8",
    9: "G9",
}


def _text_to_item(text: Text) -> TeacherTextItem:
    return TeacherTextItem(
        id=text.id,
        title=text.title,
        grade=text.grade,
        grade_code=text.grade_code,
        genre=text.genre,
        text_type=text.text_type,
        paragraph_count=len(text.paragraphs) if text.paragraphs else 0,
        char_count=text.char_count,
        reading_strategy=text.reading_strategy,
        status=text.status,
        created_at=text.created_at,
        updated_at=text.updated_at,
    )


def _text_to_detail(text: Text) -> TeacherTextDetail:
    item = _text_to_item(text)
    return TeacherTextDetail(
        **item.model_dump(),
        paragraphs=text.paragraphs or [],
        vocabulary=text.vocabulary,
    )


def _get_text_or_404(text_id: int, teacher_id: int, db: Session) -> Text:
    """Return Text owned by this teacher or raise 404."""
    text = db.query(Text).filter(
        Text.id == text_id,
        Text.teacher_id == teacher_id,
    ).first()
    if not text:
        raise HTTPException(status_code=404, detail="課文不存在或無權限存取")
    return text


@router.get(
    "/teacher/my-texts",
    response_model=TeacherTextListResponse,
)
def list_my_texts(
    search: str | None = None,
    grade: int | None = None,
    genre: str | None = None,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """List all custom texts created by the authenticated teacher."""
    query = db.query(Text).filter(Text.teacher_id == current_user.id)

    if grade is not None:
        query = query.filter(Text.grade == grade)
    if genre:
        query = query.filter(Text.genre == genre)
    if search:
        query = query.filter(Text.title.ilike(f"%{search}%"))

    texts = query.order_by(Text.updated_at.desc()).all()
    return TeacherTextListResponse(
        texts=[_text_to_item(t) for t in texts],
        total=len(texts),
    )


@router.get(
    "/teacher/my-texts/{text_id}",
    response_model=TeacherTextDetail,
)
def get_my_text(
    text_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Get full detail of a teacher's custom text."""
    text = _get_text_or_404(text_id, current_user.id, db)
    return _text_to_detail(text)


@router.post(
    "/teacher/my-texts",
    response_model=TeacherTextDetail,
    status_code=201,
)
def create_my_text(
    body: TeacherTextCreateRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Create a new custom text owned by the authenticated teacher."""
    # Sanitize teacher-provided text — these are used in AI prompts
    safe_title, _ = sanitize_ai_input(body.title, user_id=str(current_user.id))
    safe_paragraphs = []
    for p in body.paragraphs:
        safe_p, _ = sanitize_ai_input(p, user_id=str(current_user.id))
        safe_paragraphs.append(safe_p)

    full_text = "\n".join(safe_paragraphs)
    char_count = len(full_text.replace("\n", "").replace(" ", ""))
    grade_code = _GRADE_CODE_MAP.get(body.grade, f"G{body.grade}")
    category = _GENRE_TO_CATEGORY.get(body.genre, "Daily")

    text = Text(
        title=safe_title,
        grade=body.grade,
        grade_code=grade_code,
        genre=body.genre,
        text_type=body.text_type,
        category=category,
        reading_strategy=body.reading_strategy,
        paragraphs=safe_paragraphs,
        full_text=full_text,
        char_count=char_count,
        vocabulary=body.vocabulary,
        visibility=VisibilityLevel.private,
        status=TextStatus.draft,
        teacher_id=current_user.id,
        created_by_id=current_user.id,
    )
    db.add(text)
    db.commit()
    db.refresh(text)
    return _text_to_detail(text)


@router.put(
    "/teacher/my-texts/{text_id}",
    response_model=TeacherTextDetail,
)
def update_my_text(
    text_id: int,
    body: TeacherTextUpdateRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Update an existing custom text owned by the authenticated teacher."""
    text = _get_text_or_404(text_id, current_user.id, db)

    if body.title is not None:
        text.title, _ = sanitize_ai_input(body.title, user_id=str(current_user.id))
    if body.grade is not None:
        text.grade = body.grade
        text.grade_code = _GRADE_CODE_MAP.get(body.grade, f"G{body.grade}")
    if body.genre is not None:
        text.genre = body.genre
        text.category = _GENRE_TO_CATEGORY.get(body.genre, "Daily")
    if body.text_type is not None:
        text.text_type = body.text_type
    if body.reading_strategy is not None:
        text.reading_strategy = body.reading_strategy
    if body.paragraphs is not None:
        safe_paragraphs = []
        for p in body.paragraphs:
            safe_p, _ = sanitize_ai_input(p, user_id=str(current_user.id))
            safe_paragraphs.append(safe_p)
        text.paragraphs = safe_paragraphs
        full_text = "\n".join(safe_paragraphs)
        text.full_text = full_text
        text.char_count = len(full_text.replace("\n", "").replace(" ", ""))
    if body.vocabulary is not None:
        text.vocabulary = body.vocabulary

    text.updated_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(text)
    return _text_to_detail(text)


@router.delete(
    "/teacher/my-texts/{text_id}",
    status_code=204,
)
def delete_my_text(
    text_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Delete a custom text owned by the authenticated teacher."""
    text = _get_text_or_404(text_id, current_user.id, db)
    db.delete(text)
    db.commit()
