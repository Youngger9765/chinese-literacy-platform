"""add dialogue_state to learning_sessions

Revision ID: b3c4d5e6f7a8
Revises: z6a7b8c9d0e1
Create Date: 2026-04-05 00:00:00.000000

"""
from typing import Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB


# revision identifiers, used by Alembic.
revision: str = "b3c4d5e6f7a8"
down_revision: Union[str, None] = "z6a7b8c9d0e1"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "learning_sessions",
        sa.Column("dialogue_state", JSONB, nullable=True),
    )


def downgrade() -> None:
    op.drop_column("learning_sessions", "dialogue_state")
