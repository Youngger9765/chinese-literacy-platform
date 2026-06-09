"""Annotation persistence routes (Issue #2070).

Provides two endpoints to save and load reading-annotation step marks
from the ``annotation_entries`` table.

    PUT  /api/learning/sessions/{session_id}/annotations  — full replace (save)
    GET  /api/learning/sessions/{session_id}/annotations  — load all marks

Design notes:
- PUT replaces all annotations for the session atomically (delete-insert).
  The frontend always sends the full list, mirroring the localStorage approach.
- Ownership check: student can only access their own session (same pattern as
  learning_step_progress._get_owned_session).
- Input size cap: max 500 annotations per session (prevents abuse while well
  above any realistic reading use case).
- No LLM calls; llm-endpoint-hardening does not apply, but auth + size cap do.
"""
import logging
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field, field_validator
from sqlalchemy.orm import Session

from ...auth.dependencies import get_current_user
from ._helpers import get_owned_session
from ...database import get_db
from ...models.annotation import AnnotationEntry
from ...models.user import User

router = APIRouter()
logger = logging.getLogger(__name__)

# Hard cap: prevents runaway writes while covering all realistic use cases.
# A full ~10-paragraph text with heavy annotation would rarely exceed 200 marks.
_MAX_ANNOTATIONS_PER_SESSION = 500

# Allowed annotation type values — fixed vocabulary
_VALID_ANNOTATION_TYPES = {"unknown", "important"}


# ── Pydantic schemas ────────────────────────────────────────────────────────


class AnnotationIn(BaseModel):
    """One annotation mark as sent by the frontend."""

    paragraph_index: int = Field(..., ge=0, description="0-based paragraph index")
    char_start: int = Field(..., ge=0, description="Start char offset (inclusive)")
    char_end: int = Field(..., ge=1, description="End char offset (exclusive)")
    annotation_type: str = Field(..., description="'unknown' or 'important'")
    client_id: str | None = Field(None, max_length=64)

    @field_validator("annotation_type")
    @classmethod
    def validate_type(cls, v: str) -> str:
        if v not in _VALID_ANNOTATION_TYPES:
            raise ValueError(
                f"annotation_type must be one of {_VALID_ANNOTATION_TYPES}, got {v!r}"
            )
        return v

    @field_validator("char_end")
    @classmethod
    def validate_end_gt_start(cls, v: int, info) -> int:
        start = info.data.get("char_start", 0)
        if v <= start:
            raise ValueError("char_end must be greater than char_start")
        return v


class AnnotationSaveRequest(BaseModel):
    """Full annotation list for a session — replaces any existing marks."""

    annotations: Annotated[
        list[AnnotationIn],
        Field(
            default_factory=list,
            description="Full list of annotation marks (replaces existing)",
        ),
    ]


class AnnotationOut(BaseModel):
    """One annotation mark as returned by the API."""

    id: int
    paragraph_index: int
    char_start: int
    char_end: int
    annotation_type: str
    client_id: str | None

    model_config = {"from_attributes": True}


class AnnotationLoadResponse(BaseModel):
    """Response for GET …/annotations."""

    session_id: int
    annotations: list[AnnotationOut]


# ── Endpoints ────────────────────────────────────────────────────────────────


@router.put(
    "/learning/sessions/{session_id}/annotations",
    response_model=AnnotationLoadResponse,
    summary="Save (replace) all annotation marks for a session (Issue #2070)",
)
def save_annotations(
    session_id: int,
    payload: AnnotationSaveRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> AnnotationLoadResponse:
    """Replace all annotation marks for a session.

    Atomically deletes existing rows and inserts the full incoming list.
    Sending an empty list clears all annotations.

    Returns the saved annotations (with server-assigned IDs) so the frontend
    can detect persistence failures.
    """
    get_owned_session(session_id, current_user, db)

    # Input size cap
    if len(payload.annotations) > _MAX_ANNOTATIONS_PER_SESSION:
        raise HTTPException(
            status_code=422,
            detail=f"Too many annotations (max {_MAX_ANNOTATIONS_PER_SESSION})",
        )

    # Atomic replace: delete all existing, then insert new
    db.query(AnnotationEntry).filter(
        AnnotationEntry.session_id == session_id
    ).delete(synchronize_session=False)

    new_rows: list[AnnotationEntry] = []
    for ann in payload.annotations:
        row = AnnotationEntry(
            session_id=session_id,
            paragraph_index=ann.paragraph_index,
            char_start=ann.char_start,
            char_end=ann.char_end,
            annotation_type=ann.annotation_type,
            client_id=ann.client_id,
        )
        db.add(row)
        new_rows.append(row)

    db.commit()

    # Single batch query to reload all saved rows (avoids N+1 db.refresh() calls).
    # We need the server-assigned id and created_at which are only available after commit.
    saved_rows = (
        db.query(AnnotationEntry)
        .filter(AnnotationEntry.session_id == session_id)
        .order_by(AnnotationEntry.paragraph_index, AnnotationEntry.char_start)
        .all()
    )

    logger.info(
        "Saved %d annotations for session %d (user %d)",
        len(saved_rows),
        session_id,
        current_user.id,
    )
    return AnnotationLoadResponse(
        session_id=session_id,
        annotations=[AnnotationOut.model_validate(row) for row in saved_rows],
    )


@router.get(
    "/learning/sessions/{session_id}/annotations",
    response_model=AnnotationLoadResponse,
    summary="Load all annotation marks for a session (Issue #2070)",
)
def load_annotations(
    session_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> AnnotationLoadResponse:
    """Return all saved annotation marks for a session.

    Returns an empty list when no annotations have been saved yet
    (frontend should then fall back to localStorage cache if available).
    """
    get_owned_session(session_id, current_user, db)

    rows = (
        db.query(AnnotationEntry)
        .filter(AnnotationEntry.session_id == session_id)
        .order_by(AnnotationEntry.paragraph_index, AnnotationEntry.char_start)
        .all()
    )

    return AnnotationLoadResponse(
        session_id=session_id,
        annotations=[AnnotationOut.model_validate(row) for row in rows],
    )
