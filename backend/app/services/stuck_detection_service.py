"""
Stuck-point detection service — Issue #91.

Analyses LearningSession records to identify students who are struggling:
  - Same story attempted 3+ times with no accuracy improvement → stuck
  - Accuracy declining over consecutive attempts → struggling
  - Character with 3+ errors across sessions → character stuck-point

No DB writes here — pure read-only analysis returning plain dicts.
"""

from __future__ import annotations

import logging
from collections import defaultdict
from datetime import datetime, timedelta, timezone
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from sqlalchemy.orm import Session as DbSession

from ..models.session import CharacterError, LearningSession

logger = logging.getLogger(__name__)

# Thresholds (PRD: same character error ≥ 3 times)
STUCK_ATTEMPT_THRESHOLD = 3      # same story attempts before "stuck"
CHARACTER_ERROR_THRESHOLD = 3    # cross-session errors to flag a character
ACCURACY_DECLINE_SESSIONS = 3    # consecutive sessions showing decline
LOOKBACK_DAYS = 30               # only look at last 30 days


def detect_stuck_points(student_id: int, db: "DbSession") -> dict:
    """Detect a student's current learning stuck-points.

    Returns a dict with:
      - story_stuck: list of {story_slug, attempt_count, best_accuracy, last_attempt}
      - character_stuck: list of {character, error_count, last_error_date}
      - is_declining: bool — whether recent accuracy is declining
      - accuracy_trend: list of floats (most-recent sessions, ascending date)
    """
    cutoff = datetime.now(timezone.utc) - timedelta(days=LOOKBACK_DAYS)

    sessions = (
        db.query(LearningSession)
        .filter(
            LearningSession.student_id == student_id,
            LearningSession.started_at >= cutoff,
        )
        .order_by(LearningSession.started_at.asc())
        .all()
    )

    # --- Story stuck ---
    story_groups: dict[str, list[LearningSession]] = defaultdict(list)
    for s in sessions:
        if s.story_slug:
            story_groups[s.story_slug].append(s)

    story_stuck = []
    for slug, attempts in story_groups.items():
        if len(attempts) < STUCK_ATTEMPT_THRESHOLD:
            continue
        # Check if there is no meaningful improvement (best accuracy in first half
        # vs best accuracy in second half — improvement < 5%)
        accuracies = [a.accuracy for a in attempts if a.accuracy is not None]
        if len(accuracies) < STUCK_ATTEMPT_THRESHOLD:
            continue
        best_accuracy = max(accuracies)
        first_half_best = max(accuracies[: len(accuracies) // 2 or 1])
        second_half_best = max(accuracies[len(accuracies) // 2:])
        improvement = second_half_best - first_half_best
        if improvement < 5.0:  # less than 5% improvement = stuck
            last = attempts[-1]
            story_stuck.append({
                "story_slug": slug,
                "attempt_count": len(attempts),
                "best_accuracy": round(best_accuracy, 1),
                "last_attempt": last.started_at.isoformat(),
            })

    # --- Character stuck ---
    session_ids = [s.id for s in sessions]
    character_stuck = []
    if session_ids:
        from sqlalchemy import func as sa_func
        rows = (
            db.query(
                CharacterError.character,
                sa_func.count(CharacterError.id).label("error_count"),
                sa_func.max(LearningSession.started_at).label("last_error_date"),
            )
            .join(LearningSession, CharacterError.session_id == LearningSession.id)
            .filter(
                LearningSession.student_id == student_id,
                LearningSession.started_at >= cutoff,
            )
            .group_by(CharacterError.character)
            .having(sa_func.count(CharacterError.id) >= CHARACTER_ERROR_THRESHOLD)
            .order_by(sa_func.count(CharacterError.id).desc())
            .all()
        )
        for row in rows:
            character_stuck.append({
                "character": row.character,
                "error_count": row.error_count,
                "last_error_date": row.last_error_date.isoformat() if row.last_error_date else None,
            })

    # --- Accuracy trend / declining ---
    recent_sessions = [s for s in sessions if s.accuracy is not None][-10:]
    accuracy_trend = [round(s.accuracy, 1) for s in recent_sessions]
    is_declining = False
    if len(accuracy_trend) >= ACCURACY_DECLINE_SESSIONS:
        last_n = accuracy_trend[-ACCURACY_DECLINE_SESSIONS:]
        # strictly declining
        is_declining = all(
            last_n[i] > last_n[i + 1] for i in range(len(last_n) - 1)
        )

    return {
        "story_stuck": story_stuck,
        "character_stuck": character_stuck,
        "is_declining": is_declining,
        "accuracy_trend": accuracy_trend,
    }


def build_recommendations(stuck_data: dict) -> list[dict]:
    """Build actionable recommendations from stuck-point data.

    Returns list of {type, title, description, action}.
    No AI call — rule-based, instant, always available.
    """
    recs: list[dict] = []

    if stuck_data["is_declining"]:
        recs.append({
            "type": "declining",
            "title": "朗讀正確率下滑",
            "description": "最近幾次練習的正確率有下滑趨勢，建議放慢速度，逐句練習。",
            "action": "重新朗讀課文",
        })

    for story in stuck_data["story_stuck"][:3]:
        recs.append({
            "type": "story_stuck",
            "title": f"這篇課文需要多練習",
            "description": (
                f"你已嘗試 {story['attempt_count']} 次，"
                f"最高正確率 {story['best_accuracy']}%。"
                "試著先聽一遍範讀，再跟著朗讀。"
            ),
            "action": "聽範讀",
        })

    for char_info in stuck_data["character_stuck"][:5]:
        recs.append({
            "type": "character_stuck",
            "title": f"生字「{char_info['character']}」需要加強",
            "description": (
                f"這個字在多次練習中錯了 {char_info['error_count']} 次。"
                "建議練習筆順、查詞典例句，或請老師示範發音。"
            ),
            "action": "練習生字",
        })

    if not recs:
        recs.append({
            "type": "encouragement",
            "title": "你表現得很好！",
            "description": "目前沒有發現卡點，繼續保持練習習慣，進步會越來越明顯。",
            "action": "繼續學習",
        })

    return recs
