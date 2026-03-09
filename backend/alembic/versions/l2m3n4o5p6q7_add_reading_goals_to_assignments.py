"""add reading goals to assignments

Revision ID: l2m3n4o5p6q7
Revises: k1l2m3n4o5p6
Create Date: 2026-03-09 00:00:00.000000

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = 'l2m3n4o5p6q7'
down_revision = 'k1l2m3n4o5p6'
branch_labels = None
depends_on = None


def upgrade() -> None:
    # The preview DB may have alembic_version stamped with k1l2m3n4o5p6 (assignments
    # table creator) but the assignments table was never actually created due to a
    # previous failed partial migration run (duplicate revision ID conflict in PR #325).
    # Ensure assignments table exists before adding columns, then add columns with
    # IF NOT EXISTS for full idempotency.
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

    # Now safe to add goal columns (IF NOT EXISTS in case they already exist on staging)
    op.execute(
        "ALTER TABLE assignments ADD COLUMN IF NOT EXISTS target_cpm INTEGER"
    )
    op.execute(
        "ALTER TABLE assignments ADD COLUMN IF NOT EXISTS target_accuracy FLOAT"
    )
    op.execute(
        "ALTER TABLE assignments ADD COLUMN IF NOT EXISTS difficulty_label VARCHAR(10)"
    )


def downgrade() -> None:
    op.drop_column('assignments', 'difficulty_label')
    op.drop_column('assignments', 'target_accuracy')
    op.drop_column('assignments', 'target_cpm')
# Hotfix
