"""League — 跨班邀請賽（MVP）＋賽季／班級報名／讀家記憶的底層資料。

See docs/prd/2026-10-14-chinese-star-league-prd.md §7/§10/§11 (CTO + UIUX
review, 2026-10-15) for the design. Four tables, matching exactly what the
MVP needs (no personal-leaderboard nickname table this phase — §10/§11
deferred personal ranking + nicknames to a later phase pending 方大哥's
ranking-policy sign-off):

- LeagueInvitation        — a one-time invite code a classroom owner creates;
                             NOT addressed at a specific classroom up front
                             (CTO #7: listing every classroom in an org to
                             pick a target would itself leak class/teacher
                             names) — the invitee enters the code and picks
                             which of THEIR OWN classrooms to register.
- LeagueSeason            — a scoring period. MVP only ever creates
                             kind="invitational" (exactly 2 teams, from one
                             accepted invitation); kind="official" is
                             schema-reserved for Phase 2+, not created here.
- LeagueTeam              — one classroom's registration into a season.
                             `grade` is entered by the teacher AT
                             REGISTRATION (CTO #2: Text.grade is unreliable
                             for v2-renumbered lessons, so the anti-farming
                             grade floor is computed against the TEAM's
                             declared grade, not a column read off the text).
- LeagueTeamRosterMember  — the roster LOCKED at registration time.
                             UNIQUE(season_id, student_id): a student can
                             only be on ONE team per season (CTO #6).

Scoring itself (services/league_scoring.py) reads ONLY the already-merged
`LearningSession` table (completed_at/started_at/session_mode/story_slug) —
see that module's docstring for why the CTO review moved scoring off the XP
ledger and off `Text.grade`.
"""
from datetime import datetime

