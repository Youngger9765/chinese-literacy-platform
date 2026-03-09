"""
Prediction Service — Issue #254: Predictive Learning Difficulty Detection.

Rule-based engine (no ML training required) that analyses early learning signals
to flag at-risk students for teacher early intervention.

Signals analysed:
  1. Low accuracy on first 2-3 stories (< 60%)
  2. High character error rate (> 30% unique chars with errors)
  3. Declining accuracy trend (3+ consecutive sessions falling)
  4. Low engagement — long gaps between sessions (> 14 days)
  5. Multiple stuck-points detected

Returns: risk_level (low/medium/high), risk_factors[], recommended_actions[],
         confidence_score (0-1), and supporting data.
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

# ── Thresholds ────────────────────────────────────────────────────────────────

EARLY_STORY_COUNT = 3          # "early" = first N distinct stories attempted
LOW_ACCURACY_THRESHOLD = 60.0  # below this in early stories = risk factor
HIGH_ERROR_RATE_THRESHOLD = 0.30  # unique chars with errors / total unique chars
DECLINING_SESSIONS = 3         # consecutive sessions with falling accuracy
INACTIVITY_DAYS = 14           # gap longer than this = low-engagement risk
STUCK_THRESHOLD = 2            # story-stuck count triggering a risk factor
LOOKBACK_DAYS = 60             # analysis window


# ── Public API ────────────────────────────────────────────────────────────────


def predict_learning_difficulty(student_id: int, db: "DbSession") -> dict:
    """Analyse early learning signals and return a risk prediction.

    Returns:
      {
        risk_level: "low" | "medium" | "high",
        risk_factors: list[str],
        recommended_actions: list[str],
        confidence_score: float,   # 0-1
        supporting_data: dict,
      }
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

    if not sessions:
        return _empty_prediction()

    risk_factors: list[str] = []
    recommended_actions: list[str] = []
    supporting: dict = {}

    # Signal 1 — low accuracy on first few stories
    early_accuracy = _check_early_accuracy(sessions)
    supporting["early_accuracy"] = early_accuracy
    if early_accuracy is not None and early_accuracy < LOW_ACCURACY_THRESHOLD:
        risk_factors.append(f"前期課文正確率偏低（{early_accuracy:.1f}%，低於 {LOW_ACCURACY_THRESHOLD:.0f}%）")
        recommended_actions.append("安排一對一朗讀指導，從較簡單的課文開始")

    # Signal 2 — high character error rate
    error_rate = _check_character_error_rate(student_id, sessions, db)
    supporting["character_error_rate"] = error_rate
    if error_rate is not None and error_rate > HIGH_ERROR_RATE_THRESHOLD:
        risk_factors.append(f"生字錯誤率偏高（{error_rate:.0%}）")
        recommended_actions.append("加強生字筆順練習，可配合詞典查詢例句")

    # Signal 3 — declining accuracy trend
    trend_data = _check_declining_trend(sessions)
    supporting["accuracy_trend"] = trend_data["trend"]
    supporting["is_declining"] = trend_data["is_declining"]
    if trend_data["is_declining"]:
        risk_factors.append("近期朗讀正確率持續下滑")
        recommended_actions.append("放慢練習節奏，逐句跟讀，避免趕進度")

    # Signal 4 — low engagement (inactivity)
    gap_days = _check_engagement_gap(sessions)
    supporting["max_inactivity_days"] = gap_days
    if gap_days is not None and gap_days > INACTIVITY_DAYS:
        risk_factors.append(f"練習頻率偏低（最長間隔 {gap_days} 天未練習）")
        recommended_actions.append("設定固定練習提醒，建議每周至少練習 3 次")

    # Signal 5 — multiple stuck-points
    stuck_count = _check_stuck_count(sessions)
    supporting["stuck_story_count"] = stuck_count
    if stuck_count >= STUCK_THRESHOLD:
        risk_factors.append(f"多篇課文反覆練習仍無進步（{stuck_count} 篇）")
        recommended_actions.append("針對卡關課文安排聽範讀後再跟讀，或請教師示範")

    # Deduplicate recommended_actions while preserving order
    seen: set[str] = set()
    unique_actions: list[str] = []
    for a in recommended_actions:
        if a not in seen:
            seen.add(a)
            unique_actions.append(a)

    risk_level, confidence = _compute_risk_level(risk_factors, sessions)

    return {
        "risk_level": risk_level,
        "risk_factors": risk_factors,
        "recommended_actions": unique_actions,
        "confidence_score": confidence,
        "supporting_data": supporting,
    }


