"""add user onboarding/auth columns and org teacher_limit

Covers manually ALTER TABLE'd columns that were missing from migration chain:
- users.onboarding_completed
- users.password_reset_token (+ index)
- users.password_reset_expires
- users.email_verification_token
- users.terms_accepted_at
- users.terms_version
- users.privacy_accepted_at
- organizations.teacher_limit

Uses IF NOT EXISTS in raw SQL so the migration is safe on staging (columns
already exist) and correct on fresh databases (columns don't exist yet).

Revision ID: k1l2m3n4o5p6
Revises: j0k1l2m3n4o5
Create Date: 2026-03-09 14:00:00.000000

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = 'k1l2m3n4o5p6'
down_revision: Union[str, None] = 'j0k1l2m3n4o5'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # --- users table: onboarding + auth columns ---
    op.execute(
        "ALTER TABLE users ADD COLUMN IF NOT EXISTS "
        "onboarding_completed BOOLEAN NOT NULL DEFAULT false"
    )
    op.execute(
        "ALTER TABLE users ADD COLUMN IF NOT EXISTS "
        "password_reset_token VARCHAR(64)"
    )
    op.execute(
        "ALTER TABLE users ADD COLUMN IF NOT EXISTS "
        "password_reset_expires TIMESTAMPTZ"
    )
    op.execute(
        "ALTER TABLE users ADD COLUMN IF NOT EXISTS "
        "email_verification_token VARCHAR(64)"
    )
    op.execute(
        "ALTER TABLE users ADD COLUMN IF NOT EXISTS "
        "terms_accepted_at TIMESTAMPTZ"
    )
    op.execute(
        "ALTER TABLE users ADD COLUMN IF NOT EXISTS "
        "terms_version VARCHAR(20)"
    )
    op.execute(
        "ALTER TABLE users ADD COLUMN IF NOT EXISTS "
        "privacy_accepted_at TIMESTAMPTZ"
    )

    # Index on password_reset_token (CREATE INDEX IF NOT EXISTS is supported in PG 9.5+)
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_users_password_reset_token "
        "ON users (password_reset_token)"
    )

    # --- organizations table: teacher_limit ---
    op.execute(
        "ALTER TABLE organizations ADD COLUMN IF NOT EXISTS "
        "teacher_limit INTEGER"
    )


def downgrade() -> None:
    # Drop index first, then columns
    op.execute("DROP INDEX IF EXISTS ix_users_password_reset_token")

    op.drop_column('organizations', 'teacher_limit')

    op.drop_column('users', 'privacy_accepted_at')
    op.drop_column('users', 'terms_version')
    op.drop_column('users', 'terms_accepted_at')
    op.drop_column('users', 'email_verification_token')
    op.drop_column('users', 'password_reset_expires')
    op.drop_column('users', 'password_reset_token')
    op.drop_column('users', 'onboarding_completed')
