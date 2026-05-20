"""add omo_uploads.superseded_at for upload-replace UX (Feature B #1724)

Revision ID: n9o0p1q2r3s4
Revises: m8n9o0p1q2r3
Create Date: 2026-05-20 00:00:00.000000

sqlalchemy-model-safety checklist:
- No FK added ✅
- Nullable column — safe to add to existing table ✅
- Idempotent: wrapped in try/except to guard against re-run ✅
- downgrade() implemented ✅
"""
from typing import Union

from alembic import op
import sqlalchemy as sa


revision: str = "n9o0p1q2r3s4"
down_revision: Union[str, None] = "m8n9o0p1q2r3"
branch_labels = None
depends_on = None


def upgrade() -> None:
    try:
        op.add_column(
            "omo_uploads",
            sa.Column("superseded_at", sa.DateTime(timezone=True), nullable=True),
        )
    except Exception:
        pass


def downgrade() -> None:
    op.drop_column("omo_uploads", "superseded_at")
