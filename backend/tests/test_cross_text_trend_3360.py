from datetime import datetime, timedelta
from types import SimpleNamespace

from app.routes.teacher.teacher_cross_text import _build_class_score_trend, _build_student_patterns
from app.routes.teacher import teacher_cross_text
from app.models.user import User
from app.models.session import LearningSession
from app.services.cross_text_analysis_service import _build_difficulty_progression, _score


def session(index, completed_at, score):
    return SimpleNamespace(
        id=index,
        student_id=1,
        started_at=datetime(2026, 9, 16, 8),
        completed_at=completed_at,
        status="completed",
        overall_score=score,
        accuracy=None,
        comprehension_score=None,
        story_slug="1",
    )


def test_ten_sessions_started_same_day_keep_ten_chronological_points():
    sessions = [
        session(i, datetime(2026, 9, 1) + timedelta(days=i), 70 + i)
        for i in range(10)
    ]
    sessions.reverse()
    class_trend = _build_class_score_trend(sessions)
    students = _build_student_patterns([1], {1: "學生"}, sessions, [], {}, lambda _: "課文")

    assert len(class_trend) == len(students[0].score_trend) == 10
    assert [point["avg_score"] for point in class_trend] == list(range(70, 80))
    assert [point["date"] for point in students[0].score_trend] == [
        (datetime(2026, 9, 1) + timedelta(days=i)).strftime("%Y-%m-%d") for i in range(10)
    ]
    assert students[0].sample_count == 10


def test_same_completion_day_keeps_both_and_missing_score_is_counted():
    sessions = [
        session(1, datetime(2026, 9, 2, 10), 0),
        session(2, datetime(2026, 9, 2, 11), 82),
        session(3, None, None),
    ]
    class_trend = _build_class_score_trend(sessions)
    student = _build_student_patterns([1], {1: "學生"}, sessions, [], {}, lambda _: "課文")[0]

    # Same completion day → one class point holding the average, not the last write.
    assert [point["avg_score"] for point in class_trend] == [41.0]
    assert [point["score"] for point in student.score_trend] == [0, 82]
    assert student.sample_count == 2
    assert student.completed_without_score == 1
    assert _score(sessions[0]) == 0


def test_service_progression_falls_back_to_start_time_without_zero_filling():
    sessions = [
        session(1, datetime(2026, 9, 3), 60),
        session(2, None, None),
        session(3, datetime(2026, 9, 2), 80),
    ]
    trend = _build_difficulty_progression([(item, None) for item in sessions])

    assert [point["score"] for point in trend] == [80, 60, None]
    assert trend[-1]["completed_at"] == sessions[1].started_at.isoformat()


def test_classroom_response_exposes_both_counts(monkeypatch):
    sessions = [session(1, datetime(2026, 9, 18), 90), session(2, None, None)]
    student = SimpleNamespace(id=1, name="學生", username="student", email="student@example.com")

    class Query:
        def __init__(self, rows):
            self.rows = rows

        def join(self, *args):
            return self

        def filter(self, *args):
            return self

        def all(self):
            return self.rows

    class Db:
        def query(self, model):
            if model is User:
                return Query([student])
            if model is LearningSession:
                return Query(sessions)
            return Query([])

    monkeypatch.setattr(teacher_cross_text, "_check_classroom_access", lambda *_: SimpleNamespace(name="班級"))
    monkeypatch.setattr(teacher_cross_text, "get_lesson_by_id", lambda *_: {"title": "課文"})
    result = teacher_cross_text.get_cross_text_analysis(1, student, Db())

    assert result.sample_count == 1
    assert result.completed_without_score == 1
    assert result.class_score_trend == [{"date": "2026-09-18", "avg_score": 90}]
