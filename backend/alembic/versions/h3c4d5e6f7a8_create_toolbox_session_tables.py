"""create toolbox session tables for practice toolbox independence (#1460)

Revision ID: h3c4d5e6f7a8
Revises: g2b3c4d5e6f7
Create Date: 2026-05-04 09:30:00.000000

Phase 1 of #1460 — creates 10 independent tables for the practice toolbox
(/tools page) so practice records no longer share ``learning_sessions`` with
assignment / self-study sessions.

Each table has the same structure (see ``ToolboxSessionMixin`` in
``app/models/toolbox.py``). No data migration here; existing toolbox records
remain in ``learning_sessions`` until Phase 4 (optional, future PR).

Idempotent DDL — safe to re-run. Uses ``CREATE TABLE IF NOT EXISTS`` /
``CREATE INDEX IF NOT EXISTS`` / ``DROP TABLE IF EXISTS``.

LingoLeap SQLAlchemy safety rules applied:

- FK with ``ON DELETE CASCADE`` for ``student_id`` (user deletion cleans up)
- FK with ``ON DELETE SET NULL`` for ``text_id`` (preserve practice if text removed)
- Single-column indexes on each FK (Rule 1)
- Composite ``(student_id, started_at)`` index for the dashboard query
- ``timestamptz`` for both timestamps (avoid DST/conversion bugs)
- ``server_default NOW()`` for ``started_at``
"""
from alembic import op


# revision identifiers, used by Alembic.
revision = "h3c4d5e6f7a8"
down_revision = "g2b3c4d5e6f7"
branch_labels = None
depends_on = None


# Order matches TOOL_OPTIONS in
# frontend/src/components/tools/ToolPicker.tsx.
TOOLBOX_TABLES = [
    "toolbox_tutor_sessions",
    "toolbox_full_reading_sessions",
    "toolbox_listening_sessions",
    "toolbox_vocab_sessions",
    "toolbox_sentence_practice_sessions",
    "toolbox_vocab_definition_sessions",
    "toolbox_vocab_application_sessions",
    "toolbox_comprehension_sessions",
    "toolbox_vocab_word_search_sessions",
    "toolbox_knowledge_station_sessions",
]


def upgrade() -> None:
    for table in TOOLBOX_TABLES:
        op.execute(
            f"""
            CREATE TABLE IF NOT EXISTS {table} (
                id              SERIAL                    PRIMARY KEY,
                student_id      INTEGER                   NOT NULL
                                                          REFERENCES users(id) ON DELETE CASCADE,
                text_id         INTEGER                   REFERENCES texts(id) ON DELETE SET NULL,
                result          JSONB                     NOT NULL,
                score           DOUBLE PRECISION,
                duration_ms     INTEGER,
                started_at      TIMESTAMP WITH TIME ZONE  NOT NULL DEFAULT NOW(),
                completed_at    TIMESTAMP WITH TIME ZONE
            )
            """
        )
        op.execute(
            f"""
            CREATE INDEX IF NOT EXISTS ix_{table}_student_id
                ON {table} (student_id)
            """
        )
        op.execute(
            f"""
            CREATE INDEX IF NOT EXISTS ix_{table}_text_id
                ON {table} (text_id)
            """
        )
        op.execute(
            f"""
            CREATE INDEX IF NOT EXISTS ix_{table}_student_started
                ON {table} (student_id, started_at)
            """
        )


def downgrade() -> None:
    for table in TOOLBOX_TABLES:
        op.execute(f"DROP TABLE IF EXISTS {table} CASCADE")
