"""add junyi_identity_id to users table

Revision ID: c9d0e1f2g3h4
Revises: b8c9d0e1f2g3
Create Date: 2026-04-21 12:00:00.000000

Adds junyi_identity_id column to users table for Junyi SSO integration (issue #1198).
Mirrors the existing google_id pattern: nullable, unique, indexed (single unique index,
no redundant constraint).
"""
from typing import Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "c9d0e1f2g3h4"
down_revision: Union[str, None] = "b8c9d0e1f2g3"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "users",
        sa.Column(
            "junyi_identity_id",
            sa.String(length=128),
            nullable=True,
        ),
    )
    op.create_index(
        "ix_users_junyi_identity_id",
        "users",
        ["junyi_identity_id"],
        unique=True,
    )


def downgrade() -> None:
    op.drop_index("ix_users_junyi_identity_id", table_name="users")
    op.drop_column("users", "junyi_identity_id")
