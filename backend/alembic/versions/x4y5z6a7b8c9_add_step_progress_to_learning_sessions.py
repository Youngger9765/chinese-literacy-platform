"""add step_progress to learning_sessions

Revision ID: x4y5z6a7b8c9
Revises: w3x4y5z6a7b8
Create Date: 2026-03-28 00:00:00.000000

"""
from typing import Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


# revision identifiers, used by Alembic.
revision: str = "x4y5z6a7b8c9"
down_revision: Union[str, None] = "w3x4y5z6a7b8"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "learning_sessions",
        sa.Column("step_progress", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("learning_sessions", "step_progress")
