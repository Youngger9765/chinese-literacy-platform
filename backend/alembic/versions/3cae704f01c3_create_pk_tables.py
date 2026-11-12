"""create pk tables (雙人 PK 模式 MVP)

See docs/prd/2026-10-16-pk-mode-prd.md §7/§9/§11. Young approved exactly
these 3 new tables (2026-10-16) — no `classrooms.pk_enabled` column in this
migration; that teacher-toggle is deferred pending separate approval.

Revision ID: 3cae704f01c3
Revises: e5f6tokeninv1

Re-parented 2026-11-12 (staging -> main release): originally chained onto
6151124daac8 on staging. Production's DB is stamped e5f6tokeninv1 on main's
chain (a1b2c3moe01m -> b2c3d4moe02m -> c3d4pwteach1m -> e5f6tokeninv1), so every
staging-only revision now hangs AFTER e5f6tokeninv1 so production runs it.
The staging DB (also stamped e5f6tokeninv1, under the old chain) re-runs it,
which is why upgrade() is idempotent.
Create Date: 2026-10-16 00:00:00.000000

"""
from typing import Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


# revision identifiers, used by Alembic.
revision: str = "3cae704f01c3"
down_revision: Union[str, None] = "e5f6tokeninv1"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Idempotent (2026-11-12 staging->main release): this revision now runs
    # AFTER e5f6tokeninv1, so the staging DB (which already applied it under
    # the old chain) re-runs it. Each table is created only if absent.
    insp = sa.inspect(op.get_bind())
    if not insp.has_table("pk_matches"):
        op.create_table(
            "pk_matches",
            sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
            sa.Column("side_a_user_id", sa.Integer(), nullable=False),
            sa.Column("side_b_user_id", sa.Integer(), nullable=True),
            sa.Column("side_b_bot_tier", sa.Integer(), nullable=True),
            sa.Column("classroom_id", sa.Integer(), nullable=True),
            sa.Column("scope_type", sa.String(20), nullable=False),
            sa.Column("scope_ref", sa.String(50), nullable=False),
            sa.Column(
                "rounds_snapshot",
                postgresql.JSONB(astext_type=sa.Text()),
                nullable=False,
                server_default=sa.text("'[]'::jsonb"),
            ),
            sa.Column("seed", sa.Integer(), nullable=False, server_default="0"),
            sa.Column("current_round_index", sa.Integer(), nullable=False, server_default="0"),
            sa.Column("current_round_started_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("reveal_started_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column(
                "side_a_answers",
                postgresql.JSONB(astext_type=sa.Text()),
                nullable=False,
                server_default=sa.text("'[]'::jsonb"),
            ),
            sa.Column(
                "side_b_answers",
                postgresql.JSONB(astext_type=sa.Text()),
                nullable=False,
                server_default=sa.text("'[]'::jsonb"),
            ),
            sa.Column("side_a_score", sa.Integer(), nullable=False, server_default="0"),
            sa.Column("side_b_score", sa.Integer(), nullable=False, server_default="0"),
            sa.Column("winner_user_id", sa.Integer(), nullable=True),
            sa.Column("side_a_rating_before", sa.Integer(), nullable=True),
            sa.Column("side_a_rating_after", sa.Integer(), nullable=True),
            sa.Column("side_b_rating_before", sa.Integer(), nullable=True),
            sa.Column("side_b_rating_after", sa.Integer(), nullable=True),
            sa.Column("status", sa.String(20), nullable=False, server_default="active"),
            sa.Column("version", sa.Integer(), nullable=False, server_default="0"),
            sa.Column("started_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
            sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
            sa.ForeignKeyConstraint(["side_a_user_id"], ["users.id"]),
            sa.ForeignKeyConstraint(["side_b_user_id"], ["users.id"]),
            sa.ForeignKeyConstraint(["winner_user_id"], ["users.id"]),
            sa.ForeignKeyConstraint(["classroom_id"], ["classrooms.id"], ondelete="SET NULL"),
            sa.PrimaryKeyConstraint("id"),
            sa.CheckConstraint(
                "(side_b_user_id IS NULL) != (side_b_bot_tier IS NULL)",
                name="ck_pk_matches_side_b_exclusive",
            ),
            sa.CheckConstraint(
                "side_b_bot_tier IS NULL OR (side_b_bot_tier >= 1 AND side_b_bot_tier <= 7)",
                name="ck_pk_matches_bot_tier_range",
            ),
            sa.CheckConstraint("scope_type IN ('lesson','grade_pool')", name="ck_pk_matches_scope_type"),
            sa.CheckConstraint(
                "status IN ('active','completed','abandoned')", name="ck_pk_matches_status"
            ),
        )
        op.create_index("ix_pk_matches_side_a_user_id", "pk_matches", ["side_a_user_id"])
        op.create_index("ix_pk_matches_side_b_user_id", "pk_matches", ["side_b_user_id"])
        op.create_index("ix_pk_matches_classroom_id", "pk_matches", ["classroom_id"])
        op.create_index("ix_pk_matches_status", "pk_matches", ["status"])

    if not insp.has_table("pk_queue"):
        op.create_table(
            "pk_queue",
            sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
            sa.Column("student_id", sa.Integer(), nullable=False),
            sa.Column("classroom_id", sa.Integer(), nullable=True),
            sa.Column("scope_type", sa.String(20), nullable=False),
            sa.Column("scope_ref", sa.String(50), nullable=False),
            sa.Column("invite_code", sa.String(6), nullable=True),
            sa.Column("invite_expires_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("status", sa.String(20), nullable=False, server_default="waiting"),
            sa.Column("match_id", sa.Integer(), nullable=True),
            sa.Column("version", sa.Integer(), nullable=False, server_default="0"),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
            sa.Column(
                "updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
            ),
            sa.ForeignKeyConstraint(["student_id"], ["users.id"]),
            sa.ForeignKeyConstraint(["classroom_id"], ["classrooms.id"], ondelete="SET NULL"),
            sa.ForeignKeyConstraint(["match_id"], ["pk_matches.id"], ondelete="SET NULL"),
            sa.PrimaryKeyConstraint("id"),
            sa.CheckConstraint("scope_type IN ('lesson','grade_pool')", name="ck_pk_queue_scope_type"),
            sa.CheckConstraint(
                "status IN ('waiting','matched','expired','cancelled')", name="ck_pk_queue_status"
            ),
        )
        op.create_index("ix_pk_queue_student_id", "pk_queue", ["student_id"])
        op.create_index("ix_pk_queue_classroom_id", "pk_queue", ["classroom_id"])
        op.create_index("ix_pk_queue_status", "pk_queue", ["status"])
        op.create_index(
            "ix_pk_queue_matching", "pk_queue", ["status", "scope_type", "scope_ref", "classroom_id"]
        )
        op.create_index(
            "ix_pk_queue_invite_code_waiting",
            "pk_queue",
            ["invite_code"],
            unique=True,
            postgresql_where=sa.text("status = 'waiting' AND invite_code IS NOT NULL"),
        )

    if not insp.has_table("pk_ratings"):
        op.create_table(
            "pk_ratings",
            sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
            sa.Column("student_id", sa.Integer(), nullable=False),
            sa.Column("rating", sa.Integer(), nullable=False, server_default="1000"),
            sa.Column("matches_played", sa.Integer(), nullable=False, server_default="0"),
            sa.Column("wins", sa.Integer(), nullable=False, server_default="0"),
            sa.Column("losses", sa.Integer(), nullable=False, server_default="0"),
            sa.Column("draws", sa.Integer(), nullable=False, server_default="0"),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
            sa.Column(
                "updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
            ),
            sa.ForeignKeyConstraint(["student_id"], ["users.id"]),
            sa.PrimaryKeyConstraint("id"),
            sa.UniqueConstraint("student_id"),
        )
        op.create_index("ix_pk_ratings_student_id", "pk_ratings", ["student_id"])


def downgrade() -> None:
    op.drop_table("pk_ratings")
    op.drop_table("pk_queue")
    op.drop_table("pk_matches")
