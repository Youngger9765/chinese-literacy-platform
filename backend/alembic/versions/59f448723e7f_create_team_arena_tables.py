"""create team_arena tables (五人對抗賽 MVP)

See docs/prd/2026-10-18-team-arena-prd.md §9/§13. Young approved these 3
new tables on 2026-10-19 (issue #3632) — matches
app/models/team_arena.py verbatim (that file documents why it predates
this migration: slice 1's pure-function engine was developed and tested
entirely against SQLite's Base.metadata.create_all() while this approval
was pending).

Revision ID: 59f448723e7f
Revises: 2756eda93b27
Create Date: 2026-10-19 00:00:00.000000

"""
from typing import Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


# revision identifiers, used by Alembic.
revision: str = "59f448723e7f"
down_revision: Union[str, None] = "2756eda93b27"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "team_arena_sessions",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("classroom_id", sa.Integer(), nullable=False),
        sa.Column("teacher_id", sa.Integer(), nullable=False),
        sa.Column("code", sa.String(6), nullable=False),
        sa.Column("status", sa.String(20), nullable=False, server_default="lobby"),
        sa.Column(
            "settings",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=False,
            server_default=sa.text("'{}'::jsonb"),
        ),
        sa.Column("turn_no", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("turn_started_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("state_version", sa.Integer(), nullable=False, server_default="0"),
        sa.Column(
            "scoreboard",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=False,
            server_default=sa.text("'{}'::jsonb"),
        ),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("ended_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(["classroom_id"], ["classrooms.id"]),
        sa.ForeignKeyConstraint(["teacher_id"], ["users.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.CheckConstraint(
            "status IN ('lobby','playing','paused','ended')", name="ck_team_arena_sessions_status"
        ),
    )
    op.create_index("ix_team_arena_sessions_classroom_id", "team_arena_sessions", ["classroom_id"])
    op.create_index("ix_team_arena_sessions_teacher_id", "team_arena_sessions", ["teacher_id"])
    op.create_index("ix_team_arena_sessions_code", "team_arena_sessions", ["code"])
    op.create_index("ix_team_arena_sessions_status", "team_arena_sessions", ["status"])
    op.create_index(
        "ix_team_arena_sessions_code_status", "team_arena_sessions", ["code", "status"]
    )

    op.create_table(
        "team_arena_members",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("session_id", sa.Integer(), nullable=False),
        sa.Column("student_id", sa.Integer(), nullable=False),
        sa.Column("match_no", sa.SmallInteger(), nullable=False),
        sa.Column("side", sa.SmallInteger(), nullable=False),
        sa.Column("lane", sa.String(20), nullable=False),
        sa.Column("rotation_order", sa.SmallInteger(), nullable=False),
        sa.Column("grade_pool_override", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column(
            "question_queue",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=False,
            server_default=sa.text("'[]'::jsonb"),
        ),
        sa.Column("last_seen_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(["session_id"], ["team_arena_sessions.id"]),
        sa.ForeignKeyConstraint(["student_id"], ["users.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "session_id", "student_id", name="uq_team_arena_members_session_student"
        ),
        sa.CheckConstraint(
            "lane IN ('zhuyin','vocab_definitions','vocab_application','comprehension','support')",
            name="ck_team_arena_members_lane",
        ),
        sa.CheckConstraint("side IN (0, 1)", name="ck_team_arena_members_side"),
    )
    op.create_index("ix_team_arena_members_session_id", "team_arena_members", ["session_id"])
    op.create_index("ix_team_arena_members_student_id", "team_arena_members", ["student_id"])
    op.create_index(
        "ix_team_arena_members_session_match", "team_arena_members", ["session_id", "match_no"]
    )

    op.create_table(
        "team_arena_answers",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("session_id", sa.Integer(), nullable=False),
        sa.Column("member_id", sa.Integer(), nullable=False),
        sa.Column("turn_no", sa.Integer(), nullable=False),
        sa.Column("role", sa.String(10), nullable=False),
        sa.Column("choice", sa.String(1), nullable=True),
        sa.Column("correct", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("elapsed_ms", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("speed_bonus", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(["session_id"], ["team_arena_sessions.id"]),
        sa.ForeignKeyConstraint(["member_id"], ["team_arena_members.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "session_id", "member_id", "turn_no", name="uq_team_arena_answers_session_member_turn"
        ),
        sa.CheckConstraint("role IN ('active','assist')", name="ck_team_arena_answers_role"),
    )
    op.create_index("ix_team_arena_answers_session_id", "team_arena_answers", ["session_id"])
    op.create_index("ix_team_arena_answers_member_id", "team_arena_answers", ["member_id"])


def downgrade() -> None:
    op.drop_table("team_arena_answers")
    op.drop_table("team_arena_members")
    op.drop_table("team_arena_sessions")
