"""迷城密室 MVP 的 server-authoritative 遊戲引擎。"""
from __future__ import annotations

import random
from datetime import datetime, timezone

from fastapi import HTTPException
from sqlalchemy.orm import Session
from sqlalchemy.orm.attributes import flag_modified

from ...models.escape_room import EscapeRoomRun
from ...models.user import User
from ..game_core.scope import (
    ERR_EMPTY_POOL as _ERR_EMPTY_POOL,
    load_lessons_for_scope as _load_lessons_for_scope,
    resolve_pool_grade,  # noqa: F401 — re-exported: tests call `svc.resolve_pool_grade(...)`
    validate_scope,
)
from ..live_quiz.round_types import choice
from .story_adapter import DEFAULT_DIALOGUE, resolve_story_for_run

_MIST_STEP = 10
_TEAMMATES = ("bookworm", "lantern", "compass")
RUN_TIME_BUDGET_SECONDS = 600


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _iso_now() -> str:
    return _now().isoformat()


def _rounds(lessons: list[dict], sources: list[str]) -> list[dict]:
    rounds, _ = choice.generate_rounds(
        lessons, {"source_modules": sources, "question_count_mode": "all", "shuffle": True}, random.Random()
    )
    return rounds


def _persist(db: Session, run: EscapeRoomRun) -> None:
    for field in ("chambers_snapshot", "gate_snapshot", "teammates_state", "abilities_used"):
        flag_modified(run, field)
    db.commit()
    db.refresh(run)


def start_run(db: Session, student: User, scope_type: str, scope_ref: str) -> EscapeRoomRun:
    validate_scope(scope_type, scope_ref)
    lessons = _load_lessons_for_scope(scope_type, scope_ref)
    chamber_rounds = _rounds(lessons, ["vocab_definitions", "vocab_application", "zhuyin"])
    if len(chamber_rounds) < 8:
        raise HTTPException(status_code=400, detail=_ERR_EMPTY_POOL)
    gate_rounds = _rounds(lessons, ["comprehension"])
    if not gate_rounds:
        raise HTTPException(status_code=400, detail=_ERR_EMPTY_POOL)
    story = resolve_story_for_run(None)
    # Two questions per chamber guarantee an unambiguous "at least half" threshold.
    chambers = [
        {"index": index, "questions": chamber_rounds[index * 2:(index + 1) * 2],
         "current_question": 0, "correct_count": 0, "unlocked": False, "started_at": _iso_now()}
        for index in range(4)
    ]
    rescue_question = gate_rounds[1] if len(gate_rounds) >= 2 else gate_rounds[0]
    run = EscapeRoomRun(
        student_id=student.id,
        scope_type=scope_type,
        scope_ref=scope_ref,
        story_pack_key=story["key"],
        chapter_key="default",
        chambers_snapshot=chambers,
        gate_snapshot={"questions": [gate_rounds[0]], "rescue_question": rescue_question,
                       "answered": False, "started_at": _iso_now(), "last_event": "mist"},
        teammates_state=[{"slug": slug, "frozen": False, "frozen_at": None} for slug in _TEAMMATES],
        abilities_used={},
        result="in_progress",
    )
    db.add(run)
    db.commit()
    db.refresh(run)
    return run


def get_run_for_user(db: Session, run_id: int, user: User) -> EscapeRoomRun:
    run = db.query(EscapeRoomRun).filter(EscapeRoomRun.id == run_id).first()
    if run is None:
        raise HTTPException(status_code=404, detail="找不到這一局迷城密室")
    if run.student_id != user.id:
        raise HTTPException(status_code=403, detail="這一局迷城密室不屬於你")
    return run


def _safe_question(question: dict, chamber_index: int | None) -> dict:
    payload = question.get("payload", {})
    removed = set(payload.get("removed_choice_keys", []))
    return {
        "chamber_index": chamber_index,
        "stem": payload.get("stem", ""),
        "options": [
            {"key": option.get("key", ""), "text": option.get("text", "")}
            for option in payload.get("options", [])
            if option.get("key") not in removed
        ],
        "seconds": payload.get("seconds", 0),
        "extra_time_ms": payload.get("extra_time_ms", 0),
    }


def _set_last_event(run: EscapeRoomRun, event: str) -> None:
    run.gate_snapshot["last_event"] = event


