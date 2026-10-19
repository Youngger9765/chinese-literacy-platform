"""TDD for team_arena.engine — assign_teams (auto/swap/override) + claim_lane
(PRD §4/§5/§6, §13 AC2/AC3/AC8)."""
from __future__ import annotations

import pytest
from fastapi import HTTPException

from app.models.team_arena import TeamArenaMember
from app.services.team_arena import engine as svc
from app.services.team_arena.teams import PRIMARY_LANES, SUPPORT_LANE
from league_factories import enroll_student, make_classroom, make_school, make_student, make_teacher


@pytest.fixture()
def db_session():
    from sqlalchemy import create_engine
    from sqlalchemy.orm import sessionmaker

    import app.models  # noqa: F401
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


@pytest.fixture()
def setup(db_session):
    school = make_school(db_session)
    teacher = make_teacher(db_session)
    room = make_classroom(db_session, school, teacher, feature_settings={"team_arena": True})
    db_session.commit()
    students = []
    for _ in range(9):
        s = make_student(db_session)
        enroll_student(db_session, room, s)
        students.append(s)
    db_session.commit()
    session = svc.create_session(
        db_session, teacher, classroom_id=room.id, scope_type="grade_pool", scope_ref="4",
    )
    for s in students:
        svc.join_session(db_session, s, session.code)
    return {"db": db_session, "room": room, "teacher": teacher, "students": students, "session": session}


class TestAssignTeamsAuto:
    def test_creates_members_covering_the_whole_roster(self, setup):
        db, session, teacher = setup["db"], setup["session"], setup["teacher"]
        svc.assign_teams(db, session, teacher, action="auto")
        members = db.query(TeamArenaMember).filter(TeamArenaMember.session_id == session.id).all()
        assert len(members) == 9
        assert {m.student_id for m in members} == {s.id for s in setup["students"]}

    def test_each_team_has_a_locked_rotation_order_permutation(self, setup):
        db, session, teacher = setup["db"], setup["session"], setup["teacher"]
        svc.assign_teams(db, session, teacher, action="auto")
        members = db.query(TeamArenaMember).filter(TeamArenaMember.session_id == session.id).all()
        by_team: dict[tuple, list] = {}
        for m in members:
            by_team.setdefault((m.match_no, m.side), []).append(m)
        for team_members in by_team.values():
            orders = sorted(m.rotation_order for m in team_members)
            assert orders == list(range(len(team_members)))

    def test_requires_lobby_status(self, setup):
        db, session, teacher = setup["db"], setup["session"], setup["teacher"]
        svc.assign_teams(db, session, teacher, action="auto")
        svc.control(db, session, teacher, action="start")
        with pytest.raises(HTTPException) as exc:
            svc.assign_teams(db, session, teacher, action="auto")
        assert exc.value.status_code == 409

    def test_too_few_players_rejected(self, db_session):
        school = make_school(db_session)
        teacher = make_teacher(db_session)
        room = make_classroom(db_session, school, teacher, feature_settings={"team_arena": True})
        db_session.commit()
        for _ in range(2):
            s = make_student(db_session)
            enroll_student(db_session, room, s)
        db_session.commit()
        session = svc.create_session(
            db_session, teacher, classroom_id=room.id, scope_type="grade_pool", scope_ref="4",
        )
        with pytest.raises(HTTPException) as exc:
            svc.assign_teams(db_session, session, teacher, action="auto")
        assert exc.value.status_code == 400


class TestGetStateBeforeStartHasWellFormedTiles:
    """Critic review (slice 3): right after 自動分隊 but before 開始比賽,
    `session.scoreboard["matches"]` doesn't exist yet (only `_start()`
    populates it) — teacher's `/state` poll in that window used to return
    `{}` for every match tile (no towers_down/base_hits/score/match_status
    at all), which crashed the real TeacherTeamArenaHost.tsx component the
    instant it tried to render `team.towers_down[lane]`."""

    def test_teacher_state_has_well_formed_tiles_before_start(self, setup):
        db, session, teacher = setup["db"], setup["session"], setup["teacher"]
        svc.assign_teams(db, session, teacher, action="auto")
        state = svc.get_state(db, session, teacher)
        assert state["matches"], "expected at least one match tile once teams are formed"
        for key, team in state["matches"].items():
            assert team["towers_down"] == {lane: 0 for lane in PRIMARY_LANES}, key
            assert team["base_hits"] == 0, key
            assert team["score"] == 0, key
            assert team["match_status"] == "active", key
            assert team["winner"] is None, key


