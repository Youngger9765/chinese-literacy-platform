"""Regression coverage for issue #3624: league roster scoring must not be N+1."""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

from sqlalchemy import create_engine, event
from sqlalchemy.orm import sessionmaker

import app.models  # noqa: F401
from app.models.base import Base
from app.models.league import LeagueSeason, LeagueTeam, LeagueTeamRosterMember
from app.services import league_scoring
from app.services import league_service
from tests.league_factories import (
    complete_lesson,
    make_classroom,
    make_org,
    make_school,
    make_student,
    make_teacher,
)


NOW = datetime(2026, 10, 15, 12, 0, tzinfo=timezone.utc)
WINDOW_START = NOW - timedelta(days=7)
WINDOW_END = NOW + timedelta(days=7)
WEIGHTS = league_scoring.weights_from_snapshot(
    league_scoring.weights_snapshot_for_version(1)
)


def _count_queries(engine, fn):
    count = 0

    def _before(conn, cursor, statement, parameters, context, executemany):
        nonlocal count
        count += 1

    event.listen(engine, "before_cursor_execute", _before)
    try:
        result = fn()
        return count, result
    finally:
        event.remove(engine, "before_cursor_execute", _before)


def _score_scenario(size: int):
    engine = create_engine("sqlite:///:memory:", connect_args={"check_same_thread": False})
    Base.metadata.create_all(engine)
    session = sessionmaker(bind=engine, expire_on_commit=False)()
    students = [make_student(session) for _ in range(size)]
    for index, student in enumerate(students):
        complete_lesson(
            session,
            student,
            str(100_000 + index),
            started_at=NOW - timedelta(minutes=10),
            completed_at=NOW,
            session_mode="assignment",
        )
        if index % 2 == 0:
            complete_lesson(
                session,
                student,
                str(100_000 + index),
                started_at=NOW - timedelta(minutes=10),
                completed_at=NOW + timedelta(minutes=1),
                session_mode="assignment",
            )
        if index % 3 == 0:
            complete_lesson(
                session,
                student,
                str(300_000 + index),
                started_at=NOW - timedelta(minutes=2),
                completed_at=NOW + timedelta(minutes=2),
                session_mode="assignment",
            )
    session.flush()
    return engine, session, students


def _team_scenario(size: int, *, include_anomalies: bool = False):
    engine = create_engine("sqlite:///:memory:", connect_args={"check_same_thread": False})
    Base.metadata.create_all(engine)
    session = sessionmaker(bind=engine, expire_on_commit=False)()
    org = make_org(session)
    school = make_school(session, org=org)
    teacher = make_teacher(session)
    classroom = make_classroom(session, school, teacher, grade=5)
    students = [make_student(session) for _ in range(size)]
    season = LeagueSeason(
        kind="invitational",
        name="效能測試賽季",
        game_start=WINDOW_START,
        game_end=WINDOW_END,
        weights_snapshot=league_scoring.weights_snapshot_for_version(1),
        created_by=teacher.id,
    )
    session.add(season)
    session.flush()
    team = LeagueTeam(
        season_id=season.id,
        classroom_id=classroom.id,
        grade=5,
        registered_by=teacher.id,
    )
    session.add(team)
    session.flush()
    for index, student in enumerate(students):
        session.add(
            LeagueTeamRosterMember(
                team_id=team.id,
                season_id=season.id,
                student_id=student.id,
            )
        )
        complete_lesson(
            session,
            student,
            str(200_000 + index),
            started_at=NOW - timedelta(minutes=1 if include_anomalies else 10),
            completed_at=NOW,
            session_mode="assignment",
        )
    session.flush()
    return engine, session, season, team, students[0]


def _close(engine, session):
    session.close()
    Base.metadata.drop_all(engine)
    engine.dispose()


def test_bulk_query_count_does_not_grow_with_roster_size():
    small_engine, small_db, small_students = _score_scenario(10)
    big_engine, big_db, big_students = _score_scenario(500)
    try:
        small_count, _ = _count_queries(
            small_engine,
            lambda: league_scoring.compute_student_scores_bulk(
                small_db, [student.id for student in small_students], 5, WINDOW_START, WINDOW_END, WEIGHTS
            ),
        )
        big_count, _ = _count_queries(
            big_engine,
            lambda: league_scoring.compute_student_scores_bulk(
                big_db, [student.id for student in big_students], 5, WINDOW_START, WINDOW_END, WEIGHTS
            ),
        )
        assert small_count == big_count, f"query count grew: {small_count} -> {big_count}"
        assert big_count <= 3
    finally:
        _close(small_engine, small_db)
        _close(big_engine, big_db)


