"""五人對抗賽 API — ``/api/team-arena/*``. Issue #3632,
docs/prd/2026-10-18-team-arena-prd.md §10.

Deliberately its own router/prefix (PRD independence rule, §7 "依賴方向"):
no write here ever touches ``live_quiz_*``/``pk_*``/``league_*``/
``escape_room_*`` tables.

authz note (every id in path/body is bound to the caller, never just "does
this id exist"):
  - code (path param)      -> engine._get_session_by_code 404s an
    unknown/ended code; every subsequent authz check is against the
    resolved session object, not the raw string.
  - classroom_id (body)    -> engine._require_classroom_owned_by (teacher
    create) / engine._require_classroom_membership (student join).
  - student_a_id/student_b_id/student_id (teams body) -> resolved via
    engine._get_member_by_student, which 404s if that id isn't actually a
    member of THIS session (not just any user id that happens to exist).
"""
from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, Path, Query
from sqlalchemy.orm import Session

from ..auth.dependencies import get_current_user
from ..database import get_db
from ..models.user import User
from ..schemas.team_arena import (
    TeamArenaAnswerRequest,
    TeamArenaControlRequest,
    TeamArenaLaneRequest,
    TeamArenaSessionCreateRequest,
    TeamArenaTeamsRequest,
)
from ..services.team_arena import engine

router = APIRouter(prefix="/team-arena", tags=["team-arena"])

Code = Annotated[str, Path(min_length=4, max_length=8)]


def _session_for(db: Session, code: str):
    return engine.get_session_by_code(db, code)


@router.post("/sessions", status_code=201)
def create_session(
    payload: TeamArenaSessionCreateRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    session = engine.create_session(
        db,
        current_user,
        classroom_id=payload.classroom_id,
        scope_type=payload.scope_type,
        scope_ref=payload.scope_ref,
        turns_per_player=payload.turns_per_player,
        answer_seconds=payload.answer_seconds,
        reading_speed=payload.reading_speed,
        story_pack_key=payload.story_pack_key,
    )
    return {"code": session.code, "status": session.status}


@router.post("/sessions/{code}/join", status_code=201)
def join_session(
    code: Code,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    session = engine.join_session(db, current_user, code)
    return {"code": session.code, "status": session.status}


@router.post("/sessions/{code}/teams")
def assign_teams(
    code: Code,
    payload: TeamArenaTeamsRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    session = _session_for(db, code)
    kwargs: dict = {"action": payload.action}
    if payload.action == "swap":
        kwargs["student_a_id"] = payload.student_a_id
        kwargs["student_b_id"] = payload.student_b_id
    elif payload.action == "override":
        kwargs["student_id"] = payload.student_id
        kwargs["grade_pool_override"] = payload.grade_pool_override
    engine.assign_teams(db, session, current_user, **kwargs)
    return {"status": "ok"}


@router.post("/sessions/{code}/lane")
def claim_lane(
    code: Code,
    payload: TeamArenaLaneRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    session = _session_for(db, code)
    engine.claim_lane(db, session, current_user, payload.lane)
    return {"status": "ok"}


@router.post("/sessions/{code}/control")
def control(
    code: Code,
    payload: TeamArenaControlRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    session = _session_for(db, code)
    session = engine.control(db, session, current_user, action=payload.action)
    return {"status": session.status, "turn_no": session.turn_no}


@router.get("/sessions/{code}/state")
def get_state(
    code: Code,
    after_version: int | None = Query(default=None),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    session = _session_for(db, code)
    state = engine.get_state(db, session, current_user)
    if after_version is not None and after_version == state["state_version"]:
        return {"state_version": state["state_version"], "unchanged": True}
    return state


@router.post("/sessions/{code}/answer")
def submit_answer(
    code: Code,
    payload: TeamArenaAnswerRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    session = _session_for(db, code)
    return engine.submit_answer(db, session, current_user, choice_key=payload.choice_key)


@router.get("/sessions/{code}/result")
def get_result(
    code: Code,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    session = _session_for(db, code)
    return engine.get_result(db, session, current_user)
