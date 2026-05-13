"""create mcq_attempt table (#1507)

Revision ID: j5e6f7a8b9c0
Revises: i4d5e6f7a8b9
Create Date: 2026-05-09 10:00:00.000000

Adds mcq_attempt — one row per student MCQ choice click. Lets teachers see
students who keep getting questions wrong without engaging the rescue tutor
(Young 5/8 meeting decision: "連續答錯不問 AI 也要記錄").

Idempotent DDL — safe to re-run. Uses CREATE TABLE IF NOT EXISTS.

LingoLeap SQLAlchemy safety rules applied:
  - FK index=True (user_id, lesson_id, question_id all indexed)
  - server_default for created_at (NOW())
  - Composite index for the common query path (user_id + lesson_id)
  - ondelete CASCADE on user FK so student deletion cleans up
"""
from alembic import op


revision = "j5e6f7a8b9c0"
down_revision = "i4d5e6f7a8b9"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("""
        CREATE TABLE IF NOT EXISTS mcq_attempt (
            id SERIAL PRIMARY KEY,
            user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            lesson_id VARCHAR(128) NOT NULL,
            question_id VARCHAR(128) NOT NULL,
            choice VARCHAR(8) NOT NULL,
            is_correct BOOLEAN NOT NULL,
            created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
        )
    """)
    op.execute("""
        CREATE INDEX IF NOT EXISTS ix_mcq_attempt_user_id
            ON mcq_attempt (user_id)
    """)
    op.execute("""
        CREATE INDEX IF NOT EXISTS ix_mcq_attempt_lesson_id
            ON mcq_attempt (lesson_id)
    """)
    op.execute("""
        CREATE INDEX IF NOT EXISTS ix_mcq_attempt_question_id
            ON mcq_attempt (question_id)
    """)
    op.execute("""
        CREATE INDEX IF NOT EXISTS ix_mcq_attempt_user_lesson
            ON mcq_attempt (user_id, lesson_id)
    """)


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS mcq_attempt CASCADE")
