"""League service layer — invite codes, acceptance, team registration with
locked rosters, class-average boards, season results, and the
student-facing "my team" summary / 讀家記憶 history.

Authorization (who's allowed to call what) lives in routes/league.py — this
module enforces only the domain rules that don't depend on WHO is calling
(same-org, no self-invite, valid window) plus the one cross-cutting rule
that's cheap to double-enforce here too: the inviter/acceptor really is the
owning teacher of their respective classroom (defense in depth; the route
checks this first).

See docs/prd/2026-10-14-chinese-star-league-prd.md §7/§10/§11.
"""
from __future__ import annotations

import secrets
from datetime import datetime, timezone

from sqlalchemy.orm import Session

from ..models.league import (
    INVITATION_ACCEPTED,
    INVITATION_DECLINED,
    INVITATION_EXPIRED,
    INVITATION_PENDING,
    INVITATION_REVOKED,
    SEASON_INVITATIONAL,
    LeagueInvitation,
    LeagueSeason,
    LeagueTeam,
    LeagueTeamRosterMember,
)
from ..models.school import Classroom, ClassroomStudent, School
from ..models.user import User
from .league_scoring import (
    LEAGUE_WEIGHTS_BY_VERSION,
    compute_student_score,
    weights_from_snapshot,
    weights_snapshot_for_version,
)

DEFAULT_WEIGHTS_VERSION = 1
_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"  # no 0/O/1/I — avoids transcription errors
_CODE_LENGTH = 8


class LeagueError(Exception):
    """Domain validation failure. routes/league.py maps this to an HTTPException."""

    def __init__(self, message: str, status_code: int = 400):
        super().__init__(message)
        self.message = message
        self.status_code = status_code


def _ensure_aware(dt: datetime) -> datetime:
    """Normalize a datetime read back from the DB to UTC-aware (SQLite has
    no native tz-aware datetime type; Postgres preserves it)."""
    if dt.tzinfo is None:
        return dt.replace(tzinfo=timezone.utc)
    return dt


def _require_same_org(db: Session, classroom_a: Classroom, classroom_b: Classroom) -> None:
    """Same-org-only by default. Either side missing an org, or the two
    orgs differing, is denied (PRD §7/§10: "org NULL → deny")."""
    school_a = db.query(School).filter(School.id == classroom_a.school_id).first()
    school_b = db.query(School).filter(School.id == classroom_b.school_id).first()
    org_a = school_a.organization_id if school_a else None
    org_b = school_b.organization_id if school_b else None
    if org_a is None or org_b is None or org_a != org_b:
        raise LeagueError("跨機構（跨校）邀請目前不開放，僅限同機構班級互相邀請", status_code=403)


def _generate_unique_code(db: Session, *, max_attempts: int = 20) -> str:
    for _ in range(max_attempts):
        code = "".join(secrets.choice(_CODE_ALPHABET) for _ in range(_CODE_LENGTH))
        exists = db.query(LeagueInvitation).filter(LeagueInvitation.code == code).first()
        if exists is None:
            return code
    raise LeagueError("無法產生唯一邀請碼，請重新嘗試", status_code=500)


# ── Invitation lifecycle ──────────────────────────────────────────────────────


def create_invitation(
    db: Session,
    *,
    creator: User,
    inviter_classroom: Classroom,
    inviter_team_grade: int,
    game_start: datetime,
    game_end: datetime,
    weights_version: int = DEFAULT_WEIGHTS_VERSION,
) -> LeagueInvitation:
    if creator.id != inviter_classroom.teacher_id:
        raise LeagueError("僅班級擁有者可以發出邀請", status_code=403)
    if game_end <= game_start:
        raise LeagueError("比賽結束時間必須晚於開始時間", status_code=400)
    if weights_version not in LEAGUE_WEIGHTS_BY_VERSION:
        raise LeagueError(f"未知的計分規則版本：{weights_version}", status_code=400)

    invitation = LeagueInvitation(
        code=_generate_unique_code(db),
        inviter_classroom_id=inviter_classroom.id,
        created_by=creator.id,
        status=INVITATION_PENDING,
        inviter_team_grade=inviter_team_grade,
        game_start=game_start,
        game_end=game_end,
        weights_version=weights_version,
    )
    db.add(invitation)
    db.commit()
    db.refresh(invitation)
    return invitation


def get_invitation_by_code(db: Session, code: str) -> LeagueInvitation | None:
    return db.query(LeagueInvitation).filter(LeagueInvitation.code == code).first()


