"""merge 3 dangling heads: dialogue_state, teacher_review, reading_history

Revision ID: m1e2r3g4h5i6
Revises: b3c4d5e6f7a8, tc01rv02cm03, z6a7b8c9d0e1
Create Date: 2026-04-21 11:00:00.000000

Staging accumulated 3 dangling alembic heads (no merge migration was added
when the forks were introduced), which made `alembic upgrade head` fail at
Cloud Run container startup with "Multiple head revisions are present".
This blocked every PR preview deploy that rebuilt the image.

This file only consolidates the chain; it has no schema changes.
"""
from typing import Sequence, Union


revision: str = 'm1e2r3g4h5i6'
down_revision: Union[str, tuple] = ('b3c4d5e6f7a8', 'tc01rv02cm03', 'z6a7b8c9d0e1')
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    pass


def downgrade() -> None:
    pass
