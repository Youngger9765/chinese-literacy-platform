"""add teacher_notification_reads table for issue #256

Revision ID: o5p6q7r8s9t0
Revises: n4o5p6q7r8s9
Create Date: 2026-03-09 14:00:00.000000

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = 'o5p6q7r8s9t0'
down_revision: Union[str, None] = 'n4o5p6q7r8s9'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("""
        CREATE TABLE IF NOT EXISTS teacher_notification_reads (
            id SERIAL PRIMARY KEY,
            teacher_id INTEGER NOT NULL REFERENCES users(id),
            alert_key VARCHAR(200) NOT NULL,
            read_at TIMESTAMPTZ DEFAULT now(),
            CONSTRAINT uq_teacher_alert_read UNIQUE (teacher_id, alert_key)
        )
    """)
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_teacher_notification_reads_teacher_id "
        "ON teacher_notification_reads (teacher_id)"
    )


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS ix_teacher_notification_reads_teacher_id")
    op.execute("DROP TABLE IF EXISTS teacher_notification_reads")
