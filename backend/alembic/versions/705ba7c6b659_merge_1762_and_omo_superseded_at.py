"""merge 1762 assignment mode branch and n9o0p1q2r3s4 omo superseded_at branch

Revision ID: 705ba7c6b659
Revises: 4a7b5ead6b8f, n9o0p1q2r3s4
Create Date: 2026-05-20 00:02:00.000000

Merge commit to resolve dual-head situation after issue #1762 migrations
were added alongside the existing n9o0p1q2r3s4 head.
"""
from typing import Union

from alembic import op


# revision identifiers, used by Alembic.
revision: str = "705ba7c6b659"
down_revision: Union[tuple, None] = ("4a7b5ead6b8f", "n9o0p1q2r3s4")
branch_labels = None
depends_on = None


def upgrade() -> None:
    pass


def downgrade() -> None:
    pass
