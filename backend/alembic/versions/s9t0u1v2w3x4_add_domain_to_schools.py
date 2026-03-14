"""add domain column to schools

Revision ID: s9t0u1v2w3x4
Revises: r8s9t0u1v2w3
Create Date: 2026-03-14 06:30:00.000000

"""
from typing import Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "s9t0u1v2w3x4"
down_revision: Union[str, None] = "r8s9t0u1v2w3"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Add domain column to schools table (nullable, unique)
    op.add_column(
        "schools",
        sa.Column("domain", sa.String(255), nullable=True),
    )
    op.create_unique_constraint("uq_schools_domain", "schools", ["domain"])
    op.create_index("ix_schools_domain", "schools", ["domain"])


def downgrade() -> None:
    op.drop_index("ix_schools_domain", table_name="schools")
    op.drop_constraint("uq_schools_domain", "schools", type_="unique")
    op.drop_column("schools", "domain")
