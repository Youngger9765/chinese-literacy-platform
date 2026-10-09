"""作業交出去後沒有分數（#3373）。

ReportPage 同一次掛載裡同時發出「交作業」與「計算總分」兩個請求。
`submit_assignment_session` 在交作業那一刻把 `learning_session.overall_score`
複製進 `submission.score`；若計分請求晚到，複製到的是 None，之後算出的總分
也不會回填 —— staging 上已交作業因此幾乎都沒有分數。

不管兩個請求哪一個先到，作業紀錄最後都要拿到那次練習的總分。
"""
from __future__ import annotations

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.models.base import Base
import app.models  # noqa: F401


@pytest.fixture()
def db():
    engine = create_engine("sqlite:///:memory:", connect_args={"check_same_thread": False})
    Base.metadata.create_all(engine)
    session = sessionmaker(bind=engine)()
    try:
        yield session
    finally:
        session.close()
        Base.metadata.drop_all(engine)


def _seed(db):
    from app.models.assignment import Assignment, AssignmentSubmission
    from app.models.school import Classroom, School
    from app.models.session import LearningSession
    from app.models.user import User

    db.add_all([
        User(id=1, email="t@t.com", password_hash="x", name="T", is_active=True),
        User(id=2, email="s@t.com", password_hash="x", name="S", is_active=True),
    ])
    db.flush()
    school = School(name="S")
    db.add(school)
    db.flush()
    classroom = Classroom(name="C", school_id=school.id, teacher_id=1)
    db.add(classroom)
    db.flush()
    assignment = Assignment(classroom_id=classroom.id, teacher_id=1, story_id="1")
    db.add(assignment)
    db.flush()
    sess = LearningSession(student_id=2, classroom_id=classroom.id, story_slug="1",
                           status="in_progress", session_mode="assignment")
    db.add(sess)
    db.flush()
    sub = AssignmentSubmission(assignment_id=assignment.id, student_id=2,
                               status="in_progress", session_id=sess.id)
    db.add(sub)
    db.commit()
    return assignment, sub, sess


def test_submit_before_scoring_still_ends_with_a_score(db):
    """⭐ 交作業先到：當下沒分數，計分完成後作業紀錄必須補上。"""
    from app.services.assignment_session_service import submit_assignment_session
    from app.services.gamification_service import process_session_completion

    assignment, sub, sess = _seed(db)
    submit_assignment_session(assignment, sub, db)
    db.refresh(sub)
    assert sub.score is None  # the race: nothing to copy yet

    process_session_completion(db, student_id=2, session_id=sess.id, comprehension_score=70.0)
    db.refresh(sub)
    assert sub.score == pytest.approx(70.0)


def test_scoring_before_submit_still_works(db):
    from app.services.assignment_session_service import submit_assignment_session
    from app.services.gamification_service import process_session_completion

    assignment, sub, sess = _seed(db)
    process_session_completion(db, student_id=2, session_id=sess.id, comprehension_score=55.0)
    submit_assignment_session(assignment, sub, db)
    db.refresh(sub)
    assert sub.score == pytest.approx(55.0)


def test_backfill_never_overwrites_an_existing_score(db):
    """老師手動評分（graded）或先前已寫入的分數不可以被覆蓋。"""
    from app.services.gamification_service import process_session_completion

    _, sub, sess = _seed(db)
    sub.status = "graded"
    sub.score = 92.0
    db.commit()
    process_session_completion(db, student_id=2, session_id=sess.id, comprehension_score=40.0)
    db.refresh(sub)
    assert sub.score == 92.0
