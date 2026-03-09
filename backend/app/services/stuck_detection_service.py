"""
Stuck-point detection and personalized learning recommendations (Issue #91).

Pure rule-based analysis — no AI calls, always fast.
"""
from datetime import datetime, timedelta, timezone

from sqlalchemy.orm import Session

from ..models.learning import LearningSession


def detect_stuck_points(student_id: int, db: Session) -> dict:
    """Detect learning stuck-points for a student.

    Analyzes sessions from the last 30 days:
    - story_stuck: stories attempted 3+ times without >=5% accuracy improvement
    - character_stuck: characters with 3+ errors across sessions
    - is_declining: True if last 3 sessions show strictly declining accuracy
    - accuracy_trend: list of accuracy values (oldest -> newest, last 10 sessions)
    """
    thirty_days_ago = datetime.now(timezone.utc) - timedelta(days=30)

    sessions = (
        db.query(LearningSession)
        .filter(
            LearningSession.student_id == student_id,
            LearningSession.started_at >= thirty_days_ago,
        )
        .order_by(LearningSession.started_at.asc())
        .all()
    )

    # Accuracy trend (last 10 sessions with scores)
    scored = [s for s in sessions if s.overall_score is not None]
    accuracy_trend = [s.overall_score for s in scored[-10:]]

    # Declining check
    is_declining = False
    if len(accuracy_trend) >= 3:
        last3 = accuracy_trend[-3:]
        is_declining = last3[0] > last3[1] > last3[2]

    # Story stuck: group by story_slug, find ones with 3+ attempts and no improvement
    story_attempts: dict[str, list] = {}
    for s in sessions:
        if s.story_slug:
            story_attempts.setdefault(s.story_slug, []).append(s)

    story_stuck = []
    for slug, attempts in story_attempts.items():
        if len(attempts) >= 3:
            scores = [a.overall_score for a in attempts if a.overall_score is not None]
            if scores:
                best = max(scores)
                first = scores[0] if scores[0] is not None else 0
                if best - first < 5:  # Less than 5% improvement
                    story_stuck.append({
                        "story_slug": slug,
                        "attempt_count": len(attempts),
                        "best_accuracy": best,
                        "last_attempt": attempts[-1].started_at.isoformat() if attempts[-1].started_at else "",
                    })

    return {
        "story_stuck": story_stuck,
        "character_stuck": [],  # TODO: implement when error_corrections table is populated
        "is_declining": is_declining,
        "accuracy_trend": accuracy_trend,
    }


def build_recommendations(stuck_data: dict) -> list[dict]:
    """Build personalized learning recommendations from stuck-point data."""
    recs = []

    if stuck_data["is_declining"]:
        recs.append({
            "type": "review",
            "title": "複習基礎",
            "description": "最近幾次練習成績持續下降，建議回到熟悉的課文重新練習。",
            "action": "review_basics",
        })

    for story in stuck_data.get("story_stuck", []):
        recs.append({
            "type": "retry",
            "title": f"重新挑戰「{story['story_slug']}」",
            "description": f"已嘗試 {story['attempt_count']} 次，最高正確率 {story['best_accuracy']:.0f}%。試試慢慢朗讀。",
            "action": f"retry:{story['story_slug']}",
        })

    for char in stuck_data.get("character_stuck", []):
        recs.append({
            "type": "practice",
            "title": f"加強練習「{char['character']}」",
            "description": f"這個字已經錯了 {char['error_count']} 次，多練幾次吧！",
            "action": f"practice:{char['character']}",
        })

    if not recs:
        recs.append({
            "type": "encouragement",
            "title": "繼續加油！",
            "description": "你的學習表現穩定，繼續保持！",
            "action": "continue",
        })

    return recs