def preview_invitation(db: Session, code: str, *, now: datetime | None = None) -> dict:
    """What an invitee teacher sees BEFORE deciding accept/decline — just
    enough to decide, nothing that identifies a person. Classroom NAME is
    fine (PRD §6: both sides already know who they're matched with once
    they have the code); the inviter's TEACHER NAME is not included.
    """
    now = _ensure_aware(now) if now else datetime.now(timezone.utc)
    invitation = db.query(LeagueInvitation).filter(LeagueInvitation.code == code).first()
    if invitation is None:
        raise LeagueError("邀請碼不存在", status_code=404)

    status = invitation.status
    if status == INVITATION_PENDING and now >= _ensure_aware(invitation.game_start):
        status = INVITATION_EXPIRED

    return {
        "code": invitation.code,
        "status": status,
        "inviter_classroom_name": invitation.inviter_classroom.name,
        "inviter_team_grade": invitation.inviter_team_grade,
        "game_start": invitation.game_start.isoformat(),
        "game_end": invitation.game_end.isoformat(),
    }


def revoke_invitation(db: Session, invitation: LeagueInvitation) -> LeagueInvitation:
    """The inviter cancels a still-pending proposal. Only valid while pending."""
    if invitation.status != INVITATION_PENDING:
        raise LeagueError(
            f"這個邀請已經是「{invitation.status}」狀態，無法撤回", status_code=409
        )
    invitation.status = INVITATION_REVOKED
    db.commit()
    db.refresh(invitation)
    return invitation


def list_invitations_for_classroom(
    db: Session, classroom_id: int, *, now: datetime | None = None
) -> list[LeagueInvitation]:
    now = _ensure_aware(now) if now else datetime.now(timezone.utc)
    rows = (
        db.query(LeagueInvitation)
        .filter(
            (LeagueInvitation.inviter_classroom_id == classroom_id)
            | (LeagueInvitation.invitee_classroom_id == classroom_id)
        )
        .order_by(LeagueInvitation.created_at.desc())
        .all()
    )
    changed = False
    for inv in rows:
        if inv.status == INVITATION_PENDING and now >= _ensure_aware(inv.game_start):
            inv.status = INVITATION_EXPIRED
            changed = True
    if changed:
        db.commit()
    return rows


def _lock_invitation(db: Session, invitation_id: int) -> LeagueInvitation | None:
    """Load the invitation row WITH FOR UPDATE so a concurrent accept can't
    race past the status check (Postgres; SQLite ignores the lock but the
    logic is still correct for a single-process test)."""
    return (
        db.query(LeagueInvitation)
        .filter(LeagueInvitation.id == invitation_id)
        .with_for_update()
        .first()
    )


def accept_invitation(
    db: Session,
    *,
    code: str,
    acceptor: User,
    invitee_classroom: Classroom,
    invitee_team_grade: int,
    now: datetime | None = None,
) -> LeagueInvitation:
    now = _ensure_aware(now) if now else datetime.now(timezone.utc)

    invitation = db.query(LeagueInvitation).filter(LeagueInvitation.code == code).first()
    if invitation is None:
        raise LeagueError("邀請碼不存在", status_code=404)

    # Row-locked re-read so a second, concurrent accept call sees the
    # just-committed state instead of racing past the pending check.
    invitation = _lock_invitation(db, invitation.id)

    # Double-accept is idempotent when it's the SAME classroom re-accepting
    # (e.g. a retried request) — return the existing result unchanged. A
    # DIFFERENT classroom trying to redeem an already-used code is rejected:
    # a code is single-use once it has a season behind it.
    if invitation.status == INVITATION_ACCEPTED:
        if invitation.invitee_classroom_id == invitee_classroom.id:
            return invitation
        raise LeagueError("這組邀請碼已經被使用", status_code=409)

    if acceptor.id != invitee_classroom.teacher_id:
        raise LeagueError("僅班級擁有者可以接受邀請", status_code=403)

    if invitation.status == INVITATION_PENDING and now >= _ensure_aware(invitation.game_start):
        invitation.status = INVITATION_EXPIRED
        db.commit()
        db.refresh(invitation)

    if invitation.status != INVITATION_PENDING:
        raise LeagueError(
            f"這組邀請碼已經是「{invitation.status}」狀態，無法使用", status_code=409
        )

    if invitation.inviter_classroom_id == invitee_classroom.id:
        raise LeagueError("不能邀請自己的班級", status_code=400)

    _require_same_org(db, invitation.inviter_classroom, invitee_classroom)

    invitation.invitee_classroom_id = invitee_classroom.id
    invitation.status = INVITATION_ACCEPTED
    invitation.responded_by = acceptor.id
    invitation.responded_at = now

    season = LeagueSeason(
        kind=SEASON_INVITATIONAL,
        name=f"跨班邀請賽：{invitation.inviter_classroom.name} vs {invitee_classroom.name}",
        invitation_id=invitation.id,
        game_start=invitation.game_start,
        game_end=invitation.game_end,
        weights_snapshot=weights_snapshot_for_version(invitation.weights_version),
        created_by=invitation.created_by,
    )
    db.add(season)
    db.flush()  # need season.id before creating teams

    _register_team(
        db, season, invitation.inviter_classroom_id, invitation.inviter_team_grade,
        registered_by=invitation.created_by,
    )
    _register_team(
        db, season, invitee_classroom.id, invitee_team_grade, registered_by=acceptor.id
    )

    db.commit()
    db.refresh(invitation)
    return invitation


