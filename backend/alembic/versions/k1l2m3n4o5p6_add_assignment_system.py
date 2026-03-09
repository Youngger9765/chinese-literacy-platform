"""add assignment system tables

Covers Issue #143: Assignment Model + 副本策略 (copy strategy)

Tables added:
- assignments: teacher-issued reading assignments for classrooms
- assignment_submissions: per-student assignment progress tracking

Assignment.story_id  → YAML platform text (lesson_number as string)
Assignment.text_id   → DB text (texts table); points to fork for mutable texts

副本策略:
- Platform YAML texts: direct reference via story_id (never copied)
- DB texts, platform visibility: direct reference via text_id (never copied)
- DB texts, non-platform visibility: forked at assignment creation via
  resolve_text_for_assignment() in services/assignment_copy_strategy.py

Revision ID: k1l2m3n4o5p6
Revises: j0k1l2m3n4o5
Create Date: 2026-03-09 12:00:00.000000
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = 'k1l2m3n4o5p6'
down_revision: Union[str, None] = 'j0k1l2m3n4o5'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Use raw SQL with IF NOT EXISTS so migration is idempotent:
    # safe on staging (tables already exist) and fresh preview DBs (may have
    # partial alembic_version state from a previous failed migration run).

    # --- assignments table ---
    op.execute("""
        CREATE TABLE IF NOT EXISTS assignments (
            id SERIAL PRIMARY KEY,
            classroom_id INTEGER NOT NULL REFERENCES classrooms(id) ON DELETE CASCADE,
            teacher_id INTEGER NOT NULL REFERENCES users(id),
            story_id VARCHAR(50),
            text_id INTEGER REFERENCES texts(id) ON DELETE SET NULL,
            title VARCHAR(200),
            description TEXT,
            assignment_type VARCHAR(20) NOT NULL DEFAULT 'reading',
            due_date TIMESTAMPTZ,
            is_active BOOLEAN NOT NULL DEFAULT true,
            created_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )
    """)
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_assignments_classroom_id ON assignments (classroom_id)"
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_assignments_text_id ON assignments (text_id)"
    )

    # --- assignment_submissions table ---
    op.execute("""
        CREATE TABLE IF NOT EXISTS assignment_submissions (
            id SERIAL PRIMARY KEY,
            assignment_id INTEGER NOT NULL REFERENCES assignments(id) ON DELETE CASCADE,
            student_id INTEGER NOT NULL REFERENCES users(id),
            status VARCHAR(20) NOT NULL DEFAULT 'pending',
            session_id INTEGER REFERENCES learning_sessions(id),
            submitted_at TIMESTAMPTZ,
            score FLOAT,
            created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
            CONSTRAINT uq_assignment_student UNIQUE (assignment_id, student_id)
        )
    """)
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_assignment_submissions_assignment_id "
        "ON assignment_submissions (assignment_id)"
    )


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS ix_assignment_submissions_assignment_id")
    op.execute("DROP TABLE IF EXISTS assignment_submissions")
    op.execute("DROP INDEX IF EXISTS ix_assignments_text_id")
    op.execute("DROP INDEX IF EXISTS ix_assignments_classroom_id")
    op.execute("DROP TABLE IF EXISTS assignments")