# ── Internal helpers ──────────────────────────────────────────────────────────


def _empty_prediction() -> dict:
    return {
        "risk_level": "low",
        "risk_factors": [],
        "recommended_actions": [],
        "confidence_score": 0.0,
        "supporting_data": {"note": "無足夠練習紀錄"},
    }


def _check_early_accuracy(sessions: list[LearningSession]) -> float | None:
    """Average accuracy across the first EARLY_STORY_COUNT distinct stories."""
    seen_stories: set[str] = set()
    early_accuracies: list[float] = []

    for s in sessions:
        if s.story_slug and s.story_slug not in seen_stories:
            seen_stories.add(s.story_slug)
        if s.accuracy is not None:
            early_accuracies.append(s.accuracy)
        if len(seen_stories) >= EARLY_STORY_COUNT:
            break

    if not early_accuracies:
        return None
    return sum(early_accuracies) / len(early_accuracies)


def _check_character_error_rate(
    student_id: int,
    sessions: list[LearningSession],
    db: "DbSession",
) -> float | None:
    """Ratio of unique characters with errors to total unique characters seen."""
    session_ids = [s.id for s in sessions]
    if not session_ids:
        return None

    from sqlalchemy import func as sa_func

    error_chars = set(
        row.character
        for row in db.query(CharacterError.character)
        .filter(CharacterError.session_id.in_(session_ids))
        .distinct()
        .all()
    )

    # Gather unique characters from reading_result across sessions
    all_chars: set[str] = set()
    for s in sessions:
        if s.reading_result and isinstance(s.reading_result, dict):
            transcript = s.reading_result.get("transcript", "")
            if isinstance(transcript, str):
                for ch in transcript:
                    if "\u4e00" <= ch <= "\u9fff":  # CJK range
                        all_chars.add(ch)

    if not all_chars:
        # Fall back: use error count / sessions ratio proxy
        if not sessions:
            return None
        total_errors = (
            db.query(sa_func.count(CharacterError.id))
            .filter(CharacterError.session_id.in_(session_ids))
            .scalar()
            or 0
        )
        return min(total_errors / (len(sessions) * 20), 1.0)  # 20 chars/session estimate

    return len(error_chars) / len(all_chars) if all_chars else None


def _check_declining_trend(sessions: list[LearningSession]) -> dict:
    """Detect strict declining accuracy over last DECLINING_SESSIONS sessions."""
    recent = [s.accuracy for s in sessions if s.accuracy is not None][-10:]
    is_declining = False
    if len(recent) >= DECLINING_SESSIONS:
        last_n = recent[-DECLINING_SESSIONS:]
        is_declining = all(last_n[i] > last_n[i + 1] for i in range(len(last_n) - 1))
    return {"trend": recent, "is_declining": is_declining}


def _check_engagement_gap(sessions: list[LearningSession]) -> int | None:
    """Largest gap in days between consecutive sessions."""
    if len(sessions) < 2:
        return None
    dates = [s.started_at for s in sessions]
    gaps = [(dates[i + 1] - dates[i]).days for i in range(len(dates) - 1)]
    return max(gaps) if gaps else None


def _check_stuck_count(sessions: list[LearningSession]) -> int:
    """Count stories where student attempted 3+ times with < 5% improvement."""
    story_groups: dict[str, list[float]] = defaultdict(list)
    for s in sessions:
        if s.story_slug and s.accuracy is not None:
            story_groups[s.story_slug].append(s.accuracy)

    stuck = 0
    for accuracies in story_groups.values():
        if len(accuracies) < 3:
            continue
        first_half = max(accuracies[: len(accuracies) // 2 or 1])
        second_half = max(accuracies[len(accuracies) // 2 :])
        if second_half - first_half < 5.0:
            stuck += 1
    return stuck


def _compute_risk_level(
    risk_factors: list[str],
    sessions: list[LearningSession],
) -> tuple[str, float]:
    """Map risk factor count to level and confidence score."""
    factor_count = len(risk_factors)
    session_count = len(sessions)

    # Confidence grows with session count (more data = more reliable)
    data_confidence = min(session_count / 5.0, 1.0)  # saturates at 5 sessions

    if factor_count == 0:
        return "low", round(0.3 * data_confidence, 2)
    elif factor_count == 1:
        return "low", round(0.5 * data_confidence, 2)
    elif factor_count == 2:
        return "medium", round(0.65 * data_confidence, 2)
    elif factor_count == 3:
        return "medium", round(0.75 * data_confidence, 2)
    else:
        return "high", round(min(0.85 * data_confidence, 0.9), 2)