def _maybe_expire(db: Session, run: EscapeRoomRun) -> None:
    if run.result != "in_progress":
        return
    started_at = run.started_at
    if started_at.tzinfo is None:
        started_at = started_at.replace(tzinfo=timezone.utc)
    if (_now() - started_at).total_seconds() > RUN_TIME_BUDGET_SECONDS:
        run.result = "not_this_time"
        run.completed_at = _now()
        _set_last_event(run, "not_this_time")
        _persist(db, run)


def _current_chamber(run: EscapeRoomRun) -> tuple[int, dict] | None:
    for index, chamber in enumerate(run.chambers_snapshot):
        if not chamber["unlocked"]:
            return index, chamber
    return None


def build_run_state(run: EscapeRoomRun) -> dict:
    current = _current_chamber(run) if run.result == "in_progress" else None
    current_question = None
    if current is not None:
        index, chamber = current
        current_question = _safe_question(chamber["questions"][chamber["current_question"]], index)
    rescue_question = None
    if run.result == "in_progress" and any(item["frozen"] for item in run.teammates_state):
        question = run.gate_snapshot.get("rescue_question")
        if question is not None:
            rescue_question = _safe_question(question, None)
    gate_question = None
    if run.result == "in_progress" and current is None:
        questions = run.gate_snapshot.get("questions", [])
        if questions:
            gate_question = _safe_question(questions[0], None)
    story = resolve_story_for_run(run.story_pack_key)
    used_abilities = [
        ability for ability in ("hint", "extra_time", "shield") if run.abilities_used.get(ability)
    ]
    last_event = run.gate_snapshot.get("last_event", "mist")
    return {
        "run_id": run.id,
        "status": run.result,
        "mist_distance": run.mist_distance,
        "unlocked_chambers": sum(bool(item["unlocked"]) for item in run.chambers_snapshot),
        "teammates": [
            {"slug": teammate["slug"], "frozen": bool(teammate["frozen"])}
            for teammate in run.teammates_state
        ],
        "abilities_used": used_abilities,
        "current_chamber": current_question,
        "rescue_question": rescue_question,
        "gate_question": gate_question,
        "story_intro": story["intro"],
        "mist_message": DEFAULT_DIALOGUE.get(last_event, DEFAULT_DIALOGUE["mist"]),
    }


def get_run_state(db: Session, run: EscapeRoomRun) -> dict:
    _maybe_expire(db, run)
    return build_run_state(run)


def _freeze_teammate(run: EscapeRoomRun) -> bool:
    if run.abilities_used.get("shield_active"):
        run.abilities_used["shield_active"] = False
        return False
    teammate = next((item for item in run.teammates_state if not item["frozen"]), None)
    if teammate is None:
        return False
    teammate["frozen"] = True
    teammate["frozen_at"] = _iso_now()
    return True


def _ensure_in_progress(db: Session, run: EscapeRoomRun) -> None:
    _maybe_expire(db, run)
    if run.result != "in_progress":
        raise HTTPException(status_code=409, detail="這一局已經結束了")


def answer_chamber(db: Session, run: EscapeRoomRun, user: User, chamber_index: int, choice_key: str) -> dict:
    _ensure_in_progress(db, run)
    if run.student_id != user.id:
        raise HTTPException(status_code=403, detail="這一局迷城密室不屬於你")
    if chamber_index < 0 or chamber_index >= len(run.chambers_snapshot):
        raise HTTPException(status_code=400, detail="找不到這座機關")
    next_index = next((i for i, item in enumerate(run.chambers_snapshot) if not item["unlocked"]), None)
    if next_index is None or chamber_index != next_index:
        raise HTTPException(status_code=409, detail="請依序解開機關")
    chamber = run.chambers_snapshot[chamber_index]
    question = chamber["questions"][chamber["current_question"]]
    correct = choice_key == question["payload"].get("correct_key")
    if correct:
        run.mist_distance = min(100, run.mist_distance + _MIST_STEP)
        chamber["correct_count"] += 1
        _set_last_event(run, "retreat")
    else:
        run.mist_distance = max(0, run.mist_distance - _MIST_STEP)
        if run.mist_distance == 0:
            _set_last_event(run, "rescue" if _freeze_teammate(run) else "mist")
        else:
            _set_last_event(run, "mist")
    chamber["current_question"] += 1
    if chamber["current_question"] >= len(chamber["questions"]):
        chamber["unlocked"] = chamber["correct_count"] >= (len(chamber["questions"]) + 1) // 2
        if not chamber["unlocked"]:
            chamber["current_question"] = 0
            chamber["correct_count"] = 0
    chamber["started_at"] = _iso_now()
    _persist(db, run)
    return build_run_state(run)


