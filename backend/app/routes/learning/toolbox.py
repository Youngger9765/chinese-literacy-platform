"""Practice Toolbox session endpoints (#1463 / #1460 Phase 2).

Each of the 10 toolbox tools (`/tools` page) writes single-shot practice
results into its own dedicated table created in #1460:

    POST   /api/toolbox/{tool}/sessions           create a completed session row
    GET    /api/toolbox/sessions/all              aggregated history across all tools
    GET    /api/toolbox/{tool}/sessions           list the current student's sessions

#1473: POST now accepts the full completed payload (score, result, duration_ms).
The row is created already in completed state (completed_at = NOW()).
The old two-step POST-then-PATCH pattern is replaced by a single atomic call,
eliminating orphan rows when the user closes the tab between the two requests.

The PATCH endpoint has been removed (#1473).

#1476: `GET /toolbox/sessions/all` is declared BEFORE `GET /toolbox/{tool_id}/sessions`
to follow FastAPI convention (static segments before parameterized segments).

`{tool}` ∈ TOOL_MODEL_MAP keys (10 tools). Each row is independent — there is
no progression / next-step concept (that's why this is split out from
``learning_sessions``).

Authorization: every endpoint requires the authenticated user; rows are
always scoped to ``current_user.id`` — no admin / cross-student access here
(use the dedicated learning-history endpoints for teacher views).
"""

from datetime import datetime, timezone
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
    """Full payload for a completed toolbox practice (#1473).

    All practice data is submitted in a single atomic request so the row is
    created already in completed state. This eliminates the previous
    two-step POST-then-PATCH pattern that left orphan rows when the user
    closed the tab between requests.

    `text_id` is optional — some tools (e.g. knowledge-station) may not be
    tied to a specific lesson. `result` defaults to {} and is stored as JSONB.
    """

    text_id: int | None = None
    result: dict[str, Any] = Field(default_factory=dict)
    score: float | None = None
    duration_ms: int | None = None


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
# Note: /toolbox/sessions/all MUST be declared before /toolbox/{tool_id}/sessions
# so FastAPI matches the static segment "sessions/all" before the parameterized
# {tool_id} path. (#1476)
# ---------------------------------------------------------------------------


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

    TODO(#1463 follow-up): the current implementation pulls up to `limit`
    rows from EACH of the 10 tables and then truncates after sorting, so
    a heavy user could miss recent rows from one table when an older table
    has many rows. For a small/early-traffic period this is acceptable;
    once usage grows, replace with a single SQL UNION ALL keyset paginated
    by started_at, or move toolbox tables behind a unified view.
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


@router.post("/toolbox/{tool_id}/sessions", response_model=ToolboxSessionItem)
def create_toolbox_session(
    tool_id: str,
    payload: ToolboxSessionCreate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Record a completed toolbox practice in a single atomic request (#1473).

    The row is created already in completed state (completed_at = NOW()).
    All practice data — result blob, score, duration — is submitted together
    to avoid orphan rows from two-step POST-then-PATCH patterns.
    """
    model = _resolve_model(tool_id)

    row = model(
        student_id=current_user.id,
        text_id=payload.text_id,
        result=payload.result,
        score=payload.score,
        duration_ms=payload.duration_ms,
        completed_at=datetime.now(timezone.utc),
    )
    db.add(row)
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
