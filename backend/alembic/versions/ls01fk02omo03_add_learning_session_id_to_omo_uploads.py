"""add learning_session_id FK to omo_uploads (#2087)

Links OMO grading results to the student's LearningSession so the
AssessmentReport and teacher dashboard can surface OMO scores alongside
digital-step scores without a separate lookup.

Design notes:
- nullable: old rows and uploads that never reach confirm stay NULL.
- ondelete=SET NULL: deleting a LearningSession keeps OMO grading data.
- index=True (Rule 1): FK is used in teacher dashboard JOINs.
- Idempotent (Rule 6): safe to re-run on shared staging / preview DBs.

Revision ID: ls01fk02omo03
Revises: pii01rep02air03
Create Date: 2026-06-08

"""
from typing import Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "ls01fk02omo03"
down_revision: Union[str, None] = "pii01rep02air03"
branch_labels = None
depends_on = None


def upgrade() -> None:
    conn = op.get_bind()

    # ── Add learning_session_id column (idempotent) ──────────────────────────
    # DO $$ ... EXCEPTION WHEN duplicate_column THEN NULL; END $$;
    # ensures this is safe to re-run on staging / preview DBs that may have
    # been partially upgraded by a prior deploy attempt.
    conn.execute(sa.text("""
        DO $$ BEGIN
            ALTER TABLE omo_uploads
                ADD COLUMN learning_session_id INTEGER
                REFERENCES learning_sessions(id) ON DELETE SET NULL;
        EXCEPTION WHEN duplicate_column THEN NULL;
        END $$;
    """))

    # ── Add index on learning_session_id (idempotent) ────────────────────────
    # CREATE INDEX IF NOT EXISTS is the standard idempotent form (Rule 6).
    conn.execute(sa.text("""
        CREATE INDEX IF NOT EXISTS ix_omo_uploads_learning_session_id
            ON omo_uploads (learning_session_id);
    """))


def downgrade() -> None:
    conn = op.get_bind()

    # Drop index before dropping column (idempotent)
    conn.execute(sa.text("""
        DROP INDEX IF EXISTS ix_omo_uploads_learning_session_id;
    """))

    conn.execute(sa.text("""
        ALTER TABLE omo_uploads
            DROP COLUMN IF EXISTS learning_session_id;
    """))
