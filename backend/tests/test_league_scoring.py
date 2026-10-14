"""Tests for app.services.league_scoring — weighted, read-only points
derived from `learning_sessions` directly, with the anti-farming rules
from PRD §11 (assignment always counts, grade floor for self-chosen,
first-completion-only dedup, daily cap, 3-minute minimum duration).
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone
from unittest.mock import patch

import pytest

from app.services.league_scoring import (
    DAILY_LESSON_CAP,
    LEAGUE_WEIGHTS_V1,
    compute_student_score,
)
from league_factories import complete_lesson, make_student


@pytest.fixture()
def db_session():
    from sqlalchemy import create_engine
    from sqlalchemy.orm import sessionmaker
    from app.models.base import Base
    import app.models  # noqa: F401

    engine = create_engine("sqlite:///:memory:", connect_args={"check_same_thread": False})
    Base.metadata.create_all(engine)
    SessionLocal = sessionmaker(bind=engine)
    session = SessionLocal()
    try:
        yield session
    finally:
        session.close()
        Base.metadata.drop_all(engine)


NOW = datetime(2026, 10, 15, 12, 0, 0, tzinfo=timezone.utc)
WINDOW_START = NOW - timedelta(days=7)
WINDOW_END = NOW + timedelta(days=7)


def _grade_lookup(grades: dict[str, int]):
    """Patch target for app.services.league_scoring.get_lesson_by_id."""

    def _fn(lesson_id: int):
        slug = str(lesson_id)
        if slug not in grades:
            return None
        return {"id": lesson_id, "grade": grades[slug]}

    return _fn


class TestComputeStudentScore:
    def test_zero_when_no_completions(self, db_session):
        student = make_student(db_session)
        db_session.commit()
        with patch("app.services.league_scoring.get_lesson_by_id", _grade_lookup({})):
            result = compute_student_score(
                db_session, student.id, 5, WINDOW_START, WINDOW_END, LEAGUE_WEIGHTS_V1
            )
        assert result.points == 0.0
        assert result.lessons_counted == 0
        assert result.anomalies == []

    def test_self_chosen_at_grade_counts(self, db_session):
        student = make_student(db_session)
        complete_lesson(
            db_session, student, "100",
            started_at=NOW - timedelta(minutes=10), completed_at=NOW, session_mode="self_study",
        )
        db_session.commit()
        with patch("app.services.league_scoring.get_lesson_by_id", _grade_lookup({"100": 5})):
            result = compute_student_score(
                db_session, student.id, 5, WINDOW_START, WINDOW_END, LEAGUE_WEIGHTS_V1
            )
        assert result.points == LEAGUE_WEIGHTS_V1.lesson_complete
        assert result.lessons_counted == 1

    def test_self_chosen_below_floor_does_not_count(self, db_session):
        # team_grade=9, floor=7; a grade-4 self-chosen lesson is below floor.
        student = make_student(db_session)
        complete_lesson(
            db_session, student, "100",
            started_at=NOW - timedelta(minutes=10), completed_at=NOW, session_mode="self_study",
        )
        db_session.commit()
        with patch("app.services.league_scoring.get_lesson_by_id", _grade_lookup({"100": 4})):
            result = compute_student_score(
                db_session, student.id, 9, WINDOW_START, WINDOW_END, LEAGUE_WEIGHTS_V1
            )
        assert result.points == 0.0
        assert result.lessons_counted == 0

    def test_assignment_lesson_always_counts_even_below_floor(self, db_session):
        # PRD §11.1: teacher-assigned lessons ALWAYS count, no grade floor.
        student = make_student(db_session)
        complete_lesson(
            db_session, student, "100",
            started_at=NOW - timedelta(minutes=10), completed_at=NOW, session_mode="assignment",
        )
        db_session.commit()
        with patch("app.services.league_scoring.get_lesson_by_id", _grade_lookup({"100": 1})):
            result = compute_student_score(
                db_session, student.id, 9, WINDOW_START, WINDOW_END, LEAGUE_WEIGHTS_V1
            )
        assert result.points == LEAGUE_WEIGHTS_V1.lesson_complete + LEAGUE_WEIGHTS_V1.assignment_bonus
        assert result.lessons_counted == 1

    def test_too_fast_completion_is_excluded_and_flagged(self, db_session):
        student = make_student(db_session)
        complete_lesson(
            db_session, student, "100",
            started_at=NOW - timedelta(seconds=90), completed_at=NOW, session_mode="self_study",
        )
        db_session.commit()
        with patch("app.services.league_scoring.get_lesson_by_id", _grade_lookup({"100": 5})):
            result = compute_student_score(
                db_session, student.id, 5, WINDOW_START, WINDOW_END, LEAGUE_WEIGHTS_V1
            )
        assert result.points == 0.0
        assert len(result.anomalies) == 1
        assert result.anomalies[0].reason == "too_fast"
        assert result.anomalies[0].story_slug == "100"

    def test_at_exactly_three_minutes_is_not_flagged(self, db_session):
        student = make_student(db_session)
        complete_lesson(
            db_session, student, "100",
            started_at=NOW - timedelta(minutes=3), completed_at=NOW, session_mode="self_study",
        )
        db_session.commit()
        with patch("app.services.league_scoring.get_lesson_by_id", _grade_lookup({"100": 5})):
            result = compute_student_score(
                db_session, student.id, 5, WINDOW_START, WINDOW_END, LEAGUE_WEIGHTS_V1
            )
        assert result.points == LEAGUE_WEIGHTS_V1.lesson_complete
        assert result.anomalies == []

    def test_daily_cap_excludes_extra_lessons_and_flags_them(self, db_session):
        student = make_student(db_session)
        grades = {}
        for i in range(DAILY_LESSON_CAP + 2):
            slug = str(100 + i)
            grades[slug] = 5
            complete_lesson(
                db_session, student, slug,
                started_at=NOW - timedelta(minutes=10, seconds=-i),
                completed_at=NOW + timedelta(minutes=i),  # same day, staggered order
                session_mode="self_study",
            )
        db_session.commit()
        with patch("app.services.league_scoring.get_lesson_by_id", _grade_lookup(grades)):
            result = compute_student_score(
                db_session, student.id, 5, WINDOW_START, WINDOW_END, LEAGUE_WEIGHTS_V1
            )
        assert result.lessons_counted == DAILY_LESSON_CAP
        assert len(result.anomalies) == 2
        assert all(a.reason == "daily_cap_exceeded" for a in result.anomalies)

    def test_daily_cap_resets_the_next_day(self, db_session):
        student = make_student(db_session)
        grades = {}
        day1 = NOW
        day2 = NOW + timedelta(days=1)
        for i in range(DAILY_LESSON_CAP):
            slug = str(300 + i)
            grades[slug] = 5
            complete_lesson(
                db_session, student, slug,
                started_at=day1 - timedelta(minutes=10), completed_at=day1 + timedelta(minutes=i),
            )
        for i in range(DAILY_LESSON_CAP):
            slug = str(400 + i)
            grades[slug] = 5
            complete_lesson(
                db_session, student, slug,
                started_at=day2 - timedelta(minutes=10), completed_at=day2 + timedelta(minutes=i),
            )
        db_session.commit()
        with patch("app.services.league_scoring.get_lesson_by_id", _grade_lookup(grades)):
            result = compute_student_score(
                db_session, student.id, 5, WINDOW_START, WINDOW_END, LEAGUE_WEIGHTS_V1
            )
        assert result.lessons_counted == DAILY_LESSON_CAP * 2
        assert result.anomalies == []

    def test_replaying_the_same_lesson_never_earns_points_twice(self, db_session):
        student = make_student(db_session)
        complete_lesson(
            db_session, student, "100",
            started_at=NOW - timedelta(minutes=10), completed_at=NOW,
        )
        complete_lesson(
            db_session, student, "100",
            started_at=NOW - timedelta(minutes=10), completed_at=NOW + timedelta(hours=1),
        )
        db_session.commit()
        with patch("app.services.league_scoring.get_lesson_by_id", _grade_lookup({"100": 5})):
            result = compute_student_score(
                db_session, student.id, 5, WINDOW_START, WINDOW_END, LEAGUE_WEIGHTS_V1
            )
        assert result.lessons_counted == 1
        assert result.points == LEAGUE_WEIGHTS_V1.lesson_complete

    def test_first_ever_completion_before_window_does_not_count_even_if_replayed_inside_it(
        self, db_session
    ):
        student = make_student(db_session)
        complete_lesson(
            db_session, student, "100",
            started_at=WINDOW_START - timedelta(days=2, minutes=10),
            completed_at=WINDOW_START - timedelta(days=2),
        )
        complete_lesson(
            db_session, student, "100",
            started_at=NOW - timedelta(minutes=10), completed_at=NOW,
        )
        db_session.commit()
        with patch("app.services.league_scoring.get_lesson_by_id", _grade_lookup({"100": 5})):
            result = compute_student_score(
                db_session, student.id, 5, WINDOW_START, WINDOW_END, LEAGUE_WEIGHTS_V1
            )
        assert result.points == 0.0

    def test_completion_outside_window_does_not_count(self, db_session):
        student = make_student(db_session)
        complete_lesson(
            db_session, student, "100",
            started_at=WINDOW_START - timedelta(days=100, minutes=10),
            completed_at=WINDOW_START - timedelta(days=100),
        )
        db_session.commit()
        with patch("app.services.league_scoring.get_lesson_by_id", _grade_lookup({"100": 5})):
            result = compute_student_score(
                db_session, student.id, 5, WINDOW_START, WINDOW_END, LEAGUE_WEIGHTS_V1
            )
        assert result.points == 0.0

    def test_does_not_mix_another_students_completions_into_the_score(self, db_session):
        student_a = make_student(db_session)
        student_b = make_student(db_session)
        complete_lesson(
            db_session, student_a, "100",
            started_at=NOW - timedelta(minutes=10), completed_at=NOW,
        )
        complete_lesson(
            db_session, student_b, "200",
            started_at=NOW - timedelta(minutes=10), completed_at=NOW,
        )
        db_session.commit()
        with patch(
            "app.services.league_scoring.get_lesson_by_id", _grade_lookup({"100": 5, "200": 5})
        ):
            result = compute_student_score(
                db_session, student_a.id, 5, WINDOW_START, WINDOW_END, LEAGUE_WEIGHTS_V1
            )
        assert result.lessons_counted == 1
        assert result.points == LEAGUE_WEIGHTS_V1.lesson_complete

    def test_unresolvable_lesson_grade_excludes_self_chosen_but_not_assignment(self, db_session):
        student = make_student(db_session)
        complete_lesson(
            db_session, student, "999",
            started_at=NOW - timedelta(minutes=10), completed_at=NOW, session_mode="self_study",
        )
        db_session.commit()
        with patch("app.services.league_scoring.get_lesson_by_id", _grade_lookup({})):
            result = compute_student_score(
                db_session, student.id, 5, WINDOW_START, WINDOW_END, LEAGUE_WEIGHTS_V1
            )
        assert result.points == 0.0
