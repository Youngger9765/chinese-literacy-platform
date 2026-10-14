"""League API — cross-class invitational seasons, class-average boards,
the student-facing "my team" summary, and 讀家記憶 history.

Authorization model (PRD §10/§11, Young 2026-10-15 — deliberately STRICTER
than the rest of this codebase's `require_classroom_owner`, which also
allows org_admin): every classroom-scoped write in this file checks
`current_user.id == classroom.teacher_id` directly (system_admin still
bypasses for ops) — co-teachers (assistants) and org_admin are EXCLUDED.
This is a narrower, more sensitive action than ordinary classroom admin
viewing, so it gets a narrower check. See `_require_owner_strict` below.
"""
from __future__ import annotations

import logging
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy.orm import Session

from ..auth.dependencies import get_current_user
from ..auth.policies import is_system_admin
from ..database import get_db
from ..models.league import LeagueSeason, LeagueTeam, LeagueTeamRosterMember
from ..models.school import Classroom, ClassroomStudent
from ..models.user import User
from ..services import league_service as svc
from .classrooms import _get_classroom_or_404

router = APIRouter(prefix="/league", tags=["league"])
logger = logging.getLogger(__name__)


def _require_owner_strict(classroom: Classroom, user: User, db: Session) -> None:
    if user.id == classroom.teacher_id:
        return
    if is_system_admin(user.id, db):
        return
    raise HTTPException(status_code=403, detail="僅班級擁有者可以執行此操作")


def _handle_league_error(exc: svc.LeagueError) -> HTTPException:
    return HTTPException(status_code=exc.status_code, detail=exc.message)


def _get_season_or_404(season_id: int, db: Session) -> LeagueSeason:
    season = db.query(LeagueSeason).filter(LeagueSeason.id == season_id).first()
    if season is None:
        raise HTTPException(status_code=404, detail="Season not found")
    return season


def _require_season_member(season: LeagueSeason, user: User, db: Session) -> None:
    """Either a team-classroom's owner, OR an enrolled student on one of
    the season's locked rosters, OR system_admin. This is intentionally
    broader than `_require_owner_strict` — the board/summary endpoints are
    read-only classroom-level aggregates (see routes docstring + PRD §6),
    so any legitimate participant on EITHER side may view them.
    """
    if is_system_admin(user.id, db):
        return
    team_classroom_ids = [t.classroom_id for t in season.teams]
    if team_classroom_ids:
        owner_match = (
            db.query(Classroom)
            .filter(Classroom.id.in_(team_classroom_ids), Classroom.teacher_id == user.id)
            .first()
        )
        if owner_match is not None:
            return
    roster_match = (
        db.query(LeagueTeamRosterMember)
        .filter(LeagueTeamRosterMember.season_id == season.id, LeagueTeamRosterMember.student_id == user.id)
        .first()
    )
    if roster_match is not None:
        return
    raise HTTPException(status_code=403, detail="Access denied")


# ── Schemas ───────────────────────────────────────────────────────────────────


class CreateInvitationRequest(BaseModel):
    inviter_classroom_id: int
    inviter_team_grade: int
    game_start: datetime
    game_end: datetime
    weights_version: int = svc.DEFAULT_WEIGHTS_VERSION


class InvitationResponse(BaseModel):
    id: int
    code: str
    inviter_classroom_id: int
    invitee_classroom_id: int | None
    status: str
    game_start: str
    game_end: str

    @classmethod
    def from_model(cls, inv) -> "InvitationResponse":
        return cls(
            id=inv.id,
            code=inv.code,
            inviter_classroom_id=inv.inviter_classroom_id,
            invitee_classroom_id=inv.invitee_classroom_id,
            status=inv.status,
            game_start=inv.game_start.isoformat(),
            game_end=inv.game_end.isoformat(),
        )


class AcceptInvitationRequest(BaseModel):
    invitee_classroom_id: int
    invitee_team_grade: int


# ── Invitations ───────────────────────────────────────────────────────────────


