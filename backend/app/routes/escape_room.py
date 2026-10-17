"""迷城密室 API — ``/api/escape-room/*``。"""
from __future__ import annotations

from pydantic import BaseModel
from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from ..auth.dependencies import get_current_user
from ..database import get_db
from ..models.escape_room import EscapeRoomRun
from ..models.user import User
from ..services.escape_room import engine

router = APIRouter(prefix="/escape-room", tags=["escape-room"])


class StartRunRequest(BaseModel):
    scope_type: str
    scope_ref: str


class AnswerRequest(BaseModel):
    chamber_index: int
    choice_key: str


class GateAnswerRequest(BaseModel):
    choice_key: str


class RescueRequest(BaseModel):
    choice_key: str


class UseAbilityRequest(BaseModel):
    ability_key: str


@router.post("/runs", status_code=201)
def start_run(
    payload: StartRunRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    run = engine.start_run(db, current_user, payload.scope_type, payload.scope_ref)
    return {"run_id": run.id}


@router.get("/runs/{run_id}/state")
def get_run_state(
    run_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    run = engine.get_run_for_user(db, run_id, current_user)
    return engine.get_run_state(db, run)


@router.post("/runs/{run_id}/answer")
def answer_chamber(
    run_id: int,
    payload: AnswerRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    run = engine.get_run_for_user(db, run_id, current_user)
    return engine.answer_chamber(db, run, current_user, payload.chamber_index, payload.choice_key)


@router.post("/runs/{run_id}/gate-answer")
def answer_gate(
    run_id: int,
    payload: GateAnswerRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    run = engine.get_run_for_user(db, run_id, current_user)
    return engine.answer_gate(db, run, current_user, payload.choice_key)


@router.post("/runs/{run_id}/rescue")
def use_rescue(
    run_id: int,
    payload: RescueRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    run = engine.get_run_for_user(db, run_id, current_user)
    return engine.use_rescue(db, run, current_user, payload.choice_key)


@router.post("/runs/{run_id}/use-ability")
def use_ability(
    run_id: int,
    payload: UseAbilityRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    run = engine.get_run_for_user(db, run_id, current_user)
    return engine.use_ability(db, run, current_user, payload.ability_key)


@router.get("/runs/{run_id}/result")
def get_run_result(
    run_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    run = engine.get_run_for_user(db, run_id, current_user)
    return engine.get_run_result(run, db)


@router.get("/unlocks")
def get_unlocks(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    unlocks = db.query(EscapeRoomRun.story_pack_key, EscapeRoomRun.chapter_key).filter(
        EscapeRoomRun.student_id == current_user.id,
        EscapeRoomRun.result == "escaped",
    ).distinct().all()
    return {
        "unlocks": [
            {"story_pack_key": story_pack_key, "chapter_key": chapter_key}
            for story_pack_key, chapter_key in unlocks
        ]
    }
