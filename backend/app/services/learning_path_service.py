"""
AI Personalized Learning Path Recommendations — Issue #252.

Pure algorithmic recommendation engine (no ML model needed).
Analyzes LearningSession + CharacterError data to score unread stories
and return top-N recommendations with human-readable reasons.

Algorithm (higher score = better recommendation):
  1. Difficulty match: prefer stories at student's current grade level
     (+30 for exact grade, +20 for ±1 grade, +10 for ±2 grade)
  2. Weak character coverage: stories whose vocabulary overlaps with the
     student's stuck characters get a bonus (+5 per overlapping char,
     capped at +25)
  3. Genre variety: penalize the same genre the student just read (-10)
  4. Recency: deprioritize stories attempted (but not completed) recently (-15)
  5. Completion bonus: never recommend a well-completed story (accuracy >=80%
     on latest attempt) — these are excluded entirely

Returns list of:
  {
    story_slug: str,         # lesson_number as string
    title: str,
    grade: int,
    genre: str,
    difficulty_match_score: int,
    reason: str,             # human-readable Chinese explanation
  }

No DB writes — pure read-only analysis.
"""

from __future__ import annotations

import logging
from collections import defaultdict
from datetime import datetime, timedelta, timezone
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from sqlalchemy.orm import Session as DbSession

from ..models.session import CharacterError, LearningSession
from .lesson_loader import get_all_lessons

logger = logging.getLogger(__name__)

# Thresholds
LOOKBACK_DAYS = 60          # history window for analysis
WELL_DONE_ACCURACY = 80.0   # stories above this are excluded
CHAR_BONUS_PER_CHAR = 5     # bonus per stuck-char overlap
CHAR_BONUS_CAP = 25         # max char overlap bonus
DIFFICULTY_EXACT = 30       # same grade bonus
DIFFICULTY_NEAR = 20        # ±1 grade bonus
DIFFICULTY_FAR = 10         # ±2 grade bonus
RECENT_ATTEMPT_PENALTY = 15 # penalty for recently attempted story
GENRE_REPEAT_PENALTY = 10   # penalty for repeating last genre


