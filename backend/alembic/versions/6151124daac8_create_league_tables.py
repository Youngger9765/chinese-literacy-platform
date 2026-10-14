"""create league tables (cross-class invitational MVP)

See docs/prd/2026-10-14-chinese-star-league-prd.md §7/§10/§11.

Revision ID: 6151124daac8
Revises: d5e6f7g8h9i0
Create Date: 2026-10-15 00:00:00.000000

"""
from typing import Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "6151124daac8"
down_revision: Union[str, None] = "d5e6f7g8h9i0"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "league_invitations",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("code", sa.String(12), nullable=False),
        sa.Column("inviter_classroom_id", sa.Integer(), nullable=False),
        sa.Column("invitee_classroom_id", sa.Integer(), nullable=True),
        sa.Column("created_by", sa.Integer(), nullable=False),
        sa.Column("status", sa.String(20), nullable=False, server_default="pending"),
        sa.Column("inviter_team_grade", sa.Integer(), nullable=False),
        sa.Column("game_start", sa.DateTime(timezone=True), nullable=False),
        sa.Column("game_end", sa.DateTime(timezone=True), nullable=False),
        sa.Column("weights_version", sa.Integer(), nullable=False),
        sa.Column("responded_by", sa.Integer(), nullable=True),
        sa.Column("responded_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(["inviter_classroom_id"], ["classrooms.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["invitee_classroom_id"], ["classrooms.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["created_by"], ["users.id"]),
        sa.ForeignKeyConstraint(["responded_by"], ["users.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("code"),
    )
    op.create_index("ix_league_invitations_code", "league_invitations", ["code"])
    op.create_index(
        "ix_league_invitations_inviter_classroom_id", "league_invitations", ["inviter_classroom_id"]
    )
    op.create_index(
        "ix_league_invitations_invitee_classroom_id", "league_invitations", ["invitee_classroom_id"]
    )
    op.create_index("ix_league_invitations_created_by", "league_invitations", ["created_by"])

    op.create_table(
        "league_seasons",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("kind", sa.String(20), nullable=False),
        sa.Column("name", sa.String(200), nullable=False),
        sa.Column("invitation_id", sa.Integer(), nullable=True),
        sa.Column("game_start", sa.DateTime(timezone=True), nullable=False),
        sa.Column("game_end", sa.DateTime(timezone=True), nullable=False),
        sa.Column("weights_snapshot", sa.JSON(), nullable=False),
        sa.Column("result_snapshot", sa.JSON(), nullable=True),
        sa.Column("created_by", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(["invitation_id"], ["league_invitations.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["created_by"], ["users.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("invitation_id"),
    )
    op.create_index("ix_league_seasons_invitation_id", "league_seasons", ["invitation_id"])

    op.create_table(
        "league_teams",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("season_id", sa.Integer(), nullable=False),
        sa.Column("classroom_id", sa.Integer(), nullable=False),
        sa.Column("grade", sa.Integer(), nullable=False),
        sa.Column("registered_by", sa.Integer(), nullable=False),
        sa.Column("registered_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(["season_id"], ["league_seasons.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["classroom_id"], ["classrooms.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["registered_by"], ["users.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("season_id", "classroom_id"),
    )
    op.create_index("ix_league_teams_season_id", "league_teams", ["season_id"])
    op.create_index("ix_league_teams_classroom_id", "league_teams", ["classroom_id"])

    op.create_table(
        "league_team_roster_members",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("team_id", sa.Integer(), nullable=False),
        sa.Column("season_id", sa.Integer(), nullable=False),
        sa.Column("student_id", sa.Integer(), nullable=False),
        sa.Column("locked_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(["team_id"], ["league_teams.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["season_id"], ["league_seasons.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["student_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("season_id", "student_id"),
    )
    op.create_index("ix_league_team_roster_members_team_id", "league_team_roster_members", ["team_id"])
    op.create_index(
        "ix_league_team_roster_members_season_id", "league_team_roster_members", ["season_id"]
    )
    op.create_index(
        "ix_league_team_roster_members_student_id", "league_team_roster_members", ["student_id"]
    )


def downgrade() -> None:
    op.drop_table("league_team_roster_members")
    op.drop_table("league_teams")
    op.drop_table("league_seasons")
    op.drop_table("league_invitations")
