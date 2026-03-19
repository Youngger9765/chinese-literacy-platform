"""Teacher cross-text analysis endpoint (Issue #253)."""
import logging
from collections import defaultdict

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from ...auth.dependencies import get_current_user
from ...database import get_db
from ...dependencies.tenant import _check_classroom_access
from ...models.school import ClassroomStudent
from ...models.session import CharacterError, LearningSession
from ...models.user import User
from ...services.lesson_loader import get_lesson_by_id
from .teacher_schemas import (
    ClassroomCrossTextPattern,
    StudentCrossTextPattern,
    TextPerformanceSummary,
)

router = APIRouter(tags=["teacher"])
logger = logging.getLogger(__name__)


@router.get(
    "/teacher/classrooms/{classroom_id}/cross-text-analysis",
    response_model=ClassroomCrossTextPattern,
)
def get_cross_text_analysis(
    classroom_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Aggregate cross-text learning pattern analysis for a classroom.

    Returns per-student and class-level views of:
    - Score trends across texts over time
    - Common error characters recurring across multiple texts
    - Text difficulty ranking based on average class performance
    - Individual student strengths and weaknesses by text
    """
    classroom = _check_classroom_access(current_user, classroom_id, db)

    student_rows = (
        db.query(User)
        .join(ClassroomStudent, ClassroomStudent.student_id == User.id)
        .filter(ClassroomStudent.classroom_id == classroom_id)
        .all()
    )
    student_ids = [s.id for s in student_rows]
    student_map = {s.id: s.name or s.username or s.email for s in student_rows}

    if not student_ids:
        return ClassroomCrossTextPattern(
            classroom_id=classroom_id,
            classroom_name=classroom.name,
            total_students=0,
            total_sessions=0,
            text_difficulty_ranking=[],
            class_score_trend=[],
            common_error_chars=[],
            student_patterns=[],
        )

    # Fetch all completed sessions for all students in classroom
    all_sessions = (
        db.query(LearningSession)
        .filter(
            LearningSession.student_id.in_(student_ids),
            LearningSession.status == "completed",
            LearningSession.story_slug.isnot(None),
        )
        .order_by(LearningSession.started_at.asc())
        .all()
    )

    # Fetch all character errors for classroom sessions
    session_ids = [s.id for s in all_sessions]
    all_char_errors: list[CharacterError] = []
    if session_ids:
        all_char_errors = (
            db.query(CharacterError)
            .filter(CharacterError.session_id.in_(session_ids))
            .all()
        )

    # Build story title lookup (best-effort)
    def _get_title(slug: str) -> str | None:
        try:
            story = get_lesson_by_id(int(slug))
            return story["title"] if story else None
        except (ValueError, TypeError):
            return slug

    # -- Class-level score trend (daily avg) --
    daily_scores: dict[str, list[float]] = defaultdict(list)
    for s in all_sessions:
        if s.overall_score is not None:
            day = s.started_at.strftime("%Y-%m-%d")
            daily_scores[day].append(s.overall_score)

    class_score_trend = [
        {"date": day, "avg_score": round(sum(scores) / len(scores), 1)}
        for day, scores in sorted(daily_scores.items())
    ]

    # -- Text difficulty ranking --
    text_scores: dict[str, list[float]] = defaultdict(list)
    text_attempts: dict[str, int] = defaultdict(int)
    for s in all_sessions:
        if s.story_slug:
            text_attempts[s.story_slug] += 1
            if s.overall_score is not None:
                text_scores[s.story_slug].append(s.overall_score)

    text_difficulty_ranking = sorted(
        [
            {
                "story_slug": slug,
                "title": _get_title(slug),
                "avg_score": round(sum(text_scores[slug]) / len(text_scores[slug]), 1)
                if text_scores[slug]
                else None,
                "attempt_count": text_attempts[slug],
            }
            for slug in text_attempts
        ],
        key=lambda x: (x["avg_score"] is None, x["avg_score"] or 0),
    )

    # -- Common error chars across class --
    sid_to_student: dict[int, int] = {s.id: s.student_id for s in all_sessions}
    sid_to_slug: dict[int, str] = {
        s.id: s.story_slug for s in all_sessions if s.story_slug
    }

    char_student_set: dict[str, set[int]] = defaultdict(set)
    char_total_errors: dict[str, int] = defaultdict(int)
    for err in all_char_errors:
        student_id = sid_to_student.get(err.session_id)
        if student_id:
            char_student_set[err.character].add(student_id)
            char_total_errors[err.character] += 1

    common_error_chars = sorted(
        [
            {
                "char": char,
                "student_count": len(students),
                "total_errors": char_total_errors[char],
            }
            for char, students in char_student_set.items()
        ],
        key=lambda x: (-x["student_count"], -x["total_errors"]),
    )[:20]

    # -- Per-student patterns --
    student_patterns = _build_student_patterns(
        student_ids, student_map, all_sessions, all_char_errors, sid_to_slug, _get_title
    )
    student_patterns.sort(key=lambda x: -x.total_sessions)

    return ClassroomCrossTextPattern(
        classroom_id=classroom_id,
        classroom_name=classroom.name,
        total_students=len(student_ids),
        total_sessions=len(all_sessions),
        text_difficulty_ranking=text_difficulty_ranking,
        class_score_trend=class_score_trend,
        common_error_chars=common_error_chars,
        student_patterns=student_patterns,
    )


def _build_student_patterns(
    student_ids: list[int],
    student_map: dict[int, str],
    all_sessions: list[LearningSession],
    all_char_errors: list[CharacterError],
    sid_to_slug: dict[int, str],
    get_title,
) -> list[StudentCrossTextPattern]:
    """Build per-student cross-text pattern data."""
    patterns: list[StudentCrossTextPattern] = []

    for sid in student_ids:
        s_sessions = [s for s in all_sessions if s.student_id == sid]
        if not s_sessions:
            continue

        s_session_ids = {s.id for s in s_sessions}
        s_errors = [e for e in all_char_errors if e.session_id in s_session_ids]

        # Score trend
        score_trend = [
            {
                "date": s.started_at.strftime("%Y-%m-%d"),
                "score": s.overall_score,
                "story_slug": s.story_slug,
                "title": get_title(s.story_slug) if s.story_slug else None,
            }
            for s in s_sessions
            if s.overall_score is not None
        ]

        # Text performance breakdown
        slug_sessions: dict[str, list[LearningSession]] = defaultdict(list)
        for s in s_sessions:
            if s.story_slug:
                slug_sessions[s.story_slug].append(s)

        text_performance = []
        strong_texts: list[str] = []
        weak_texts: list[str] = []
        for slug, slug_sess in slug_sessions.items():
            scores = [s.overall_score for s in slug_sess if s.overall_score is not None]
            accuracies = [s.accuracy for s in slug_sess if s.accuracy is not None]
            comp_scores = [
                s.comprehension_score for s in slug_sess if s.comprehension_score is not None
            ]
            avg_sc = round(sum(scores) / len(scores), 1) if scores else None
            text_performance.append(
                TextPerformanceSummary(
                    story_slug=slug,
                    story_title=get_title(slug),
                    attempt_count=len(slug_sess),
                    avg_score=avg_sc,
                    avg_accuracy=round(sum(accuracies) / len(accuracies), 1)
                    if accuracies
                    else None,
                    avg_comprehension_score=round(sum(comp_scores) / len(comp_scores), 1)
                    if comp_scores
                    else None,
                    first_attempt_at=min(s.started_at for s in slug_sess),
                    last_attempt_at=max(s.started_at for s in slug_sess),
                )
            )
            if avg_sc is not None:
                if avg_sc >= 80:
                    strong_texts.append(slug)
                elif avg_sc < 60:
                    weak_texts.append(slug)

        # Repeated error chars (appearing in 2+ different texts)
        char_slug_set: dict[str, set[str]] = defaultdict(set)
        char_count: dict[str, int] = defaultdict(int)
        for err in s_errors:
            slug = sid_to_slug.get(err.session_id)
            if slug:
                char_slug_set[err.character].add(slug)
            char_count[err.character] += 1

        repeated_error_chars = sorted(
            [
                {
                    "char": char,
                    "error_count": char_count[char],
                    "story_count": len(slugs),
                    "story_slugs": list(slugs),
                }
                for char, slugs in char_slug_set.items()
                if len(slugs) >= 2
            ],
            key=lambda x: (-x["story_count"], -x["error_count"]),
        )[:10]

        all_scores = [s.overall_score for s in s_sessions if s.overall_score is not None]
        patterns.append(
            StudentCrossTextPattern(
                student_id=sid,
                student_name=student_map.get(sid, f"Student {sid}"),
                total_texts_attempted=len(slug_sessions),
                total_sessions=len(s_sessions),
                overall_avg_score=round(sum(all_scores) / len(all_scores), 1)
                if all_scores
                else None,
                score_trend=score_trend,
                text_performance=sorted(text_performance, key=lambda x: x.story_slug),
                repeated_error_chars=repeated_error_chars,
                strong_texts=strong_texts,
                weak_texts=weak_texts,
            )
        )

    return patterns