def recommend_next_stories(
    student_id: int,
    db: "DbSession",
    limit: int = 5,
) -> list[dict]:
    """Recommend up to `limit` stories personalized for the student.

    Returns list of dicts with keys:
      story_slug, title, grade, genre, difficulty_match_score, reason
    Sorted by score descending.
    """
    cutoff = datetime.now(timezone.utc) - timedelta(days=LOOKBACK_DAYS)

    # ── 1. Fetch student history ────────────────────────────────────────────
    # Filter story_slug IS NOT NULL in SQL to avoid fetching sessions that
    # can never contribute to slug_sessions (e.g. sessions without a story).
    sessions = (
        db.query(LearningSession)
        .filter(
            LearningSession.student_id == student_id,
            LearningSession.started_at >= cutoff,
            LearningSession.story_slug.isnot(None),
        )
        .order_by(LearningSession.started_at.asc())
        .all()
    )

    # Map slug → list of sessions (for this student)
    # All sessions here are guaranteed to have story_slug (filtered in SQL above).
    slug_sessions: dict[str, list[LearningSession]] = defaultdict(list)
    for s in sessions:
        slug_sessions[s.story_slug].append(s)

    # Slugs where the student achieved >=80% accuracy (well done, skip)
    well_done_slugs: set[str] = set()
    # Slugs attempted recently (last 7 days) — penalize
    recently_attempted_slugs: set[str] = set()
    recent_cutoff = datetime.now(timezone.utc) - timedelta(days=7)

    for slug, slug_sess in slug_sessions.items():
        latest = slug_sess[-1]
        if latest.accuracy is not None and latest.accuracy >= WELL_DONE_ACCURACY:
            well_done_slugs.add(slug)
        # Handle both timezone-aware (PostgreSQL) and naive (SQLite test) datetimes
        started = latest.started_at
        if started.tzinfo is None:
            started = started.replace(tzinfo=timezone.utc)
        if started >= recent_cutoff:
            recently_attempted_slugs.add(slug)

    # ── 2. Estimate student's effective grade from history ──────────────────
    completed_grades: list[int] = []
    all_lessons = get_all_lessons()
    lesson_by_slug = {str(l["lesson_number"]): l for l in all_lessons}

    for slug, slug_sess in slug_sessions.items():
        lesson = lesson_by_slug.get(slug)
        if lesson:
            best_acc = max(
                (s.accuracy for s in slug_sess if s.accuracy is not None), default=None
            )
            if best_acc is not None and best_acc >= 60.0:
                completed_grades.append(lesson["grade"])

    if completed_grades:
        # Use the most common grade the student works at
        grade_counts: dict[int, int] = defaultdict(int)
        for g in completed_grades:
            grade_counts[g] += 1
        student_grade = max(grade_counts, key=lambda g: grade_counts[g])
    else:
        # Default to grade 4 (entry level)
        student_grade = 4

    # ── 3. Get stuck characters to find stories that cover weak spots ───────
    stuck_chars: set[str] = set()
    if sessions:
        from sqlalchemy import func as sa_func
        rows = (
            db.query(
                CharacterError.character,
                sa_func.count(CharacterError.id).label("error_count"),
            )
            .join(LearningSession, CharacterError.session_id == LearningSession.id)
            .filter(
                LearningSession.student_id == student_id,
                LearningSession.started_at >= cutoff,
            )
            .group_by(CharacterError.character)
            .having(sa_func.count(CharacterError.id) >= 2)
            .all()
        )
        stuck_chars = {row.character for row in rows}

    # ── 4. Determine last genre to apply variety penalty ───────────────────
    last_genre: str | None = None
    if sessions:
        # Find the last session that has a resolvable lesson
        for s in reversed(sessions):
            if s.story_slug and s.story_slug in lesson_by_slug:
                last_genre = lesson_by_slug[s.story_slug].get("genre")
                break

    # ── 5. Score every unread / not-well-done story ─────────────────────────
    scored: list[dict] = []

    for lesson in all_lessons:
        slug = str(lesson["lesson_number"])

        # Skip stories the student already mastered
        if slug in well_done_slugs:
            continue

        score = 0
        reason_parts: list[str] = []

        # Difficulty match
        grade_diff = abs(lesson["grade"] - student_grade)
        if grade_diff == 0:
            score += DIFFICULTY_EXACT
            reason_parts.append(f"難度符合你目前的程度（{lesson['grade']} 年級）")
        elif grade_diff == 1:
            score += DIFFICULTY_NEAR
            if lesson["grade"] > student_grade:
                reason_parts.append("難度略高，適合挑戰")
            else:
                reason_parts.append("難度稍低，適合鞏固基礎")
        elif grade_diff == 2:
            score += DIFFICULTY_FAR
            if lesson["grade"] > student_grade:
                reason_parts.append("難度有所提升，可嘗試挑戰")
            else:
                reason_parts.append("可以複習鞏固")
        else:
            # Too far from student level — still include but low score
            if lesson["grade"] > student_grade:
                reason_parts.append("難度較高，建議打好基礎再嘗試")
            else:
                reason_parts.append("可做複習練習")

        # Weak character coverage
        vocab = lesson.get("vocabulary") or []
        lesson_chars: set[str] = set()
        for v in vocab:
            word = v.get("word", "") if isinstance(v, dict) else str(v)
            lesson_chars.update(word)
        # Also scan full text for stuck chars
        full_text = lesson.get("full_text") or ""
        overlap = stuck_chars & (lesson_chars | set(full_text))
        if overlap:
            char_bonus = min(len(overlap) * CHAR_BONUS_PER_CHAR, CHAR_BONUS_CAP)
            score += char_bonus
            sample = "、".join(list(overlap)[:3])
            reason_parts.append(f"包含你需要加強的字：「{sample}」")

        # Genre variety penalty
        if last_genre and lesson.get("genre") == last_genre:
            score -= GENRE_REPEAT_PENALTY

        # Recent attempt penalty
        if slug in recently_attempted_slugs:
            score -= RECENT_ATTEMPT_PENALTY
            reason_parts.append("（你最近剛讀過，可稍後再練習）")

        # Build human-readable reason
        if not reason_parts:
            reason_parts.append(f"適合 {lesson['grade']} 年級程度的學生")
        reason = "；".join(reason_parts)

        scored.append({
            "story_slug": slug,
            "title": lesson["title"],
            "grade": lesson["grade"],
            "genre": lesson.get("genre", ""),
            "difficulty_match_score": score,
            "reason": reason,
        })

    # Sort by score descending, then by lesson_number ascending for stability
    scored.sort(key=lambda x: (-x["difficulty_match_score"], int(x["story_slug"])))

    logger.info(
        "Learning path recommendations for student %d: grade=%d, stuck_chars=%d, candidates=%d",
        student_id, student_grade, len(stuck_chars), len(scored),
    )

    return scored[:limit]
