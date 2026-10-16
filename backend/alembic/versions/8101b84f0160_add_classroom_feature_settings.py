"""add classrooms.feature_settings (per-class PK toggle)

See docs/prd/2026-10-16-pk-mode-prd.md §7.4 (updated 2026-10-16 — Young
approved one JSON settings column instead of a dedicated boolean column, so
future class-level toggles never need another migration). Only recognized
key today: "pk_human" (真人 PK — 同學配對對戰), default false when absent
— see backend/app/services/pk/classroom_features.py for the typed reader.

Revision ID: 8101b84f0160
Revises: 3cae704f01c3
Create Date: 2026-10-16 00:00:00.000000

"""
from typing import Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "8101b84f0160"
down_revision: Union[str, None] = "3cae704f01c3"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "classrooms",
        sa.Column(
            "feature_settings",
            sa.JSON(),
            nullable=False,
            server_default=sa.text("'{}'"),
        ),
    )


def downgrade() -> None:
    op.drop_column("classrooms", "feature_settings")