@router.post("/invitations", status_code=201, response_model=InvitationResponse)
def create_invitation(
    payload: CreateInvitationRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> InvitationResponse:
    classroom = _get_classroom_or_404(payload.inviter_classroom_id, db)
    _require_owner_strict(classroom, current_user, db)
    try:
        invitation = svc.create_invitation(
            db,
            creator=current_user,
            inviter_classroom=classroom,
            inviter_team_grade=payload.inviter_team_grade,
            game_start=payload.game_start,
            game_end=payload.game_end,
            weights_version=payload.weights_version,
        )
    except svc.LeagueError as exc:
        raise _handle_league_error(exc)
    return InvitationResponse.from_model(invitation)


@router.get("/invitations", response_model=list[InvitationResponse])
def list_invitations(
    classroom_id: int = Query(...),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> list[InvitationResponse]:
    classroom = _get_classroom_or_404(classroom_id, db)
    _require_owner_strict(classroom, current_user, db)
    invitations = svc.list_invitations_for_classroom(db, classroom_id)
    return [InvitationResponse.from_model(inv) for inv in invitations]


@router.get("/invitations/{code}/preview")
def preview_invitation(
    code: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict:
    """What an invitee sees before deciding accept/decline. No ownership
    check — any authenticated user who HAS the code (shared out-of-band)
    may preview it; the code itself (8 chars, 32-symbol alphabet) is the
    secret, not classroom membership."""
    try:
        return svc.preview_invitation(db, code)
    except svc.LeagueError as exc:
        raise _handle_league_error(exc)


@router.post("/invitations/{code}/accept", response_model=InvitationResponse)
def accept_invitation(
    code: str,
    payload: AcceptInvitationRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> InvitationResponse:
    classroom = _get_classroom_or_404(payload.invitee_classroom_id, db)
    _require_owner_strict(classroom, current_user, db)
    try:
        invitation = svc.accept_invitation(
            db,
            code=code,
            acceptor=current_user,
            invitee_classroom=classroom,
            invitee_team_grade=payload.invitee_team_grade,
        )
    except svc.LeagueError as exc:
        raise _handle_league_error(exc)
    return InvitationResponse.from_model(invitation)


@router.post("/invitations/{code}/decline", response_model=InvitationResponse)
def decline_invitation(
    code: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> InvitationResponse:
    invitation = svc.get_invitation_by_code(db, code)
    if invitation is None:
        raise HTTPException(status_code=404, detail="Invitation not found")
    try:
        updated = svc.decline_invitation(db, invitation=invitation, responder=current_user)
    except svc.LeagueError as exc:
        raise _handle_league_error(exc)
    return InvitationResponse.from_model(updated)


@router.post("/invitations/{invitation_id}/revoke", response_model=InvitationResponse)
def revoke_invitation(
    invitation_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> InvitationResponse:
    from ..models.league import LeagueInvitation

    invitation = db.query(LeagueInvitation).filter(LeagueInvitation.id == invitation_id).first()
    if invitation is None:
        raise HTTPException(status_code=404, detail="Invitation not found")
    inviter_classroom = _get_classroom_or_404(invitation.inviter_classroom_id, db)
    _require_owner_strict(inviter_classroom, current_user, db)
    try:
        updated = svc.revoke_invitation(db, invitation)
    except svc.LeagueError as exc:
        raise _handle_league_error(exc)
    return InvitationResponse.from_model(updated)


# ── Seasons / boards ──────────────────────────────────────────────────────────


@router.get("/classrooms/{classroom_id}/seasons")
def list_classroom_seasons(
    classroom_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> list[dict]:
    classroom = _get_classroom_or_404(classroom_id, db)
    _require_owner_strict(classroom, current_user, db)
    teams = db.query(LeagueTeam).filter(LeagueTeam.classroom_id == classroom_id).all()
    out = []
    for team in teams:
        season = db.query(LeagueSeason).filter(LeagueSeason.id == team.season_id).first()
        out.append(
            {
                "season_id": season.id,
                "name": season.name,
                "game_start": season.game_start.isoformat(),
                "game_end": season.game_end.isoformat(),
                "is_finalized": season.result_snapshot is not None,
            }
        )
    return out


@router.get("/seasons/{season_id}/board")
def get_season_board(
    season_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict:
    season = _get_season_or_404(season_id, db)
    _require_season_member(season, current_user, db)
    board = svc.get_season_board_cached(db, season)
    return {"season_id": season.id, "season_name": season.name, "board": board}


@router.get("/seasons/{season_id}/my-summary")
def get_my_season_summary(
    season_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict:
    season = _get_season_or_404(season_id, db)
    try:
        return svc.get_my_team_summary(db, current_user, season)
    except svc.LeagueError as exc:
        raise _handle_league_error(exc)


@router.get("/seasons/{season_id}/teams/{team_id}/roster")
def get_team_roster_progress(
    season_id: int,
    team_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> list[dict]:
    """Teacher-only (that team's owning classroom): per-student participation,
    尚未參與 first, for the ClassroomTabs "班級賽" progress tab (PRD §10)."""
    season = _get_season_or_404(season_id, db)
    team = db.query(LeagueTeam).filter(LeagueTeam.id == team_id, LeagueTeam.season_id == season_id).first()
    if team is None:
        raise HTTPException(status_code=404, detail="Team not found")
    classroom = _get_classroom_or_404(team.classroom_id, db)
    _require_owner_strict(classroom, current_user, db)

    rows = svc.get_team_roster_progress(db, team, season)
    student_ids = [r["student_id"] for r in rows]
    names = {
        u.id: u.name for u in db.query(User).filter(User.id.in_(student_ids)).all()
    } if student_ids else {}
    return [
        {
            "student_id": r["student_id"],
            "student_name": names.get(r["student_id"], ""),
            "points": r["points"],
            "participated": r["participated"],
        }
        for r in rows
    ]


@router.get("/seasons/{season_id}/teams/{team_id}/anomalies")
def get_team_anomalies(
    season_id: int,
    team_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> list[dict]:
    """Teacher-only (that team's owning classroom): per-student anomaly
    flags, with real student names resolved — same visibility precedent as
    the existing classroom leaderboard (a teacher already has legitimate
    access to their own students' names)."""
    season = _get_season_or_404(season_id, db)
    team = db.query(LeagueTeam).filter(LeagueTeam.id == team_id, LeagueTeam.season_id == season_id).first()
    if team is None:
        raise HTTPException(status_code=404, detail="Team not found")
    classroom = _get_classroom_or_404(team.classroom_id, db)
    _require_owner_strict(classroom, current_user, db)

    anomalies = svc.get_team_anomalies(db, team, season)
    student_ids = [a["student_id"] for a in anomalies]
    names = {
        u.id: u.name
        for u in db.query(User).filter(User.id.in_(student_ids)).all()
    } if student_ids else {}
    return [
        {"student_id": a["student_id"], "student_name": names.get(a["student_id"], ""), "anomalies": a["anomalies"]}
        for a in anomalies
    ]


# ── 讀家記憶 ───────────────────────────────────────────────────────────────────


@router.get("/my-history")
def get_my_history(
    student_id: int | None = Query(None),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> list[dict]:
    """Own history by default. A parent may pass `student_id` to view a
    LINKED child's history (one extra tile, PRD §10 UIUX: "no rank") — the
    existing parent-link check (same one routes/parents.py uses) gates it,
    so a parent can only ever see their own linked child, never anyone
    else's."""
    subject = current_user
    if student_id is not None and student_id != current_user.id:
        from .parents import _require_parent_link

        _require_parent_link(current_user, student_id, db)
        subject = db.query(User).filter(User.id == student_id).first()
        if subject is None:
            raise HTTPException(status_code=404, detail="Student not found")

    seasons = svc.list_my_seasons(db, subject)
    history = []
    for season in seasons:
        try:
            summary = svc.get_my_team_summary(db, subject, season)
        except svc.LeagueError:
            continue
        history.append(summary)
    return history