def decline_invitation(
    db: Session, *, invitation: LeagueInvitation, responder: User, now: datetime | None = None
) -> LeagueInvitation:
    now = _ensure_aware(now) if now else datetime.now(timezone.utc)
    invitation = _lock_invitation(db, invitation.id)

    if invitation.status == INVITATION_PENDING and now >= _ensure_aware(invitation.game_start):
        invitation.status = INVITATION_EXPIRED
        db.commit()
        db.refresh(invitation)

    if invitation.status != INVITATION_PENDING:
        raise LeagueError(
            f"這個邀請已經是「{invitation.status}」狀態，無法再回應", status_code=409
        )

    invitation.status = INVITATION_DECLINED
    invitation.responded_by = responder.id
    invitation.responded_at = now
    db.commit()
    db.refresh(invitation)
    return invitation


def _register_team(
    db: Session, season: LeagueSeason, classroom_id: int, grade: int, *, registered_by: int
) -> LeagueTeam:
    team = LeagueTeam(
        season_id=season.id, classroom_id=classroom_id, grade=grade, registered_by=registered_by
    )
    db.add(team)
    db.flush()

    student_ids = [
        r[0]
        for r in db.query(ClassroomStudent.student_id)
        .filter(ClassroomStudent.classroom_id == classroom_id)
        .all()
    ]
    for sid in student_ids:
        db.add(LeagueTeamRosterMember(team_id=team.id, season_id=season.id, student_id=sid))
    db.flush()
    return team


# ── Boards / results ─────────────────────────────────────────────────────────


def get_season_board(db: Session, season: LeagueSeason) -> list[dict]:
    """Class-average board — classroom-level aggregates only, no per-student
    rows (PRD §6/§10: students never see classmates' individual scores;
    team identity is the only thing cross-class visible).
    """
    weights = weights_from_snapshot(season.weights_snapshot)
    game_start = _ensure_aware(season.game_start)
    game_end = _ensure_aware(season.game_end)

    rows = []
    for team in season.teams:
        classroom = db.query(Classroom).filter(Classroom.id == team.classroom_id).first()
        roster = (
            db.query(LeagueTeamRosterMember)
            .filter(LeagueTeamRosterMember.team_id == team.id)
            .all()
        )
        roster_size = len(roster)
        if roster_size == 0:
            average, participants = 0.0, 0
        else:
            results = [
                compute_student_score(db, m.student_id, team.grade, game_start, game_end, weights)
                for m in roster
            ]
            average = sum(r.points for r in results) / roster_size
            participants = sum(1 for r in results if r.points > 0)

        participation_ratio = (participants / roster_size) if roster_size else 0.0
        rows.append(
            {
                "team_id": team.id,
                "classroom_id": classroom.id,
                "classroom_name": classroom.name,
                "grade": team.grade,
                "roster_size": roster_size,
                "participant_count": participants,
                "average_points": average,
                "team_badge_earned": average >= weights.badge_threshold,
                "treasure_chest_eligible": participation_ratio
                >= weights.treasure_chest_participation_ratio,
            }
        )

    rows.sort(key=lambda r: (-r["average_points"], r["classroom_id"]))
    for i, row in enumerate(rows):
        row["rank"] = i + 1
    return rows


def finalize_season_if_ended(
    db: Session, season: LeagueSeason, *, now: datetime | None = None
) -> LeagueSeason:
    """Freeze the board into `result_snapshot` once game_end has passed.
    Idempotent: a season that already has a snapshot is never recomputed
    (PRD §10 CTO #8 — a live learning_sessions row can be edited/deleted
    later; the snapshot is what keeps a finished season's published result
    from drifting)."""
    if season.result_snapshot is not None:
        return season
    now = _ensure_aware(now) if now else datetime.now(timezone.utc)
    if now < _ensure_aware(season.game_end):
        return season
    board = get_season_board(db, season)
    season.result_snapshot = {"computed_at": now.isoformat(), "board": board}
    db.commit()
    db.refresh(season)
    return season


def get_season_board_cached(
    db: Session, season: LeagueSeason, *, now: datetime | None = None
) -> list[dict]:
    season = finalize_season_if_ended(db, season, now=now)
    if season.result_snapshot is not None:
        return season.result_snapshot["board"]
    return get_season_board(db, season)


