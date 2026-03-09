"""
Cross-Text Learning Pattern Analysis — Issue #253.

Analyses a student's performance across ALL completed texts to surface:
  - text_type_performance: how they perform by genre / difficulty / category
  - vocabulary_growth: unique vocab words encountered per session over time
  - difficulty_progression: score trajectory ordered by text grade
  - common_error_patterns: characters that appear as errors in multiple texts

No DB writes — pure read-only analysis over existing LearningSession data.
"""

from __future__ import annotations

import logging
from collections import Counter, defaultdict
from datetime import datetime, timezone
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from sqlalchemy.orm import Session as DbSession

from ..models.session import CharacterError, LearningSession
from ..models.text import Text

logger = logging.getLogger(__name__)

# Minimum completed sessions to generate meaningful patterns
MIN_SESSIONS_FOR_ANALYSIS = 2


# ── helpers ───────────────────────────────────────────────────────────────────


def _score(session: LearningSession) -> float | None:
    """Return the best available aggregate score for a session."""
    return session.overall_score or session.accuracy


def _completed_sessions_with_text(
    student_id: int,
    db: "DbSession",
) -> list[tuple[LearningSession, Text | None]]:
    """Fetch all completed sessions that have an associated text record.

    Sessions are sorted by completion time ascending.
    """
    sessions = (
        db.query(LearningSession)
        .filter(
            LearningSession.student_id == student_id,
            LearningSession.status == "completed",
        )
        .order_by(LearningSession.completed_at.asc())
        .all()
    )

    pairs: list[tuple[LearningSession, Text | None]] = []
    for s in sessions:
        text: Text | None = None
        if s.text_id:
            text = db.query(Text).filter(Text.id == s.text_id).first()
        pairs.append((s, text))
    return pairs


# ── text-type performance ─────────────────────────────────────────────────────


def _build_text_type_performance(
    pairs: list[tuple[LearningSession, Text | None]],
) -> dict:
    """Aggregate mean score / attempt count by genre, category, and grade.

    Returns::
        {
            "by_genre": [{"genre": "記敘文", "avg_score": 85.0, "attempts": 3}],
            "by_category": [...],
            "by_grade": [{"grade": 5, "avg_score": 78.0, "attempts": 2}],
        }
    """
    genre_scores: dict[str, list[float]] = defaultdict(list)
    category_scores: dict[str, list[float]] = defaultdict(list)
    grade_scores: dict[int, list[float]] = defaultdict(list)

    for session, text in pairs:
        score = _score(session)
        if score is None or text is None:
            continue
        genre_scores[text.genre].append(score)
        category_scores[text.category].append(score)
        grade_scores[text.grade].append(score)

    def _aggregate(raw: dict) -> list[dict]:
        result = []
        for key, scores in sorted(raw.items(), key=lambda x: str(x[0])):
            result.append({
                "label": str(key),
                "avg_score": round(sum(scores) / len(scores), 1),
                "attempts": len(scores),
            })
        return result

    def _aggregate_grade(raw: dict[int, list[float]]) -> list[dict]:
        result = []
        for grade in sorted(raw.keys()):
            scores = raw[grade]
            result.append({
                "grade": grade,
                "avg_score": round(sum(scores) / len(scores), 1),
                "attempts": len(scores),
            })
        return result

    return {
        "by_genre": _aggregate(genre_scores),
        "by_category": _aggregate(category_scores),
        "by_grade": _aggregate_grade(grade_scores),
    }


# ── vocabulary growth ─────────────────────────────────────────────────────────


def _build_vocabulary_growth(
    pairs: list[tuple[LearningSession, Text | None]],
) -> list[dict]:
    """Return a timeline of cumulative unique vocabulary words encountered.

    Each entry represents one completed session::
        [
            {
                "session_index": 1,
                "completed_at": "2025-01-10T...",
                "text_title": "...",
                "new_words": 8,
                "cumulative_words": 8,
            },
            ...
        ]
    """
    seen_words: set[str] = set()
    timeline: list[dict] = []

    for idx, (session, text) in enumerate(pairs, start=1):
        if session.completed_at is None:
            continue

        # Collect vocab from the text's vocabulary list (if any)
        new_words: set[str] = set()
        if text and text.vocabulary:
            for entry in text.vocabulary:
                word: str | None = None
                if isinstance(entry, dict):
                    word = entry.get("word") or entry.get("character")
                elif isinstance(entry, str):
                    word = entry
                if word and word not in seen_words:
                    new_words.add(word)

        seen_words |= new_words
        timeline.append({
            "session_index": idx,
            "completed_at": session.completed_at.isoformat(),
            "text_title": text.title if text else (session.story_slug or ""),
            "new_words": len(new_words),
            "cumulative_words": len(seen_words),
        })

    return timeline


