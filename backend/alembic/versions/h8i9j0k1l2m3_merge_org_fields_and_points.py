"""merge org business info fields and points system branches

Revision ID: h8i9j0k1l2m3
Revises: f6g7h8i9j0k1, g7h8i9j0k1l2
Create Date: 2026-03-08 10:00:00.000000

"""
from typing import Sequence, Union


# revision identifiers, used by Alembic.
revision: str = 'h8i9j0k1l2m3'
down_revision: Union[str, tuple] = ('f6g7h8i9j0k1', 'g7h8i9j0k1l2')
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    pass


def downgrade() -> None:
    pass
