"""create annotation_entries table

Revision ID: 2ed91926c851
Revises: pii01rep02air03
Create Date: 2026-06-05

Issue #2070: Persist reading-annotation step marks (unknown/important) to DB
so students keep them across devices and teachers can see annotation patterns.

SQLAlchemy model: backend/app/models/annotation.py (AnnotationEntry)
"""

from alembic import op

# revision identifiers, used by Alembic.
revision = "2ed91926c851"
down_revision = "pii01rep02air03"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Idempotent create (shared staging/preview DBs may already have the table
    # from a prior deploy of this branch).
    op.execute("""
        CREATE TABLE IF NOT EXISTS annotation_entries (
            id              SERIAL PRIMARY KEY,
            session_id      INTEGER NOT NULL
                                REFERENCES learning_sessions(id) ON DELETE CASCADE,
            paragraph_index INTEGER NOT NULL,
            char_start      INTEGER NOT NULL,
            char_end        INTEGER NOT NULL,
            annotation_type VARCHAR(20) NOT NULL,
            client_id       VARCHAR(64),
            created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
    """)

    # session_id index (Rule 1: every FK needs an index)
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_annotation_entries_session_id "
        "ON annotation_entries (session_id)"
    )

    # client_id index (used for dedup lookups)
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_annotation_entries_client_id "
        "ON annotation_entries (client_id)"
    )

    # Composite index for bulk-fetch "all annotations for session X sorted by para"
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_annotation_entries_session_para "
        "ON annotation_entries (session_id, paragraph_index)"
    )


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS annotation_entries")