from sqlalchemy import (
    DateTime,
    ForeignKey,
    Integer,
    JSON,
    String,
    UniqueConstraint,
    func,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .base import Base

# Valid LeagueInvitation.status values.
INVITATION_PENDING = "pending"
INVITATION_ACCEPTED = "accepted"
INVITATION_DECLINED = "declined"
INVITATION_EXPIRED = "expired"
INVITATION_REVOKED = "revoked"

# Valid LeagueSeason.kind values.
SEASON_INVITATIONAL = "invitational"
SEASON_OFFICIAL = "official"


class LeagueInvitation(Base):
    """A one-time invite code created by a classroom owner.

    Lifecycle: pending -> accepted | declined | expired | revoked.
    `invitee_classroom_id` is NULL until someone redeems the code (accept
    is what assigns it — see services/league_service.py:accept_invitation).
    Accepting creates exactly one LeagueSeason(kind="invitational") plus one
    LeagueTeam per classroom, each with a locked roster.
    """

    __tablename__ = "league_invitations"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    code: Mapped[str] = mapped_column(String(12), unique=True, nullable=False, index=True)
    inviter_classroom_id: Mapped[int] = mapped_column(
        ForeignKey("classrooms.id", ondelete="CASCADE"), nullable=False, index=True
    )
    invitee_classroom_id: Mapped[int | None] = mapped_column(
        ForeignKey("classrooms.id", ondelete="CASCADE"), nullable=True, index=True
    )
    created_by: Mapped[int] = mapped_column(ForeignKey("users.id"), nullable=False, index=True)
    status: Mapped[str] = mapped_column(String(20), nullable=False, default=INVITATION_PENDING)
    # The inviter's own team grade, entered when they create the invitation
    # (their own "registration" happens at accept-time alongside the
    # invitee's, but they declare their grade up front since it's fixed by
    # the time they propose the match).
    inviter_team_grade: Mapped[int] = mapped_column(Integer, nullable=False)
    game_start: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    game_end: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    weights_version: Mapped[int] = mapped_column(Integer, nullable=False)
    responded_by: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    responded_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    inviter_classroom: Mapped["Classroom"] = relationship(  # type: ignore[name-defined]
        "Classroom", foreign_keys=[inviter_classroom_id]
    )
    invitee_classroom: Mapped["Classroom | None"] = relationship(  # type: ignore[name-defined]
        "Classroom", foreign_keys=[invitee_classroom_id]
    )
    creator: Mapped["User"] = relationship("User", foreign_keys=[created_by])  # type: ignore[name-defined]
    season: Mapped["LeagueSeason | None"] = relationship(
        "LeagueSeason", back_populates="invitation", uselist=False
    )


class LeagueSeason(Base):
    """A scoring period.

    weights_snapshot freezes the scoring rules at creation time (a JSON dump
    of the LeagueWeights in effect) so a later change to the global default
    weights never retroactively changes an already-running or finished
    season's results.

    result_snapshot is written once the season's game_end has passed (lazily,
    on first read after that point — see league_service.finalize_season) and
    never recomputed after that (CTO #8: a live `learning_sessions` row can
    later be deleted/edited; the snapshot is what keeps a finished season's
    published result from drifting).
    """

    __tablename__ = "league_seasons"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    kind: Mapped[str] = mapped_column(String(20), nullable=False)
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    invitation_id: Mapped[int | None] = mapped_column(
        ForeignKey("league_invitations.id", ondelete="CASCADE"), unique=True, nullable=True, index=True
    )
    game_start: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    game_end: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    weights_snapshot: Mapped[dict] = mapped_column(JSON, nullable=False)
    result_snapshot: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    created_by: Mapped[int] = mapped_column(ForeignKey("users.id"), nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    invitation: Mapped["LeagueInvitation | None"] = relationship(
        "LeagueInvitation", back_populates="season"
    )
    teams: Mapped[list["LeagueTeam"]] = relationship("LeagueTeam", back_populates="season")


class LeagueTeam(Base):
    """One classroom's registration into a season.

    `grade` is entered by the teacher at registration time — NOT read off
    `Text.grade` or the classroom's own `grade` column — because the
    anti-farming floor needs a grade that's true at the moment of
    competition, and (CTO #2) `Text.grade` is empty for most v2-renumbered
    lessons, making it unusable as the floor's reference point.
    """

    __tablename__ = "league_teams"
    __table_args__ = (UniqueConstraint("season_id", "classroom_id"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    season_id: Mapped[int] = mapped_column(
        ForeignKey("league_seasons.id", ondelete="CASCADE"), nullable=False, index=True
    )
    classroom_id: Mapped[int] = mapped_column(
        ForeignKey("classrooms.id", ondelete="CASCADE"), nullable=False, index=True
    )
    grade: Mapped[int] = mapped_column(Integer, nullable=False)
    registered_by: Mapped[int] = mapped_column(ForeignKey("users.id"), nullable=False)
    registered_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    season: Mapped["LeagueSeason"] = relationship("LeagueSeason", back_populates="teams")
    classroom: Mapped["Classroom"] = relationship("Classroom")  # type: ignore[name-defined]
    roster: Mapped[list["LeagueTeamRosterMember"]] = relationship(
        "LeagueTeamRosterMember", back_populates="team", cascade="all, delete-orphan"
    )


class LeagueTeamRosterMember(Base):
    """A student locked onto a team's roster at registration time.

    UNIQUE(season_id, student_id) — not (team_id, student_id) — because the
    rule is "one team per season", not merely "no duplicate row within a
    team" (CTO #6). season_id is denormalized here (also reachable via
    team_id -> season_id) purely so the database itself can enforce that
    constraint without a cross-table trigger.
    """

    __tablename__ = "league_team_roster_members"
    __table_args__ = (UniqueConstraint("season_id", "student_id"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    team_id: Mapped[int] = mapped_column(
        ForeignKey("league_teams.id", ondelete="CASCADE"), nullable=False, index=True
    )
    season_id: Mapped[int] = mapped_column(
        ForeignKey("league_seasons.id", ondelete="CASCADE"), nullable=False, index=True
    )
    student_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    locked_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    team: Mapped["LeagueTeam"] = relationship("LeagueTeam", back_populates="roster")
    student: Mapped["User"] = relationship("User")  # type: ignore[name-defined]