# ── Student-facing: my team summary, 讀家記憶 history ───────────────────────


def get_my_team_summary(db: Session, student: User, season: LeagueSeason) -> dict:
    """Student-facing per-season summary: own points + class aggregate only
    — never another classmate's individual score (PRD §10 UIUX)."""
    membership = (
        db.query(LeagueTeamRosterMember)
        .filter(
            LeagueTeamRosterMember.season_id == season.id,
            LeagueTeamRosterMember.student_id == student.id,
        )
        .first()
    )
    if membership is None:
        raise LeagueError("你不在這個賽季的任何隊伍中", status_code=404)

    team = db.query(LeagueTeam).filter(LeagueTeam.id == membership.team_id).first()
    weights = weights_from_snapshot(season.weights_snapshot)
    game_start = _ensure_aware(season.game_start)
    game_end = _ensure_aware(season.game_end)

    roster = (
        db.query(LeagueTeamRosterMember)
        .filter(LeagueTeamRosterMember.team_id == team.id)
        .all()
    )
    all_results = [
        compute_student_score(db, m.student_id, team.grade, game_start, game_end, weights)
        for m in roster
    ]
    my_result = compute_student_score(
        db, student.id, team.grade, game_start, game_end, weights
    )
    roster_size = len(roster)
    participants = sum(1 for r in all_results if r.points > 0)
    average = sum(r.points for r in all_results) / roster_size if roster_size else 0.0

    return {
        "season_id": season.id,
        "season_name": season.name,
        "my_points": my_result.points,
        "my_lessons_counted": my_result.lessons_counted,
        "individual_badge_earned": my_result.points >= weights.badge_threshold,
        "class_average_points": average,
        "class_badge_earned": average >= weights.badge_threshold,
        "participant_count": participants,
        "roster_size": roster_size,
    }


def list_my_seasons(db: Session, student: User) -> list[LeagueSeason]:
    season_ids = [
        r[0]
        for r in db.query(LeagueTeamRosterMember.season_id)
        .filter(LeagueTeamRosterMember.student_id == student.id)
        .distinct()
        .all()
    ]
    if not season_ids:
        return []
    return (
        db.query(LeagueSeason)
        .filter(LeagueSeason.id.in_(season_ids))
        .order_by(LeagueSeason.game_start.desc())
        .all()
    )


# ── Teacher-only: anomaly list ───────────────────────────────────────────────


def get_team_roster_progress(db: Session, team: LeagueTeam, season: LeagueSeason) -> list[dict]:
    """Per-student participation for the teacher's own team — PRD §10 UIUX:
    the ClassroomTabs "班級賽" progress tab lists 尚未參與 (not yet
    participated) FIRST, in neutral grey, teacher-only. Includes student_id
    so the route can resolve real names (teacher already has legitimate
    access to their own students, same precedent as get_team_anomalies).
    """
    weights = weights_from_snapshot(season.weights_snapshot)
    game_start = _ensure_aware(season.game_start)
    game_end = _ensure_aware(season.game_end)
    roster = (
        db.query(LeagueTeamRosterMember)
        .filter(LeagueTeamRosterMember.team_id == team.id)
        .all()
    )
    rows = []
    for member in roster:
        result = compute_student_score(
            db, member.student_id, team.grade, game_start, game_end, weights
        )
        rows.append(
            {
                "student_id": member.student_id,
                "points": result.points,
                "participated": result.points > 0,
            }
        )
    # Not-yet-participated first (PRD §10), then by points descending within each group.
    rows.sort(key=lambda r: (r["participated"], -r["points"]))
    return rows


def get_team_anomalies(db: Session, team: LeagueTeam, season: LeagueSeason) -> list[dict]:
    """Per-student anomaly flags for one team — teacher-of-that-team only
    (enforced in routes/league.py). Includes student_id so the route can
    resolve it to a name the teacher already has legitimate access to
    (same precedent as the existing classroom leaderboard)."""
    weights = weights_from_snapshot(season.weights_snapshot)
    game_start = _ensure_aware(season.game_start)
    game_end = _ensure_aware(season.game_end)
    roster = (
        db.query(LeagueTeamRosterMember)
        .filter(LeagueTeamRosterMember.team_id == team.id)
        .all()
    )
    out = []
    for member in roster:
        result = compute_student_score(
            db, member.student_id, team.grade, game_start, game_end, weights
        )
        if result.anomalies:
            out.append(
                {
                    "student_id": member.student_id,
                    "anomalies": [
                        {"story_slug": a.story_slug, "reason": a.reason} for a in result.anomalies
                    ],
                }
            )
    return out