class TestAssignTeamsSwap:
    def test_swap_exchanges_seats_not_identity(self, setup):
        db, session, teacher, students = setup["db"], setup["session"], setup["teacher"], setup["students"]
        svc.assign_teams(db, session, teacher, action="auto")
        a, b = students[0], students[1]
        member_a_before = db.query(TeamArenaMember).filter_by(session_id=session.id, student_id=a.id).one()
        member_b_before = db.query(TeamArenaMember).filter_by(session_id=session.id, student_id=b.id).one()
        a_seat = (member_a_before.match_no, member_a_before.side, member_a_before.lane)
        b_seat = (member_b_before.match_no, member_b_before.side, member_b_before.lane)

        svc.assign_teams(db, session, teacher, action="swap", student_a_id=a.id, student_b_id=b.id)

        member_a_after = db.query(TeamArenaMember).filter_by(session_id=session.id, student_id=a.id).one()
        member_b_after = db.query(TeamArenaMember).filter_by(session_id=session.id, student_id=b.id).one()
        assert (member_a_after.match_no, member_a_after.side, member_a_after.lane) == b_seat
        assert (member_b_after.match_no, member_b_after.side, member_b_after.lane) == a_seat

    def test_swap_keeps_roster_count_the_same(self, setup):
        db, session, teacher, students = setup["db"], setup["session"], setup["teacher"], setup["students"]
        svc.assign_teams(db, session, teacher, action="auto")
        svc.assign_teams(db, session, teacher, action="swap", student_a_id=students[0].id, student_b_id=students[2].id)
        members = db.query(TeamArenaMember).filter(TeamArenaMember.session_id == session.id).all()
        assert len(members) == 9


class TestAssignTeamsOverride:
    """PRD §5: grade_pool_override 只存在這一場的名單上 (model-level, slice 1
    already proved it defaults False and lives on the row)."""

    def test_sets_the_flag_on_the_targeted_member_only(self, setup):
        db, session, teacher, students = setup["db"], setup["session"], setup["teacher"], setup["students"]
        svc.assign_teams(db, session, teacher, action="auto")
        target = students[0]
        svc.assign_teams(db, session, teacher, action="override", student_id=target.id, grade_pool_override=True)

        members = db.query(TeamArenaMember).filter(TeamArenaMember.session_id == session.id).all()
        flagged = [m for m in members if m.grade_pool_override]
        assert len(flagged) == 1
        assert flagged[0].student_id == target.id


class TestClaimLane:
    def test_student_can_claim_an_unoccupied_lane_on_own_team(self, setup):
        db, session, teacher, students = setup["db"], setup["session"], setup["teacher"], setup["students"]
        svc.assign_teams(db, session, teacher, action="auto")
        member = db.query(TeamArenaMember).filter_by(session_id=session.id, student_id=students[0].id).one()
        teammate_lanes = {
            m.lane
            for m in db.query(TeamArenaMember).filter_by(
                session_id=session.id, match_no=member.match_no, side=member.side
            ).all()
            if m.student_id != students[0].id
        }
        free_lane = next(lane for lane in PRIMARY_LANES if lane not in teammate_lanes)
        svc.claim_lane(db, session, students[0], free_lane)
        db.refresh(member)
        assert member.lane == free_lane

    def test_claiming_a_teammates_lane_is_rejected(self, setup):
        db, session, teacher, students = setup["db"], setup["session"], setup["teacher"], setup["students"]
        svc.assign_teams(db, session, teacher, action="auto")
        member = db.query(TeamArenaMember).filter_by(session_id=session.id, student_id=students[0].id).one()
        teammate = next(
            m
            for m in db.query(TeamArenaMember).filter_by(
                session_id=session.id, match_no=member.match_no, side=member.side
            ).all()
            if m.student_id != students[0].id
        )
        with pytest.raises(HTTPException) as exc:
            svc.claim_lane(db, session, students[0], teammate.lane)
        assert exc.value.status_code == 409

    def test_lane_locks_once_session_started(self, setup):
        db, session, teacher, students = setup["db"], setup["session"], setup["teacher"], setup["students"]
        svc.assign_teams(db, session, teacher, action="auto")
        svc.control(db, session, teacher, action="start")
        with pytest.raises(HTTPException) as exc:
            svc.claim_lane(db, session, students[0], "zhuyin")
        assert exc.value.status_code == 409

    def test_rotation_order_recomputed_after_lane_change(self, setup):
        db, session, teacher, students = setup["db"], setup["session"], setup["teacher"], setup["students"]
        svc.assign_teams(db, session, teacher, action="auto")
        member = db.query(TeamArenaMember).filter_by(session_id=session.id, student_id=students[0].id).one()
        teammates = db.query(TeamArenaMember).filter_by(
            session_id=session.id, match_no=member.match_no, side=member.side
        ).all()
        teammate_lanes = {m.lane for m in teammates if m.student_id != students[0].id}
        free_lane = next(lane for lane in PRIMARY_LANES if lane not in teammate_lanes)
        svc.claim_lane(db, session, students[0], free_lane)

        refreshed = db.query(TeamArenaMember).filter_by(
            session_id=session.id, match_no=member.match_no, side=member.side
        ).all()
        orders = sorted(m.rotation_order for m in refreshed)
        assert orders == list(range(len(refreshed)))