def test_positive_control_old_per_student_loop_still_scales():
    small_engine, small_db, small_students = _score_scenario(10)
    big_engine, big_db, big_students = _score_scenario(500)
    try:
        small_count, _ = _count_queries(
            small_engine,
            lambda: [
                league_scoring.compute_student_score(
                    small_db, student.id, 5, WINDOW_START, WINDOW_END, WEIGHTS
                )
                for student in small_students
            ],
        )
        big_count, _ = _count_queries(
            big_engine,
            lambda: [
                league_scoring.compute_student_score(
                    big_db, student.id, 5, WINDOW_START, WINDOW_END, WEIGHTS
                )
                for student in big_students
            ],
        )
        assert big_count > small_count
        assert big_count >= 400
    finally:
        _close(small_engine, small_db)
        _close(big_engine, big_db)


def test_bulk_scoring_matches_individual_scoring():
    engine, db, students = _score_scenario(12)
    try:
        complete_lesson(
            db,
            students[0],
            "replayed",
            started_at=NOW - timedelta(days=2, minutes=10),
            completed_at=NOW - timedelta(days=2),
            session_mode="assignment",
        )
        complete_lesson(
            db,
            students[0],
            "replayed",
            started_at=NOW - timedelta(minutes=10),
            completed_at=NOW,
            session_mode="assignment",
        )
        complete_lesson(
            db,
            students[1],
            "too-fast",
            started_at=NOW - timedelta(minutes=1),
            completed_at=NOW,
            session_mode="assignment",
        )
        for index in range(5):
            complete_lesson(
                db,
                students[2],
                f"daily-cap-{index}",
                started_at=NOW - timedelta(minutes=20 + index),
                completed_at=NOW - timedelta(minutes=10 + index),
                session_mode="assignment",
            )
        complete_lesson(
            db,
            students[3],
            "outside-window",
            started_at=WINDOW_START - timedelta(days=1, minutes=10),
            completed_at=WINDOW_START - timedelta(days=1),
            session_mode="assignment",
        )
        student_ids = [student.id for student in students]
        bulk = league_scoring.compute_student_scores_bulk(
            db, student_ids, 5, WINDOW_START, WINDOW_END, WEIGHTS
        )
        assert bulk == {
            student_id: league_scoring.compute_student_score(
                db, student_id, 5, WINDOW_START, WINDOW_END, WEIGHTS
            )
            for student_id in student_ids
        }
    finally:
        _close(engine, db)


def test_bulk_scoring_student_with_no_completions():
    engine, db, students = _score_scenario(1)
    no_completion_student = make_student(db)
    db.flush()
    try:
        result = league_scoring.compute_student_scores_bulk(
            db, [students[0].id, no_completion_student.id], 5, WINDOW_START, WINDOW_END, WEIGHTS
        )[no_completion_student.id]
        assert result == league_scoring.ScoreResult(points=0.0, lessons_counted=0, anomalies=[])
    finally:
        _close(engine, db)


def _assert_service_query_count_stays_flat(call):
    small_engine, small_db, small_season, small_team, small_student = _team_scenario(
        10, include_anomalies=True
    )
    big_engine, big_db, big_season, big_team, big_student = _team_scenario(
        250, include_anomalies=True
    )
    try:
        small_count, _ = _count_queries(
            small_engine, lambda: call(small_db, small_season, small_team, small_student)
        )
        big_count, _ = _count_queries(
            big_engine, lambda: call(big_db, big_season, big_team, big_student)
        )
        assert small_count == big_count, f"query count grew: {small_count} -> {big_count}"
    finally:
        _close(small_engine, small_db)
        _close(big_engine, big_db)


def test_get_season_board_query_count_stays_flat():
    _assert_service_query_count_stays_flat(
        lambda db, season, _team, _student: league_service.get_season_board(db, season)
    )


def test_get_my_team_summary_query_count_stays_flat():
    _assert_service_query_count_stays_flat(
        lambda db, season, _team, student: league_service.get_my_team_summary(db, student, season)
    )


def test_get_team_roster_progress_query_count_stays_flat():
    _assert_service_query_count_stays_flat(
        lambda db, season, team, _student: league_service.get_team_roster_progress(db, team, season)
    )


def test_get_team_anomalies_query_count_stays_flat():
    _assert_service_query_count_stays_flat(
        lambda db, season, team, _student: league_service.get_team_anomalies(db, team, season)
    )
