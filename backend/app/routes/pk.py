"""PK 對戰 (雙人 PK 模式) API — Issue #3586. ``/api/pk/*``.

Deliberately its own router/prefix (PRD independence rule #2): no write
here ever touches ``live_quiz_*``/``league_*`` tables.

authz note (every id in path/body/query is bound to the caller, never just
"does this id exist"):
  - queue_id / match_id (path params)  -> engine/matchmaking "get_for_user"
    helpers 403 a non-owner/non-participant before returning anything.
  - classroom_id (body)                -> engine.require_classroom_membership
    (student endpoints) / engine.require_classroom_teacher (teacher endpoint).
  - invite_code (body)                 -> matchmaking.redeem_invite re-checks
    classroom membership against the INVITE's own classroom_id, not whatever
    the caller claims.
"""
from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Path, Query
from sqlalchemy.orm import Session

from ..auth.dependencies import get_current_user
from ..database import get_db
from ..models.user import User
from ..schemas.pk import (
    PkAnswerRequest,
    PkChallengeAiRequest,
    PkInviteCreateRequest,
    PkQueueJoinRequest,
)
from ..services.pk import engine, matchmaking

router = APIRouter(prefix="/pk", tags=["pk"])

QueueId = Annotated[int, Path(ge=1)]
MatchId = Annotated[int, Path(ge=1)]


@router.post("/queue", status_code=201)
def join_queue(
    payload: PkQueueJoinRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if payload.invite_code:
        q, match = matchmaking.redeem_invite(db, current_user, payload.invite_code)
        return {"queue_id": q.id, "status": q.status, "match_id": match.id}
    q = matchmaking.create_queue_entry(
        db,
        current_user,
        scope_type=payload.scope_type,
        scope_ref=payload.scope_ref,
        classroom_id=payload.classroom_id,
    )
    return {"queue_id": q.id, "status": q.status, "match_id": q.match_id}


@router.get("/queue/{queue_id}/poll")
def poll_queue(
    queue_id: QueueId,
    after_version: int | None = Query(default=None),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    q = matchmaking.get_queue_for_user(db, queue_id, current_user)
    state = matchmaking.poll_queue(db, q)
    if after_version is not None and after_version == state["version"]:
        return {"queue_id": state["queue_id"], "version": state["version"], "unchanged": True}
    return state


@router.post("/queue/{queue_id}/cancel", status_code=204)
def cancel_queue(
    queue_id: QueueId,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    q = matchmaking.get_queue_for_user(db, queue_id, current_user)
    matchmaking.cancel_queue(db, q)


@router.post("/invite", status_code=201)
def create_invite(
    payload: PkInviteCreateRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    q = matchmaking.create_invite(
        db,
        current_user,
        scope_type=payload.scope_type,
        scope_ref=payload.scope_ref,
        classroom_id=payload.classroom_id,
    )
    return {
        "queue_id": q.id,
        "invite_code": q.invite_code,
        "invite_expires_at": q.invite_expires_at.isoformat(),
    }


@router.get("/opponents")
def get_opponents(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    return engine.get_opponents_view(db, current_user)


@router.post("/challenge-ai", status_code=201)
def challenge_ai(
    payload: PkChallengeAiRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if payload.classroom_id is not None:
        engine.require_classroom_membership(db, payload.classroom_id, current_user.id)
    match = engine.create_ai_match(
        db,
        current_user,
        scope_type=payload.scope_type,
        scope_ref=payload.scope_ref,
        bot_tier=payload.bot_tier,
        classroom_id=payload.classroom_id,
    )
    return {"match_id": match.id}


@router.get("/matches/{match_id}/state")
def get_match_state(
    match_id: MatchId,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    match = engine.get_match_for_user(db, match_id, current_user)
    return engine.build_match_state(db, match, current_user)


@router.post("/matches/{match_id}/answer")
def submit_answer(
    match_id: MatchId,
    payload: PkAnswerRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    match = engine.get_match_for_user(db, match_id, current_user)
    return engine.submit_match_answer(db, match, current_user, payload.choice_key)


@router.get("/matches/{match_id}/result")
def get_match_result(
    match_id: MatchId,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    match = engine.get_match_for_user(db, match_id, current_user)
    return engine.get_match_result(db, match, current_user)


@router.get("/history")
def get_history(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    return {"matches": engine.list_history(db, current_user)}


@router.get("/rating/me")
def get_my_rating(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    return engine.get_rating_view(db, current_user)
