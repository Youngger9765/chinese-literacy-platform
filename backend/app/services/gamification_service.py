"""Gamification service: award XP, check badges, update streaks.

Called from learning routes after a session is completed. Handles:
  - Awarding XP for various events
  - Checking and unlocking achievement badges
  - Updating daily streak counters
"""
from __future__ import annotations

import logging
from datetime import date, datetime, timezone

from sqlalchemy import func as sqlfunc
from sqlalchemy.orm import Session

from ..models.gamification import (
    BADGE_CATALOGUE,
    XP_REWARDS,
    StudentBadge,
    StudentStreak,
    StudentXPLog,
    level_progress,
    xp_to_level,
)
from ..models.school import Classroom, ClassroomStudent
from .learning_stats_service import get_completed_story_count

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------


def _get_total_xp(db: Session, student_id: int) -> int:
    """Return the student's cumulative XP using a DB-side aggregate."""
    result = (
        db.query(sqlfunc.coalesce(sqlfunc.sum(StudentXPLog.xp_earned), 0))
        .filter(StudentXPLog.student_id == student_id)
        .scalar()
    )
    return int(result)


def _get_stories_completed(db: Session, student_id: int) -> int:
    """Return the number of distinct completed stories for a student.

    Delegates to the canonical shared helper so that gamification, dashboard,
    and progress endpoints all report the same value (Issue #981).
    """
    return get_completed_story_count(db, student_id)


def _get_or_create_streak(db: Session, student_id: int) -> StudentStreak:
    streak = db.query(StudentStreak).filter(StudentStreak.student_id == student_id).first()
    if streak is None:
        streak = StudentStreak(student_id=student_id)
        db.add(streak)
        db.flush()
    return streak


def _get_unlocked_badge_keys(db: Session, student_id: int) -> set[str]:
    rows = db.query(StudentBadge.badge_key).filter(StudentBadge.student_id == student_id).all()
    return {r.badge_key for r in rows}


def _award_badge(db: Session, student_id: int, badge_key: str) -> StudentBadge | None:
    """Award a badge if not already unlocked. Returns the new row or None."""
    existing = (
        db.query(StudentBadge)
        .filter(
            StudentBadge.student_id == student_id,
            StudentBadge.badge_key == badge_key,
        )
        .first()
    )
    if existing:
        return None
    badge = StudentBadge(student_id=student_id, badge_key=badge_key)
    db.add(badge)
    logger.info("Badge unlocked: student=%d badge=%s", student_id, badge_key)
    return badge


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------


def award_xp(
    db: Session,
    student_id: int,
    event_type: str,
    session_id: int | None = None,
    note: str | None = None,
    xp_override: int | None = None,
) -> StudentXPLog:
    """Award XP to a student for an event. Returns the log row."""
    xp = xp_override if xp_override is not None else XP_REWARDS.get(event_type, 0)
    if xp <= 0:
        raise ValueError(f"No XP configured for event_type={event_type!r}")

    log = StudentXPLog(
        student_id=student_id,
        event_type=event_type,
        xp_earned=xp,
        session_id=session_id,
        note=note or event_type,
    )
    db.add(log)
    db.flush()
    logger.info("XP awarded: student=%d event=%s xp=%d", student_id, event_type, xp)
    return log


def update_streak(db: Session, student_id: int, activity_date: date | None = None) -> StudentStreak:
    """Update a student's daily streak. Call once per session completion."""
    today = activity_date or datetime.now(timezone.utc).date()
    streak = _get_or_create_streak(db, student_id)

    if streak.last_activity_date is None:
        # First ever activity
        streak.current_streak = 1
        streak.longest_streak = 1
        streak.last_activity_date = datetime.combine(today, datetime.min.time()).replace(tzinfo=timezone.utc)
    else:
        last_date = streak.last_activity_date
        if hasattr(last_date, "date"):
            last_date = last_date.date()

        delta = (today - last_date).days
        if delta == 0:
            # Same day — no change
            pass
        elif delta == 1:
            # Consecutive day
            streak.current_streak += 1
            streak.longest_streak = max(streak.longest_streak, streak.current_streak)
            streak.last_activity_date = datetime.combine(today, datetime.min.time()).replace(tzinfo=timezone.utc)
        else:
            # Gap — reset
            streak.current_streak = 1
            streak.last_activity_date = datetime.combine(today, datetime.min.time()).replace(tzinfo=timezone.utc)

    db.flush()
    return streak


