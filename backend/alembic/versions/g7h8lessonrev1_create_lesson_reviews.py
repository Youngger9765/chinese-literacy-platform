"""create lesson_reviews + lesson_review_steps (學習批閱)

Issue #4104: teachers review a student's lesson scorecard — return single
steps to redo, comment on each step, score each step and the whole lesson —
and send it to the student in one go.

Two new tables, nothing existing is altered:

- ``lesson_reviews``: one row per (student, lesson). ``total_score`` /
  ``sent_at`` are what the student sees; ``draft`` (JSONB) holds the teacher's
  unsent edits and is never shown to the student.
- ``lesson_review_steps``: the sent state of each step (returned / comment /
  score), CASCADE-deleted with its review.

Not stored in ``learning_sessions.step_progress`` on purpose: the student's own
``PUT /progress`` writes that JSONB, so the student could change their score or
wipe it with the next save.

No backfill: there was no review data before this.

Idempotent (sqlalchemy-model-safety Rule 6): preview/staging DBs can see this
migration more than once across parallel branch deploys, so each table and
index is created only if it does not already exist.

Revision ID: g7h8lessonrev1
Revises: f6g7actvpack1
Create Date: 2026-11-18 00:00:00.000000
"""
from typing import Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "g7h8lessonrev1"
down_revision: Union[str, None] = "f6g7actvpack1"
branch_labels = None
depends_on = None


def _index_names(table: str) -> set[str]:
    insp = sa.inspect(op.get_bind())
    return {ix["name"] for ix in insp.get_indexes(table)}


def upgrade() -> None:
    insp = sa.inspect(op.get_bind())
    tables = set(insp.get_table_names())

    if "lesson_reviews" not in tables:
        op.create_table(
            "lesson_reviews",
            sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
            sa.Column("student_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
            sa.Column("story_slug", sa.String(100), nullable=False),
            sa.Column("classroom_id", sa.Integer(), sa.ForeignKey("classrooms.id", ondelete="SET NULL"), nullable=True),
            sa.Column("teacher_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
            sa.Column("total_score", sa.Integer(), nullable=True),
            sa.Column("sent_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("draft", postgresql.JSONB(), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
            sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
            sa.UniqueConstraint("student_id", "story_slug", name="uq_lesson_reviews_student_story"),
        )
    existing = _index_names("lesson_reviews")
    for col in ("student_id", "story_slug", "classroom_id", "teacher_id"):
        name = f"ix_lesson_reviews_{col}"
        if name not in existing:
            op.create_index(name, "lesson_reviews", [col])

    if "lesson_review_steps" not in tables:
        op.create_table(
            "lesson_review_steps",
            sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
            sa.Column(
                "review_id", sa.Integer(), sa.ForeignKey("lesson_reviews.id", ondelete="CASCADE"), nullable=False
            ),
            sa.Column("step_key", sa.String(100), nullable=False),
            sa.Column("returned", sa.Boolean(), nullable=False, server_default=sa.false()),
            sa.Column("returned_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("comment", sa.Text(), nullable=True),
            sa.Column("score", sa.Integer(), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
            sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
            sa.UniqueConstraint("review_id", "step_key", name="uq_lesson_review_steps_review_step"),
        )
    if "ix_lesson_review_steps_review_id" not in _index_names("lesson_review_steps"):
        op.create_index("ix_lesson_review_steps_review_id", "lesson_review_steps", ["review_id"])


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS lesson_review_steps")
    op.execute("DROP TABLE IF EXISTS lesson_reviews")
