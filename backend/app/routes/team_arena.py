"""多人對抗賽 API — ``/api/team-arena/*``. v2, issue #3632,
docs/prd/2026-10-18-team-arena-prd.md §0 "⭐ v2 改版".

Deliberately its own router/prefix (PRD independence rule, §7 "依賴方向"):
no write here ever touches ``live_quiz_*``/``pk_*``/``league_*``/
``escape_room_*`` tables.

authz note (every id in path/body is bound to the caller, never just "does
this id exist"):
  - code (path param) -> engine._get_session_by_code 404s an unknown/ended
    code; every subsequent authz check is against the resolved session
    object, not the raw string.
  - Host-only actions (control) check `session.teacher_id == current_user.id`
    inside the engine itself (engine.control) — there is no classroom to
    delegate ownership to in v2.
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
    TeamArenaJoinRequest,
    TeamArenaSessionCreateRequest,
    TeamArenaSuggestRequest,
    TeamArenaWeaponRequest,
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
        team_size=payload.team_size,
        turns_per_player=payload.turns_per_player,
        answer_seconds=payload.answer_seconds,
        story_pack_key=payload.story_pack_key,
        side=payload.side,
    )
    return {"code": session.code, "status": session.status}


@router.post("/sessions/{code}/join", status_code=201)
def join_session(
    code: Code,
    payload: TeamArenaJoinRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    session = engine.join_session(db, current_user, code, side=payload.side)
    return {"code": session.code, "status": session.status}


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
    # Options open on the clock (reading_seconds after the turn starts), which
    # never bumps state_version — so a client polling with after_version got
    # "unchanged" and stayed on 「請先仔細讀題目」 for the whole answer window
    # (staging QA 2026-10-20: options open at ~6 s, screen updated at ~26 s).
    # Fold "are my options open" into the version the client echoes back.
    own_round = (state.get("own_match") or {}).get("current_round") or {}
    state["state_version"] = state["state_version"] * 2 + (1 if own_round.get("options") else 0)
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


@router.post("/sessions/{code}/weapons")
def use_weapon(
    code: Code,
    payload: TeamArenaWeaponRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    session = _session_for(db, code)
    return engine.use_weapon(db, session, current_user, weapon=payload.weapon)


@router.post("/sessions/{code}/suggest")
def submit_suggestion(
    code: Code,
    payload: TeamArenaSuggestRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    session = _session_for(db, code)
    return engine.submit_suggestion(db, session, current_user, choice_key=payload.choice_key)


@router.get("/sessions/{code}/result")
def get_result(
    code: Code,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    session = _session_for(db, code)
    return engine.get_result(db, session, current_user)