def check_and_award_badges(
    db: Session,
    student_id: int,
    session_id: int | None = None,
    reading_accuracy: float | None = None,
) -> list[str]:
    """Check all badge conditions for a student and unlock any newly earned ones.

    Returns list of newly unlocked badge keys.
    """
    total_xp = _get_total_xp(db, student_id)
    stories_completed = _get_stories_completed(db, student_id)
    level = xp_to_level(total_xp)
    streak = _get_or_create_streak(db, student_id)
    unlocked = _get_unlocked_badge_keys(db, student_id)
    newly_unlocked: list[str] = []

    def _try(badge_key: str, condition: bool) -> None:
        if condition and badge_key not in unlocked and badge_key in BADGE_CATALOGUE:
            row = _award_badge(db, student_id, badge_key)
            if row:
                newly_unlocked.append(badge_key)

    # First session badge (B1 fix: triggers on first story completion)
    _try("first_session", stories_completed >= 1)

    # Story completion badges
    _try("first_story", stories_completed >= 1)
    _try("story_5", stories_completed >= 5)
    _try("story_10", stories_completed >= 10)
    _try("story_25", stories_completed >= 25)

    # Streak badges
    _try("streak_3", streak.current_streak >= 3)
    _try("streak_7", streak.current_streak >= 7)
    _try("streak_30", streak.current_streak >= 30)

    # Hidden: perfect_week — longest streak >= 7 days
    _try("perfect_week", streak.longest_streak >= 7)

    # Accuracy badges
    if reading_accuracy is not None:
        _try("accuracy_90", reading_accuracy >= 90.0)
        _try("accuracy_100", reading_accuracy >= 100.0)

    # Level badges
    _try("level_5", level >= 5)
    _try("level_10", level >= 10)

    # XP milestone badges
    _try("xp_500", total_xp >= 500)
    _try("xp_1000", total_xp >= 1000)

    # Hidden: explorer — 10+ distinct event types in XP log
    distinct_event_count = (
        db.query(sqlfunc.count(sqlfunc.distinct(StudentXPLog.event_type)))
        .filter(StudentXPLog.student_id == student_id)
        .scalar()
    )
    _try("explorer", (distinct_event_count or 0) >= 10)

    return newly_unlocked


def process_session_completion(
    db: Session,
    student_id: int,
    session_id: int,
    reading_accuracy: float | None = None,
    comprehension_passed: bool = False,
    activity_date: date | None = None,
) -> dict:
    """Main entry point: called when a learning session is fully completed.

    Awards XP, updates streak, checks badges, commits all changes.
    Returns a summary dict with XP earned, badges unlocked, and level info.
    """
    # --- Idempotency check (B2): skip if this session already awarded XP ---
    existing_logs = (
        db.query(StudentXPLog)
        .filter(StudentXPLog.session_id == session_id)
        .first()
    )
    if existing_logs is not None:
        # Already processed — return existing summary without awarding again
        total_xp = _get_total_xp(db, student_id)
        lv_info = level_progress(total_xp)
        streak = _get_or_create_streak(db, student_id)
        all_session_logs = (
            db.query(StudentXPLog)
            .filter(StudentXPLog.session_id == session_id)
            .all()
        )
        logger.info(
            "Session %d already processed for student %d — returning cached summary",
            session_id,
            student_id,
        )
        return {
            "xp_earned": sum(l.xp_earned for l in all_session_logs),
            "xp_breakdown": [
                {"event_type": l.event_type, "xp": l.xp_earned, "note": l.note}
                for l in all_session_logs
            ],
            "new_total_xp": total_xp,
            "level_info": lv_info,
            "streak": {
                "current": streak.current_streak,
                "longest": streak.longest_streak,
            },
            "badges_unlocked": [],
            "notes": ["（已處理，不重複計算）"],
        }

    xp_earned: list[StudentXPLog] = []
    notes: list[str] = []

    # --- Base session XP ---
    total_xp_before = _get_total_xp(db, student_id)
    is_first_story = total_xp_before == 0

    log = award_xp(db, student_id, "session_complete", session_id=session_id, note="完成課文學習")
    xp_earned.append(log)

    # --- First story bonus ---
    if is_first_story:
        log2 = award_xp(db, student_id, "first_story", session_id=session_id, note="第一篇故事完成！")
        xp_earned.append(log2)
        notes.append("第一篇故事加分！")

    # --- Accuracy bonuses ---
    if reading_accuracy is not None:
        if reading_accuracy >= 90.0:
            log3 = award_xp(db, student_id, "accuracy_90", session_id=session_id, note=f"朗讀準確度 {reading_accuracy:.0f}%")
            xp_earned.append(log3)
        elif reading_accuracy >= 70.0:
            log4 = award_xp(db, student_id, "accuracy_70", session_id=session_id, note=f"朗讀準確度 {reading_accuracy:.0f}%")
            xp_earned.append(log4)

    # --- Comprehension bonus ---
    if comprehension_passed:
        log5 = award_xp(db, student_id, "comprehension_pass", session_id=session_id, note="理解測驗通過")
        xp_earned.append(log5)

    # --- Update streak ---
    streak = update_streak(db, student_id, activity_date=activity_date)

    # --- Streak daily bonus ---
    if streak.current_streak > 1:
        log6 = award_xp(db, student_id, "streak_bonus", session_id=session_id, note=f"連續學習 {streak.current_streak} 天")
        xp_earned.append(log6)

    # --- Compute new totals ---
    new_total_xp = total_xp_before + sum(l.xp_earned for l in xp_earned)
    lv_info = level_progress(new_total_xp)

    # --- Check badges ---
    newly_unlocked = check_and_award_badges(
        db, student_id, session_id=session_id, reading_accuracy=reading_accuracy
    )

    db.commit()

    total_xp_this_session = sum(l.xp_earned for l in xp_earned)
    logger.info(
        "Session completion processed: student=%d session=%d xp_gained=%d new_total=%d badges=%s",
        student_id,
        session_id,
        total_xp_this_session,
        new_total_xp,
        newly_unlocked,
    )

    return {
        "xp_earned": total_xp_this_session,
        "xp_breakdown": [
            {"event_type": l.event_type, "xp": l.xp_earned, "note": l.note}
            for l in xp_earned
        ],
        "new_total_xp": new_total_xp,
        "level_info": lv_info,
        "streak": {
            "current": streak.current_streak,
            "longest": streak.longest_streak,
        },
        "badges_unlocked": newly_unlocked,
        "notes": notes,
    }


