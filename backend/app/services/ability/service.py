"""能力估計（#4164）的資料接線：從 McqAttempt 取每題第一次作答，校準題目、估計單一學生。

資料不足時誠實回「估計中」，不硬給等級。
"""

from __future__ import annotations

import time

from sqlalchemy import func
from sqlalchemy.orm import Session

from ...models.mcq_attempt import McqAttempt
from .rasch import (
    LEVEL_LABELS,
    calibrate_items,
    grade_prior,
    level_for,
    precision_hint,
    update_ability,
)

MIN_ITEM_RESPONSES = 30
# 題目難度全站共用，不必每次請求都重算；10 分鐘內共用同一份校準
CALIBRATION_TTL_SECONDS = 600
READY_MAX_SD = 0.6
READY_MIN_LESSONS = 3
_cache: dict = {"at": 0.0, "value": None}


def reset_calibration_cache() -> None:
    _cache["at"] = 0.0
    _cache["value"] = None


def _calibration(db: Session):
    now = time.monotonic()
    if _cache["value"] is None or now - _cache["at"] > CALIBRATION_TTL_SECONDS:
        _cache["value"] = calibrate_items(first_attempts(db), min_n=MIN_ITEM_RESPONSES)
        _cache["at"] = now
    return _cache["value"]


def first_attempts(db: Session, user_id: int | None = None) -> list[tuple[str, str, bool]]:
    """每位學生每題只取第一筆作答（id 最小的那筆）。回 (學生, 題目, 是否答對)。"""
    first_ids = db.query(func.min(McqAttempt.id)).group_by(McqAttempt.user_id, McqAttempt.lesson_id, McqAttempt.question_id)
    q = db.query(McqAttempt.user_id, McqAttempt.lesson_id, McqAttempt.question_id, McqAttempt.is_correct).filter(
        McqAttempt.id.in_(first_ids.scalar_subquery())
    )
    if user_id is not None:
        q = q.filter(McqAttempt.user_id == user_id)
    return [(str(u), f"{lesson}:{qid}", bool(ok)) for u, lesson, qid, ok in q.all()]


def estimate_for_user(db: Session, user_id: int, grade: int | None) -> dict:
    calibration = _calibration(db)
    mine = first_attempts(db, user_id)
    scored = [(calibration[item].difficulty, ok) for _, item, ok in mine if item in calibration]
    lessons_done = len({item.split(":", 1)[0] for _, item, _ in mine})
    prior = grade_prior(grade if grade else 4)
    est = update_ability(prior.mean, prior.sd, scored)
    # 只答一兩題時等級幾乎全來自年級起始值，不給等級
    ready = len(scored) > 0 and (est.sd <= READY_MAX_SD or lessons_done >= READY_MIN_LESSONS)
    return {
        "calibrated_items": len(calibration),
        "scored_answers": len(scored),
        "lessons_done": lessons_done,
        "ready": ready,
        "level": level_for(est.mean) if ready else None,
        "level_label": LEVEL_LABELS[level_for(est.mean) - 1] if ready else None,
        "theta": round(est.mean, 2) if ready else None,
        "sd": round(est.sd, 2),
        "hint": precision_hint(lessons_done, est.sd),
        "disclaimer": "這是參考 PISA 分級的自家等級，題目難度以本平台作答資料估計，尚未做外部對照",
    }
