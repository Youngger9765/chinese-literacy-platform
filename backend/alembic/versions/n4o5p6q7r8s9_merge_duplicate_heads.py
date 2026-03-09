"""merge duplicate l2m3n4o5p6q7 heads

Multiple PRs created migrations with the same revision ID l2m3n4o5p6q7.
This merge migration resolves the conflict by declaring all branches
as parents and producing a single head.

Revision ID: n4o5p6q7r8s9
Revises: l2m3n4o5p6q7
Create Date: 2026-03-09 15:00:00.000000

"""
from typing import Sequence, Union

from alembic import op

# revision identifiers, used by Alembic.
revision: str = 'n4o5p6q7r8s9'
down_revision: Union[str, None] = ('l2m3n4o5p6q7', 'o5p6q7r8s9t0')
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # No-op: this is a merge migration only
    pass


def downgrade() -> None:
    pass