# ---------------------------------------------------------------------------
# Query helpers used by the API routes
# ---------------------------------------------------------------------------


def get_student_summary(db: Session, student_id: int) -> dict:
    """Return full gamification summary for a student."""
    total_xp = _get_total_xp(db, student_id)
    stories_completed = _get_stories_completed(db, student_id)
    lv_info = level_progress(total_xp)

    streak = _get_or_create_streak(db, student_id)
    db.flush()

    badges = (
        db.query(StudentBadge)
        .filter(StudentBadge.student_id == student_id)
        .order_by(StudentBadge.unlocked_at)
        .all()
    )
    badge_list = []
    for b in badges:
        info = BADGE_CATALOGUE.get(b.badge_key, {})
        badge_list.append(
            {
                "key": b.badge_key,
                "name": info.get("name", b.badge_key),
                "description": info.get("description", ""),
                "icon": info.get("icon", "award"),
                "color": info.get("color", "gray"),
                "unlocked_at": b.unlocked_at.isoformat(),
            }
        )

    return {
        "student_id": student_id,
        "total_xp": total_xp,
        "stories_completed": stories_completed,
        "level_info": lv_info,
        "streak": {
            "current": streak.current_streak,
            "longest": streak.longest_streak,
            "last_activity_date": (
                (streak.last_activity_date.date().isoformat() if isinstance(streak.last_activity_date, datetime) else streak.last_activity_date.isoformat())
                if streak.last_activity_date
                else None
            ),
        },
        "badges": badge_list,
        "all_badges": [
            {
                "key": key,
                "name": info["name"],
                "description": info["description"],
                "icon": info["icon"],
                "color": info["color"],
                "unlocked": key in {b["key"] for b in badge_list},
            }
            for key, info in BADGE_CATALOGUE.items()
            if not info.get("hidden") or key in {b["key"] for b in badge_list}
        ],
    }


def get_classroom_leaderboard(db: Session, classroom_id: int, limit: int = 10) -> list[dict]:
    """Return top N students in a classroom ranked by total XP."""
    from ..models.user import User

    # Get all student IDs in classroom
    student_ids = [
        row.student_id
        for row in db.query(ClassroomStudent.student_id)
        .filter(ClassroomStudent.classroom_id == classroom_id)
        .all()
    ]
    if not student_ids:
        return []

    # Aggregate XP per student
    xp_rows = (
        db.query(
            StudentXPLog.student_id,
            sqlfunc.sum(StudentXPLog.xp_earned).label("total_xp"),
            sqlfunc.count(StudentXPLog.id).filter(
                StudentXPLog.event_type == "session_complete"
            ).label("stories"),
        )
        .filter(StudentXPLog.student_id.in_(student_ids))
        .group_by(StudentXPLog.student_id)
        .order_by(sqlfunc.sum(StudentXPLog.xp_earned).desc())
        .limit(limit)
        .all()
    )

    # Build map for quick lookup
    xp_map = {row.student_id: (int(row.total_xp), int(row.stories)) for row in xp_rows}

    # For students with no XP logs at all
    for sid in student_ids:
        if sid not in xp_map:
            xp_map[sid] = (0, 0)

    # Fetch user names
    users = db.query(User).filter(User.id.in_(student_ids)).all()
    user_map = {u.id: u.name for u in users}

    ranked = sorted(xp_map.items(), key=lambda kv: kv[1][0], reverse=True)[:limit]

    result = []
    for rank, (student_id, (total_xp, stories)) in enumerate(ranked, start=1):
        lv = xp_to_level(total_xp)
        result.append(
            {
                "rank": rank,
                "student_id": student_id,
                "name": user_map.get(student_id, "—"),
                "total_xp": total_xp,
                "level": lv,
                "stories_completed": stories,
            }
        )

    return result
