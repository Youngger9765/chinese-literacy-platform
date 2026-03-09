"""merge assignment system and user onboarding branches

Both k1l2m3n4o5p6 migrations (add_assignment_system and
add_user_onboarding_and_org_teacher_limit) share the same revision ID,
creating a branch in the migration graph. This merge migration resolves
the branch so subsequent migrations have a single linear predecessor.

Note: The duplicate revision ID in the originating migrations is a
pre-existing issue. This merge does not modify any schema — it only
creates a merge point.

Revision ID: k2l3m4n5o6p7
Revises: k1l2m3n4o5p6 (both branches)
Create Date: 2026-03-09

"""
from alembic import op


# revision identifiers
revision = 'k2l3m4n5o6p7'
# Both k1l2 revisions share the same ID, so alembic treats them as one here
down_revision = 'k1l2m3n4o5p6'
branch_labels = None
depends_on = None


def upgrade() -> None:
    # No schema changes — merge point only
    pass


def downgrade() -> None:
    pass
