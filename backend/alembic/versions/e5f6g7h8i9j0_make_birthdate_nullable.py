"""make birthdate nullable

Revision ID: e5f6g7h8i9j0
Revises: d4e5f6g7h8i9
Create Date: 2026-03-07 12:30:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'e5f6g7h8i9j0'
down_revision: Union[str, None] = 'd4e5f6g7h8i9'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.alter_column(
        'student_profiles',
        'birthdate',
        existing_type=sa.Date(),
        nullable=True,
    )


def downgrade() -> None:
    # Fill NULLs before re-applying NOT NULL constraint
    op.execute(
        "UPDATE student_profiles SET birthdate = '2015-01-01' WHERE birthdate IS NULL"
    )
    op.alter_column(
        'student_profiles',
        'birthdate',
        existing_type=sa.Date(),
        nullable=False,
    )
