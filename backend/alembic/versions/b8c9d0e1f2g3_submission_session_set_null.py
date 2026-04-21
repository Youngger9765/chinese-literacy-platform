"""add ondelete SET NULL to assignment_submissions.session_id

Revision ID: b8c9d0e1f2g3
Revises: a7b8c9d0e1f2
Create Date: 2026-04-21 00:10:00.000000

Fixes #1178: when a LearningSession is deleted (by cleanup/maintenance),
AssignmentSubmission.session_id currently becomes a dangling pointer because
the FK has no ondelete policy.  This migration drops the existing FK and
recreates it with `ON DELETE SET NULL` so that submissions with a deleted
session simply have session_id set to NULL instead of breaking referential
integrity.

FK name is looked up dynamically because different migration eras used
different naming conventions (postgres default "<table>_<col>_fkey" vs
SQLAlchemy "fk_<table>_<col>_<ref>").
"""
from typing import Union

from alembic import op


revision: str = "b8c9d0e1f2g3"
down_revision: Union[str, None] = "a7b8c9d0e1f2"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Look up the actual FK constraint name from pg_catalog and drop it,
    # then recreate with ON DELETE SET NULL.
    op.execute(
        """
        DO $$
        DECLARE
            fk_name text;
        BEGIN
            SELECT conname INTO fk_name
            FROM pg_constraint c
            JOIN pg_class t ON c.conrelid = t.oid
            JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = ANY(c.conkey)
            WHERE t.relname = 'assignment_submissions'
              AND c.contype = 'f'
              AND a.attname = 'session_id'
            LIMIT 1;

            IF fk_name IS NOT NULL THEN
                EXECUTE format('ALTER TABLE assignment_submissions DROP CONSTRAINT %I', fk_name);
            END IF;

            ALTER TABLE assignment_submissions
                ADD CONSTRAINT assignment_submissions_session_id_fkey
                FOREIGN KEY (session_id)
                REFERENCES learning_sessions (id)
                ON DELETE SET NULL;
        END
        $$;
        """
    )


def downgrade() -> None:
    op.execute(
        """
        DO $$
        DECLARE
            fk_name text;
        BEGIN
            SELECT conname INTO fk_name
            FROM pg_constraint c
            JOIN pg_class t ON c.conrelid = t.oid
            JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = ANY(c.conkey)
            WHERE t.relname = 'assignment_submissions'
              AND c.contype = 'f'
              AND a.attname = 'session_id'
            LIMIT 1;

            IF fk_name IS NOT NULL THEN
                EXECUTE format('ALTER TABLE assignment_submissions DROP CONSTRAINT %I', fk_name);
            END IF;

            ALTER TABLE assignment_submissions
                ADD CONSTRAINT assignment_submissions_session_id_fkey
                FOREIGN KEY (session_id)
                REFERENCES learning_sessions (id);
        END
        $$;
        """
    )
