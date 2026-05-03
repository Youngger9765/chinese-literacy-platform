"""add mcq_rescue_session table (#1387)

Revision ID: g2b3c4d5e6f7
Revises: f1a2b3c4d5e6
Create Date: 2026-05-03 09:00:00.000000

Adds mcq_rescue_session for the MCQ rescue AI tutor (#1387 / linked to #1372 spec).
One row per (user_id, question_id) rescue attempt; multiple retries on the same
question create new rows.

Idempotent DDL — safe to re-run. Uses CREATE TABLE IF NOT EXISTS / DROP TABLE IF EXISTS.

LingoLeap SQLAlchemy safety rules applied:
  - FK index=True (user_id, question_id, lesson_id all indexed below)
  - server_default for timestamps (started_at uses NOW())
  - Composite index for the common query path (user_id + lesson_id)
  - ondelete CASCADE on user FK so student deletion cleans up
"""
from alembic import op


# revision identifiers, used by Alembic.
revision = "g2b3c4d5e6f7"
down_revision = "f1a2b3c4d5e6"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("""
        CREATE TABLE IF NOT EXISTS mcq_rescue_session (
            id SERIAL PRIMARY KEY,
            user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            question_id VARCHAR(128) NOT NULL,
            lesson_id VARCHAR(128) NOT NULL,
            wrong_choice VARCHAR(8) NOT NULL,
            started_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT NOW(),
            ended_at TIMESTAMP WITHOUT TIME ZONE,
            total_turns INTEGER NOT NULL DEFAULT 0,
            final_step INTEGER,
            outcome VARCHAR(32),
            retry_count INTEGER NOT NULL DEFAULT 0
        )
    """)
    op.execute("""
        CREATE INDEX IF NOT EXISTS ix_mcq_rescue_session_user_id
            ON mcq_rescue_session (user_id)
    """)
    op.execute("""
        CREATE INDEX IF NOT EXISTS ix_mcq_rescue_session_question_id
            ON mcq_rescue_session (question_id)
    """)
    op.execute("""
        CREATE INDEX IF NOT EXISTS ix_mcq_rescue_session_lesson_id
            ON mcq_rescue_session (lesson_id)
    """)
    op.execute("""
        CREATE INDEX IF NOT EXISTS ix_mcq_rescue_session_user_lesson
            ON mcq_rescue_session (user_id, lesson_id)
    """)


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS mcq_rescue_session CASCADE")