def use_rescue(db: Session, run: EscapeRoomRun, user: User, choice_key: str) -> dict:
    _ensure_in_progress(db, run)
    if run.student_id != user.id:
        raise HTTPException(status_code=403, detail="這一局迷城密室不屬於你")
    teammate = next((item for item in run.teammates_state if item["frozen"]), None)
    if teammate is None:
        raise HTTPException(status_code=409, detail="現在沒有需要救援的隊友")
    question = run.gate_snapshot.get("rescue_question")
    correct = bool(question) and choice_key == question["payload"].get("correct_key")
    if correct:
        teammate["frozen"] = False
        teammate["frozen_at"] = None
        run.mist_distance = min(100, run.mist_distance + _MIST_STEP)
        _set_last_event(run, "rescue")
    _persist(db, run)
    return build_run_state(run)


def answer_gate(db: Session, run: EscapeRoomRun, user: User, choice_key: str) -> dict:
    _ensure_in_progress(db, run)
    if run.student_id != user.id:
        raise HTTPException(status_code=403, detail="這一局迷城密室不屬於你")
    if not all(item["unlocked"] for item in run.chambers_snapshot):
        raise HTTPException(status_code=409, detail="四座機關都解開後才能前往大門")
    question = run.gate_snapshot["questions"][0]
    correct = choice_key == question["payload"].get("correct_key")
    run.gate_snapshot["answered"] = True
    if correct and not any(item["frozen"] for item in run.teammates_state):
        run.result = "escaped"
        run.completed_at = _now()
        _set_last_event(run, "escape")
    elif not correct:
        _set_last_event(run, "mist")
    _persist(db, run)
    return build_run_state(run)


def use_ability(db: Session, run: EscapeRoomRun, user: User, ability_key: str) -> dict:
    _ensure_in_progress(db, run)
    if run.student_id != user.id:
        raise HTTPException(status_code=403, detail="這一局迷城密室不屬於你")
    if ability_key not in {"hint", "extra_time", "shield"}:
        raise HTTPException(status_code=400, detail="找不到這張能力卡")
    if run.abilities_used.get(ability_key):
        raise HTTPException(status_code=409, detail="這張能力卡這一局已經用過了")
    run.abilities_used[ability_key] = True
    if ability_key == "hint":
        chamber = next((item for item in run.chambers_snapshot if not item["unlocked"]), None)
        question = (
            chamber["questions"][chamber["current_question"]]
            if chamber is not None
            else run.gate_snapshot["questions"][0]
        )
        wrong = next((option["key"] for option in question["payload"]["options"] if option["key"] != question["payload"]["correct_key"]), None) if question else None
        removed = [wrong] if wrong else []
        if question is not None:
            question["payload"]["removed_choice_keys"] = removed
    elif ability_key == "extra_time":
        chamber = next((item for item in run.chambers_snapshot if not item["unlocked"]), None)
        if chamber is not None:
            question = chamber["questions"][chamber["current_question"]]
            question["payload"]["extra_time_ms"] = 5000
        else:
            run.gate_snapshot["questions"][0]["payload"]["extra_time_ms"] = 5000
    else:
        run.abilities_used["shield_active"] = True
    _persist(db, run)
    return build_run_state(run)


def get_run_result(run: EscapeRoomRun, db: Session | None = None) -> dict:
    message_key = "escape" if run.result == "escaped" else run.result
    result = {
        "run_id": run.id,
        "result": run.result,
        "message": DEFAULT_DIALOGUE.get(message_key, DEFAULT_DIALOGUE["not_this_time"]),
        "unlocked_skins": [],
    }
    if db is not None:
        result["unlocked_skins"] = [
            {"story_pack_key": story_pack_key, "chapter_key": chapter_key}
            for story_pack_key, chapter_key in db.query(
            EscapeRoomRun.story_pack_key, EscapeRoomRun.chapter_key
        ).filter(
            EscapeRoomRun.student_id == run.student_id,
            EscapeRoomRun.result == "escaped",
        ).distinct().all()
        ]
    return result
