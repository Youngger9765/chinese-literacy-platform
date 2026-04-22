"""add performance indexes on hot query columns (issue #1223)

Revision ID: px01perf02idx03
Revises: mg01merge02heads03
Create Date: 2026-04-22 01:00:00.000000

Adds indexes for P0 performance optimization wave:
  - learning_sessions.status         (ix_learning_sessions_status)
  - learning_sessions(student_id, status)  (ix_learning_sessions_student_id_status)

Note: assignment_submissions.student_id and character_errors.session_id were
already indexed by fk01idx02add03 (2026-04-04).  The SQLAlchemy model now
declares index=True for those columns as well so ORM introspection is accurate;
no additional DB migration is needed for them.

All new indexes use CREATE INDEX CONCURRENTLY to avoid table locks on production.
Alembic requires autocommit mode for CONCURRENTLY.
"""

from alembic import op
from sqlalchemy import inspect as sa_inspect

# revision identifiers, used by Alembic.
revision = "px01perf02idx03"
down_revision = "mg01merge02heads03"
branch_labels = None
depends_on = None


def _table_exists(bind, table_name: str) -> bool:
    return table_name in sa_inspect(bind).get_table_names()


def _index_exists(bind, table_name: str, index_name: str) -> bool:
    if not _table_exists(bind, table_name):
        return False
    return any(
        idx["name"] == index_name
        for idx in sa_inspect(bind).get_indexes(table_name)
    )


def upgrade() -> None:
    bind = op.get_bind()

    # ── learning_sessions.status (single-column) ──────────────────────────────
    if not _index_exists(bind, "learning_sessions", "ix_learning_sessions_status"):
        with op.get_context().autocommit_block():
            op.execute(
                "CREATE INDEX CONCURRENTLY IF NOT EXISTS ix_learning_sessions_status "
                "ON learning_sessions (status)"
            )

    # ── learning_sessions(student_id, status) (compound) ─────────────────────
    if not _index_exists(bind, "learning_sessions", "ix_learning_sessions_student_id_status"):
        with op.get_context().autocommit_block():
            op.execute(
                "CREATE INDEX CONCURRENTLY IF NOT EXISTS ix_learning_sessions_student_id_status "
                "ON learning_sessions (student_id, status)"
            )


def downgrade() -> None:
    bind = op.get_bind()

    if _index_exists(bind, "learning_sessions", "ix_learning_sessions_student_id_status"):
        op.drop_index(
            "ix_learning_sessions_student_id_status",
            table_name="learning_sessions",
        )

    if _index_exists(bind, "learning_sessions", "ix_learning_sessions_status"):
        op.drop_index(
            "ix_learning_sessions_status",
            table_name="learning_sessions",
        )
