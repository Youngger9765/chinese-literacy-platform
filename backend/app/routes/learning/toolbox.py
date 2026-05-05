"""Practice Toolbox session endpoints (#1463 / #1460 Phase 2).

Each of the 10 toolbox tools (`/tools` page) writes single-shot practice
results into its own dedicated table created in #1460:

    POST   /api/toolbox/{tool}/sessions           create a new session row
    PATCH  /api/toolbox/{tool}/sessions/{id}      update result / score / completion
    GET    /api/toolbox/{tool}/sessions           list the current student's sessions

`{tool}` ∈ TOOL_MODEL_MAP keys (10 tools). Each row is independent — there is
no progression / next-step concept (that's why this is split out from
``learning_sessions``).

Authorization: every endpoint requires the authenticated user; rows are
always scoped to ``current_user.id`` — no admin / cross-student access here
(use the dedicated learning-history endpoints for teacher views).
"""

from datetime import datetime
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy import desc
from sqlalchemy.orm import Session

from ...auth.dependencies import get_current_user
from ...database import get_db
from ...models.toolbox import (
    ToolboxComprehensionSession,
    ToolboxFullReadingSession,
    ToolboxKnowledgeStationSession,
    ToolboxListeningSession,
    ToolboxSentencePracticeSession,
    ToolboxTutorSession,
    ToolboxVocabApplicationSession,
    ToolboxVocabDefinitionSession,
    ToolboxVocabSession,
    ToolboxVocabWordSearchSession,
)
from ...models.user import User

router = APIRouter()


# ---------------------------------------------------------------------------
# Tool registry — single source of truth for tool_id → ORM model mapping.
# Order matches frontend TOOL_OPTIONS (ToolPicker.tsx).
# ---------------------------------------------------------------------------

TOOL_MODEL_MAP: dict[str, type] = {
    "tutor": ToolboxTutorSession,
    "full-reading": ToolboxFullReadingSession,
    "listening": ToolboxListeningSession,
    "vocab": ToolboxVocabSession,
    "sentence-practice": ToolboxSentencePracticeSession,
    "vocab-definition": ToolboxVocabDefinitionSession,
    "vocab-application": ToolboxVocabApplicationSession,
    "comprehension": ToolboxComprehensionSession,
    "vocab-word-search": ToolboxVocabWordSearchSession,
    "knowledge-station": ToolboxKnowledgeStationSession,
}


def _resolve_model(tool_id: str) -> type:
    model = TOOL_MODEL_MAP.get(tool_id)
    if model is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Unknown toolbox tool: {tool_id}",
        )
    return model


# ---------------------------------------------------------------------------
# Request / Response schemas
# ---------------------------------------------------------------------------


class ToolboxSessionCreate(BaseModel):
    """Minimal payload to start a toolbox session.

    `text_id` is optional — some tools (e.g. knowledge-station) may not be
    tied to a specific lesson at start time. `result` defaults to {} so the
    row can be patched once the practice completes.
    """

    text_id: int | None = None
    result: dict[str, Any] = Field(default_factory=dict)


class ToolboxSessionUpdate(BaseModel):
    """Patch payload — all fields optional. Setting `completed_at` marks
    the practice finished; the client should set this on the same call
    that delivers the final `result`."""

    result: dict[str, Any] | None = None
    score: float | None = None
    duration_ms: int | None = None
    completed_at: datetime | None = None


class ToolboxSessionItem(BaseModel):
    id: int
    student_id: int
    text_id: int | None
    result: dict[str, Any]
    score: float | None
    duration_ms: int | None
    started_at: datetime
    completed_at: datetime | None
    tool_id: str  # echoed back so the frontend can render history without re-keying

    class Config:
        from_attributes = True


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------


@router.post("/toolbox/{tool_id}/sessions", response_model=ToolboxSessionItem)
def create_toolbox_session(
    tool_id: str,
    payload: ToolboxSessionCreate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Open a new toolbox session row. Returns the created row's id so the
    frontend can PATCH it on completion."""
    model = _resolve_model(tool_id)

    row = model(
        student_id=current_user.id,
        text_id=payload.text_id,
        result=payload.result,
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return _serialize(row, tool_id)


@router.patch(
    "/toolbox/{tool_id}/sessions/{session_id}",
    response_model=ToolboxSessionItem,
)
def update_toolbox_session(
    tool_id: str,
    session_id: int,
    payload: ToolboxSessionUpdate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Patch result / score / duration / completion timestamp.

    404 if the row doesn't exist OR belongs to a different student
    (no info-leak about which IDs exist in other students' rows).
    """
    model = _resolve_model(tool_id)

    row = (
        db.query(model)
        .filter(model.id == session_id, model.student_id == current_user.id)
        .first()
    )
    if row is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Session not found")

    if payload.result is not None:
        row.result = payload.result
    if payload.score is not None:
        row.score = payload.score
    if payload.duration_ms is not None:
        row.duration_ms = payload.duration_ms
    if payload.completed_at is not None:
        row.completed_at = payload.completed_at

    db.commit()
    db.refresh(row)
    return _serialize(row, tool_id)


@router.get(
    "/toolbox/{tool_id}/sessions",
    response_model=list[ToolboxSessionItem],
)
def list_toolbox_sessions(
    tool_id: str,
    limit: int = 50,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """List the current student's sessions for one tool, newest first."""
    model = _resolve_model(tool_id)
    limit = max(1, min(limit, 200))

    rows = (
        db.query(model)
        .filter(model.student_id == current_user.id)
        .order_by(desc(model.started_at))
        .limit(limit)
        .all()
    )
    return [_serialize(r, tool_id) for r in rows]


@router.get(
    "/toolbox/sessions/all",
    response_model=list[ToolboxSessionItem],
)
def list_all_toolbox_sessions(
    limit: int = 100,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Aggregated history across all 10 tool tables, newest first.

    Used by the 學習紀錄 page to show "練習工具箱" sessions inline with
    self-practice ones (#1463 Phase 3). Per-tool tag is in `tool_id`.
    """
    limit = max(1, min(limit, 500))
    items: list[ToolboxSessionItem] = []
    for tid, model in TOOL_MODEL_MAP.items():
        rows = (
            db.query(model)
            .filter(model.student_id == current_user.id)
            .order_by(desc(model.started_at))
            .limit(limit)
            .all()
        )
        items.extend(_serialize(r, tid) for r in rows)

    items.sort(key=lambda x: x.started_at, reverse=True)
    return items[:limit]


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _serialize(row, tool_id: str) -> ToolboxSessionItem:
    return ToolboxSessionItem(
        id=row.id,
        student_id=row.student_id,
        text_id=row.text_id,
        result=row.result or {},
        score=row.score,
        duration_ms=row.duration_ms,
        started_at=row.started_at,
        completed_at=row.completed_at,
        tool_id=tool_id,
    )