# ── difficulty progression ────────────────────────────────────────────────────


def _build_difficulty_progression(
    pairs: list[tuple[LearningSession, Text | None]],
) -> list[dict]:
    """Return sessions sorted by completion time showing score vs text grade.

    Each entry::
        {
            "session_index": 1,
            "completed_at": "...",
            "text_title": "...",
            "grade": 5,
            "score": 82.5,
        }
    """
    progression: list[dict] = []
    for idx, (session, text) in enumerate(pairs, start=1):
        if session.completed_at is None:
            continue
        score = _score(session)
        progression.append({
            "session_index": idx,
            "completed_at": session.completed_at.isoformat(),
            "text_title": text.title if text else (session.story_slug or ""),
            "grade": text.grade if text else None,
            "genre": text.genre if text else None,
            "score": round(score, 1) if score is not None else None,
        })
    return progression


# ── common error patterns ─────────────────────────────────────────────────────


def _build_common_error_patterns(
    student_id: int,
    pairs: list[tuple[LearningSession, Text | None]],
    db: "DbSession",
) -> list[dict]:
    """Identify characters that appear as errors in multiple distinct texts.

    Returns top-10 recurring error characters::
        [
            {
                "character": "繁",
                "error_count": 5,
                "text_count": 3,
                "error_type": "pronunciation",
            },
            ...
        ]
    """
    session_ids = [s.id for s, _ in pairs]
    if not session_ids:
        return []

    errors = (
        db.query(CharacterError)
        .filter(CharacterError.session_id.in_(session_ids))
        .all()
    )

    # Map session_id -> text title for context
    session_to_text: dict[int, str] = {}
    for session, text in pairs:
        session_to_text[session.id] = text.title if text else (session.story_slug or "")

    # Accumulate error counts and distinct texts per character
    char_error_count: Counter[str] = Counter()
    char_text_set: dict[str, set[str]] = defaultdict(set)
    char_error_type: dict[str, Counter[str]] = defaultdict(Counter)

    for err in errors:
        char_error_count[err.character] += 1
        char_text_set[err.character].add(session_to_text.get(err.session_id, ""))
        char_error_type[err.character][err.error_type] += 1

    # Only surface characters that appear across >= 2 distinct texts
    recurring = [
        char for char, texts in char_text_set.items() if len(texts) >= 2
    ]
    recurring.sort(key=lambda c: char_error_count[c], reverse=True)

    result = []
    for char in recurring[:10]:
        dominant_type = char_error_type[char].most_common(1)[0][0]
        result.append({
            "character": char,
            "error_count": char_error_count[char],
            "text_count": len(char_text_set[char]),
            "dominant_error_type": dominant_type,
        })
    return result


# ── public API ────────────────────────────────────────────────────────────────


