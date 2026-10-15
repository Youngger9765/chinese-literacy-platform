"""create live_quiz_games, live_quiz_players, live_quiz_answers tables

Revision ID: c371b776d12f
Revises: d5e6f7g8h9i0
Create Date: 2026-10-14 00:00:00.000000

Issue #3551 — 課堂搶答 (in-class, live-paced quiz game). See
backend/app/models/live_quiz.py and specs/modules/live-quiz/INTENT.md for the
shape rationale (generic `submission` JSON so a second round type can plug
in without a further migration; `cached_leaderboard` / `round_started_at`
added per external review for cheap polling + recomputable scoring).
"""
from typing import Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


# revision identifiers, used by Alembic.
revision: str = "c371b776d12f"
down_revision: Union[str, None] = "d5e6f7g8h9i0"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "live_quiz_games",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("code", sa.String(10), nullable=False),
        sa.Column("host_teacher_id", sa.Integer(), nullable=False),
        sa.Column("classroom_id", sa.Integer(), nullable=True),
        sa.Column("status", sa.String(20), nullable=False, server_default="lobby"),
        sa.Column(
            "settings", postgresql.JSONB(astext_type=sa.Text()),
            nullable=False, server_default=sa.text("'{}'::jsonb"),
        ),
        sa.Column(
            "rounds_snapshot", postgresql.JSONB(astext_type=sa.Text()),
            nullable=False, server_default=sa.text("'[]'::jsonb"),
        ),
        sa.Column("seed", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("current_round_index", sa.Integer(), nullable=False, server_default="-1"),
        sa.Column("current_round_started_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("version", sa.Integer(), nullable=False, server_default="0"),
        sa.Column(
            "cached_leaderboard", postgresql.JSONB(astext_type=sa.Text()),
            nullable=False, server_default=sa.text("'[]'::jsonb"),
        ),
        sa.Column("host_device_id", sa.String(100), nullable=True),
        sa.Column("ended_reason", sa.String(20), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("ended_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(["host_teacher_id"], ["users.id"]),
        sa.ForeignKeyConstraint(["classroom_id"], ["classrooms.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_live_quiz_games_code", "live_quiz_games", ["code"])
    op.create_index("ix_live_quiz_games_code_status", "live_quiz_games", ["code", "status"])
    op.create_index("ix_live_quiz_games_host_teacher_id", "live_quiz_games", ["host_teacher_id"])
    op.create_index("ix_live_quiz_games_classroom_id", "live_quiz_games", ["classroom_id"])
    op.create_index("ix_live_quiz_games_status", "live_quiz_games", ["status"])
    op.create_index("ix_live_quiz_games_expires_at", "live_quiz_games", ["expires_at"])

    op.create_table(
        "live_quiz_players",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("game_id", sa.Integer(), nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("display_name", sa.String(100), nullable=False),
        sa.Column("total_score", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("current_streak", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("joined_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("joined_at_round_index", sa.Integer(), nullable=False, server_default="-1"),
        sa.Column("last_seen_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(["game_id"], ["live_quiz_games.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("game_id", "user_id", name="uq_live_quiz_players_game_user"),
    )
    op.create_index("ix_live_quiz_players_game_id", "live_quiz_players", ["game_id"])
    op.create_index("ix_live_quiz_players_user_id", "live_quiz_players", ["user_id"])

    op.create_table(
        "live_quiz_answers",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("game_id", sa.Integer(), nullable=False),
        sa.Column("player_id", sa.Integer(), nullable=False),
        sa.Column("round_index", sa.Integer(), nullable=False),
        sa.Column(
            "submission", postgresql.JSONB(astext_type=sa.Text()),
            nullable=False, server_default=sa.text("'{}'::jsonb"),
        ),
        sa.Column("is_correct", sa.Boolean(), nullable=True),
        sa.Column("points", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("elapsed_ms", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("round_started_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("answered_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(["game_id"], ["live_quiz_games.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["player_id"], ["live_quiz_players.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("player_id", "round_index", name="uq_live_quiz_answers_player_round"),
    )
    op.create_index("ix_live_quiz_answers_game_id", "live_quiz_answers", ["game_id"])
    op.create_index("ix_live_quiz_answers_player_id", "live_quiz_answers", ["player_id"])


def downgrade() -> None:
    op.drop_table("live_quiz_answers")
    op.drop_table("live_quiz_players")
    op.drop_table("live_quiz_games")
