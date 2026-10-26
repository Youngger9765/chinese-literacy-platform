"""TDD tests for the word-baby pet system DB models (#3780).

Three tables (design: docs/design/word-babies/schema-proposal.md):
- StudentWordBabyState    — which baby a student owns, current stage/dormancy
- StudentFragmentWallet   — per-flavor fragment inventory
- StudentStationRewardLog — idempotency ledger: has (student, lesson, station)
                            already been rolled for a reward?

Pure-schema tests use SQLite in-memory. No route/service logic here.
"""
from __future__ import annotations

import pytest
from sqlalchemy import create_engine, text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import sessionmaker


@pytest.fixture()
def db_session():
    """Isolated in-memory SQLite DB per test (mirrors test_gamification.py)."""
    import app.models  # noqa: F401 — register all model tables
    from app.models.base import Base

    engine = create_engine("sqlite:///:memory:", connect_args={"check_same_thread": False})
    Base.metadata.create_all(engine)
    SessionLocal = sessionmaker(bind=engine)
    session = SessionLocal()
    try:
        yield session
    finally:
        session.close()
        Base.metadata.drop_all(engine)


def _make_user(db_session, user_id: int = 1):
    db_session.execute(
        text(
            "INSERT INTO users (id, email, password_hash, name, is_active, email_verified,"
            " onboarding_completed, created_at, updated_at)"
            " VALUES (:id, :email, 'x', :name, 1, 0, 0,"
            " CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)"
        ),
        {"id": user_id, "email": f"student{user_id}@test.com", "name": f"Student{user_id}"},
    )
    db_session.commit()


class TestStudentWordBabyState:
    def test_can_create_a_row(self, db_session):
        from app.models.word_baby import StudentWordBabyState

        _make_user(db_session, 1)
        row = StudentWordBabyState(
            student_id=1,
            baby_id="wb-001",
            stage_index=1,
            fed_current_stage=0,
            weaken_state="healthy",
        )
        db_session.add(row)
        db_session.commit()

        fetched = db_session.query(StudentWordBabyState).filter_by(student_id=1, baby_id="wb-001").one()
        assert fetched.stage_index == 1
        assert fetched.weaken_state == "healthy"
        assert fetched.dormant_type is None
        assert fetched.duplicate_catch_count == 0
        assert fetched.created_at is not None

    def test_unique_student_baby_pair(self, db_session):
        """Same student can't own the same baby twice (two rows)."""
        from app.models.word_baby import StudentWordBabyState

        _make_user(db_session, 1)
        db_session.add(StudentWordBabyState(student_id=1, baby_id="wb-001", stage_index=1))
        db_session.commit()

        db_session.add(StudentWordBabyState(student_id=1, baby_id="wb-001", stage_index=1))
        with pytest.raises(IntegrityError):
            db_session.commit()

    def test_different_students_can_own_same_baby(self, db_session):
        from app.models.word_baby import StudentWordBabyState

        _make_user(db_session, 1)
        _make_user(db_session, 2)
        db_session.add(StudentWordBabyState(student_id=1, baby_id="wb-001", stage_index=1))
        db_session.add(StudentWordBabyState(student_id=2, baby_id="wb-001", stage_index=1))
        db_session.commit()  # must not raise

        assert db_session.query(StudentWordBabyState).count() == 2


class TestStudentFragmentWallet:
    def test_can_create_a_row(self, db_session):
        from app.models.word_baby import StudentFragmentWallet

        _make_user(db_session, 1)
        row = StudentFragmentWallet(student_id=1, flavor="語文基礎", quantity=3)
        db_session.add(row)
        db_session.commit()

        fetched = db_session.query(StudentFragmentWallet).filter_by(student_id=1, flavor="語文基礎").one()
        assert fetched.quantity == 3

    def test_unique_student_flavor_pair(self, db_session):
        from app.models.word_baby import StudentFragmentWallet

        _make_user(db_session, 1)
        db_session.add(StudentFragmentWallet(student_id=1, flavor="語文基礎", quantity=1))
        db_session.commit()

        db_session.add(StudentFragmentWallet(student_id=1, flavor="語文基礎", quantity=5))
        with pytest.raises(IntegrityError):
            db_session.commit()


class TestStudentStationRewardLog:
    def test_can_create_a_row(self, db_session):
        from app.models.word_baby import StudentStationRewardLog

        _make_user(db_session, 1)
        row = StudentStationRewardLog(
            student_id=1,
            lesson_uid="L0001",
            station="vocab-definition",
            fragment_awarded=True,
            fragment_flavor="語文基礎",
            encounter_result="none",
        )
        db_session.add(row)
        db_session.commit()

        fetched = (
            db_session.query(StudentStationRewardLog)
            .filter_by(student_id=1, lesson_uid="L0001", station="vocab-definition")
            .one()
        )
        assert fetched.fragment_awarded is True
        assert fetched.encounter_result == "none"
        assert fetched.encounter_baby_id is None

    def test_unique_student_lesson_station(self, db_session):
        """This is the idempotency guarantee the whole reward system leans on:
        a station can only ever be rolled once per student."""
        from app.models.word_baby import StudentStationRewardLog

        _make_user(db_session, 1)
        db_session.add(
            StudentStationRewardLog(
                student_id=1, lesson_uid="L0001", station="vocab-definition",
                fragment_awarded=False, encounter_result="none",
            )
        )
        db_session.commit()

        db_session.add(
            StudentStationRewardLog(
                student_id=1, lesson_uid="L0001", station="vocab-definition",
                fragment_awarded=True, encounter_result="caught", encounter_baby_id="wb-050",
            )
        )
        with pytest.raises(IntegrityError):
            db_session.commit()

    def test_same_station_different_lesson_is_allowed(self, db_session):
        """lesson-intro repeats across all 179 lessons — the uniqueness is per
        (student, lesson, station), not per (student, station)."""
        from app.models.word_baby import StudentStationRewardLog

        _make_user(db_session, 1)
        db_session.add(
            StudentStationRewardLog(
                student_id=1, lesson_uid="L0001", station="lesson-intro",
                fragment_awarded=False, encounter_result="none",
            )
        )
        db_session.add(
            StudentStationRewardLog(
                student_id=1, lesson_uid="L0002", station="lesson-intro",
                fragment_awarded=False, encounter_result="none",
            )
        )
        db_session.commit()  # must not raise

        assert db_session.query(StudentStationRewardLog).count() == 2