def analyze_cross_text_patterns(student_id: int, db: "DbSession") -> dict:
    """Main entry point — analyse cross-text learning patterns for a student.

    Returns::
        {
            "student_id": 42,
            "total_completed_texts": 7,
            "has_enough_data": True,
            "text_type_performance": { ... },
            "vocabulary_growth": [ ... ],
            "difficulty_progression": [ ... ],
            "common_error_patterns": [ ... ],
            "summary": {
                "strongest_genre": "記敘文",
                "weakest_genre": "文言文",
                "total_vocabulary_words": 64,
                "recurring_error_chars": 3,
            },
        }
    """
    pairs = _completed_sessions_with_text(student_id, db)

    has_enough = len(pairs) >= MIN_SESSIONS_FOR_ANALYSIS

    if not has_enough:
        logger.info(
            "Student %d has only %d completed sessions — skipping full analysis",
            student_id,
            len(pairs),
        )
        return {
            "student_id": student_id,
            "total_completed_texts": len(pairs),
            "has_enough_data": False,
            "text_type_performance": {"by_genre": [], "by_category": [], "by_grade": []},
            "vocabulary_growth": [],
            "difficulty_progression": [],
            "common_error_patterns": [],
            "summary": {
                "strongest_genre": None,
                "weakest_genre": None,
                "total_vocabulary_words": 0,
                "recurring_error_chars": 0,
            },
        }

    text_type_performance = _build_text_type_performance(pairs)
    vocabulary_growth = _build_vocabulary_growth(pairs)
    difficulty_progression = _build_difficulty_progression(pairs)
    common_error_patterns = _build_common_error_patterns(student_id, pairs, db)

    # Derive summary insights
    by_genre = text_type_performance["by_genre"]
    strongest_genre: str | None = None
    weakest_genre: str | None = None
    if by_genre:
        sorted_genres = sorted(by_genre, key=lambda g: g["avg_score"], reverse=True)
        if len(sorted_genres) >= 1:
            strongest_genre = sorted_genres[0]["label"]
        if len(sorted_genres) >= 2:
            weakest_genre = sorted_genres[-1]["label"]

    total_vocab = vocabulary_growth[-1]["cumulative_words"] if vocabulary_growth else 0

    logger.info(
        "Cross-text analysis for student %d: %d sessions, %d vocab words, %d recurring errors",
        student_id,
        len(pairs),
        total_vocab,
        len(common_error_patterns),
    )

    return {
        "student_id": student_id,
        "total_completed_texts": len(pairs),
        "has_enough_data": True,
        "text_type_performance": text_type_performance,
        "vocabulary_growth": vocabulary_growth,
        "difficulty_progression": difficulty_progression,
        "common_error_patterns": common_error_patterns,
        "summary": {
            "strongest_genre": strongest_genre,
            "weakest_genre": weakest_genre,
            "total_vocabulary_words": total_vocab,
            "recurring_error_chars": len(common_error_patterns),
        },
    }


def analyze_class_cross_text_patterns(
    student_ids: list[int],
    db: "DbSession",
) -> dict:
    """Class-level aggregation of cross-text patterns.

    Aggregates individual student analyses into class-wide insights::
        {
            "total_students": 25,
            "students_with_enough_data": 18,
            "class_genre_performance": [...],
            "class_common_errors": [...],
            "student_summaries": [...],
        }
    """
    if not student_ids:
        return {
            "total_students": 0,
            "students_with_enough_data": 0,
            "class_genre_performance": [],
            "class_common_errors": [],
            "student_summaries": [],
        }

    # Collect genre scores across all students
    class_genre_scores: dict[str, list[float]] = defaultdict(list)
    class_error_count: Counter[str] = Counter()
    student_summaries: list[dict] = []
    students_with_data = 0

    for sid in student_ids:
        analysis = analyze_cross_text_patterns(sid, db)
        if analysis["has_enough_data"]:
            students_with_data += 1
            for entry in analysis["text_type_performance"]["by_genre"]:
                class_genre_scores[entry["label"]].append(entry["avg_score"])
            for err in analysis["common_error_patterns"]:
                class_error_count[err["character"]] += err["error_count"]

        student_summaries.append({
            "student_id": sid,
            "total_completed_texts": analysis["total_completed_texts"],
            "has_enough_data": analysis["has_enough_data"],
            "summary": analysis["summary"],
        })

    # Aggregate class genre performance
    class_genre_performance = [
        {
            "genre": genre,
            "class_avg_score": round(sum(scores) / len(scores), 1),
            "student_count": len(scores),
        }
        for genre, scores in sorted(class_genre_scores.items())
    ]

    # Top class-wide recurring errors
    class_common_errors = [
        {"character": char, "total_errors": count}
        for char, count in class_error_count.most_common(10)
    ]

    return {
        "total_students": len(student_ids),
        "students_with_enough_data": students_with_data,
        "class_genre_performance": class_genre_performance,
        "class_common_errors": class_common_errors,
        "student_summaries": student_summaries,
    }
