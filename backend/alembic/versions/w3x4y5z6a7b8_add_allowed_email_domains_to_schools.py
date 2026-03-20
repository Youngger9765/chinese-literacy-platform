"""add allowed_email_domains to schools

Revision ID: w3x4y5z6a7b8
Revises: v2w3x4y5z6a7
Create Date: 2026-03-20 07:00:00.000000

"""
from typing import Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "w3x4y5z6a7b8"
down_revision: Union[str, None] = "v2w3x4y5z6a7"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Add allowed_email_domains JSON column to schools table
    op.add_column(
        "schools",
        sa.Column("allowed_email_domains", sa.JSON(), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("schools", "allowed_email_domains")
