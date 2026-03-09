"""Gamification models: XP log, level snapshots, and achievement badges."""
from datetime import datetime

from sqlalchemy import (
    Boolean,
    DateTime,
    ForeignKey,
    Integer,
    String,
    Text,
    UniqueConstraint,
    func,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .base import Base


# ── XP Configuration (defined in code, not DB) ───────────────────────────────

XP_REWARDS = {
    "session_complete": 20,       # completed a full learning session
    "accuracy_70": 10,            # reading accuracy >= 70%
    "accuracy_90": 20,            # reading accuracy >= 90%
    "comprehension_pass": 10,     # passed comprehension questions
    "streak_bonus": 5,            # daily login streak bonus (per day)
    "first_story": 30,            # bonus for completing very first story
    "vocab_practice": 5,          # completed vocabulary practice step
}

# Cumulative XP thresholds per level (index = level-1, value = XP needed to reach it)
LEVEL_THRESHOLDS = [
    0,    # Level 1  — starting level
    100,  # Level 2
    250,  # Level 3
    500,  # Level 4
    800,  # Level 5
    1200, # Level 6
    1700, # Level 7
    2300, # Level 8
    3000, # Level 9
    4000, # Level 10 — max
]

LEVEL_NAMES = [
    "初學者",   # 1
    "求知者",   # 2
    "閱讀者",   # 3
    "探索者",   # 4
    "思考者",   # 5
    "朗讀家",   # 6
    "文字匠",   # 7
    "智慧者",   # 8
    "文學人",   # 9
    "國文之星", # 10
]


def xp_to_level(total_xp: int) -> int:
    """Return 1-based level for the given cumulative XP."""
    level = 1
    for i, threshold in enumerate(LEVEL_THRESHOLDS):
        if total_xp >= threshold:
            level = i + 1
        else:
            break
    return min(level, len(LEVEL_THRESHOLDS))


def level_progress(total_xp: int) -> dict:
    """Return level metadata for a student's total XP."""
    level = xp_to_level(total_xp)
    current_threshold = LEVEL_THRESHOLDS[level - 1]
    next_threshold = LEVEL_THRESHOLDS[level] if level < len(LEVEL_THRESHOLDS) else None

    if next_threshold is None:
        pct = 100
        xp_in_level = total_xp - current_threshold
        xp_needed = 0
    else:
        xp_in_level = total_xp - current_threshold
        xp_range = next_threshold - current_threshold
        pct = min(100, round(xp_in_level / xp_range * 100))
        xp_needed = next_threshold - total_xp

    return {
        "level": level,
        "level_name": LEVEL_NAMES[level - 1],
        "total_xp": total_xp,
        "current_level_xp": xp_in_level,
        "next_level_xp": next_threshold,
        "xp_to_next": max(0, xp_needed),
        "progress_pct": pct,
    }


# ── Badge catalogue (defined in code) ────────────────────────────────────────

BADGE_CATALOGUE = {
    "first_story": {
        "name": "第一步",
        "description": "完成第一篇課文學習",
        "icon": "star",
        "color": "yellow",
    },
    "story_5": {
        "name": "勤讀者",
        "description": "累計完成 5 篇課文",
        "icon": "book",
        "color": "blue",
    },
    "story_10": {
        "name": "閱讀達人",
        "description": "累計完成 10 篇課文",
        "icon": "book-open",
        "color": "purple",
    },
    "story_25": {
        "name": "博覽群書",
        "description": "累計完成 25 篇課文",
        "icon": "library",
        "color": "gold",
    },
    "streak_3": {
        "name": "三日不輟",
        "description": "連續學習 3 天",
        "icon": "fire",
        "color": "orange",
    },
    "streak_7": {
        "name": "週週精進",
        "description": "連續學習 7 天",
        "icon": "fire",
        "color": "red",
    },
    "streak_30": {
        "name": "月月堅持",
        "description": "連續學習 30 天",
        "icon": "trophy",
        "color": "gold",
    },
    "accuracy_90": {
        "name": "精準朗讀",
        "description": "朗讀準確度達到 90%",
        "icon": "mic",
        "color": "green",
    },
    "accuracy_100": {
        "name": "完美表現",
        "description": "朗讀準確度達到 100%",
        "icon": "award",
        "color": "gold",
    },
    "level_5": {
        "name": "思考者",
        "description": "升級到第 5 級",
        "icon": "brain",
        "color": "indigo",
    },
    "level_10": {
        "name": "國文之星",
        "description": "升級到最高等級",
        "icon": "crown",
        "color": "gold",
    },
    "xp_500": {
        "name": "積分達人",
        "description": "累計獲得 500 XP",
        "icon": "zap",
        "color": "yellow",
    },
    "xp_1000": {
        "name": "千分英雄",
        "description": "累計獲得 1000 XP",
        "icon": "zap",
        "color": "orange",
    },
}


# ── DB Models ─────────────────────────────────────────────────────────────────


class StudentXPLog(Base):
    """One row per XP award event for a student."""

    __tablename__ = "student_xp_log"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    student_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    # Event type, e.g. "session_complete", "accuracy_90"
    event_type: Mapped[str] = mapped_column(String(50), nullable=False)
    xp_earned: Mapped[int] = mapped_column(Integer, nullable=False)
    # Optional reference to the learning session that triggered this award
    session_id: Mapped[int | None] = mapped_column(
        Integer, ForeignKey("learning_sessions.id", ondelete="SET NULL"), nullable=True
    )
    # Human-readable note
    note: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    student: Mapped["User"] = relationship("User")  # type: ignore[name-defined]


class StudentBadge(Base):
    """Records which badges a student has unlocked."""

    __tablename__ = "student_badges"
    __table_args__ = (UniqueConstraint("student_id", "badge_key"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    student_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    # Key into BADGE_CATALOGUE
    badge_key: Mapped[str] = mapped_column(String(50), nullable=False)
    unlocked_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    student: Mapped["User"] = relationship("User")  # type: ignore[name-defined]


class StudentStreak(Base):
    """Tracks consecutive daily learning days per student."""

    __tablename__ = "student_streaks"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    student_id: Mapped[int] = mapped_column(
        Integer,
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        unique=True,
        index=True,
    )
    current_streak: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    longest_streak: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    last_activity_date: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )

    student: Mapped["User"] = relationship("User")  # type: ignore[name-defined]
