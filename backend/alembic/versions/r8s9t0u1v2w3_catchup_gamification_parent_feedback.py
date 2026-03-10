"""catch-up migration: gamification, parent links, feedback, column fixes

Creates tables that were manually added via SQL but never tracked by Alembic:
- student_xp_log, student_badges, student_streaks (gamification)
- parent_invite_codes, parent_student_links (parent system)
- feedbacks (user feedback)

Also fixes column mismatches on dictionary_cache and teacher_notification_reads.

Uses IF NOT EXISTS / IF EXISTS guards so this migration is idempotent on
databases where the tables already exist (staging/production).

Revision ID: r8s9t0u1v2w3
Revises: q7r8s9t0u1v2
Create Date: 2026-03-10 12:00:00.000000

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "r8s9t0u1v2w3"
down_revision: Union[str, None] = "q7r8s9t0u1v2"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    conn = op.get_bind()

    # ── 1. student_xp_log ────────────────────────────────────────────────
    conn.execute(sa.text("""
        CREATE TABLE IF NOT EXISTS student_xp_log (
            id SERIAL PRIMARY KEY,
            student_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            event_type VARCHAR(50) NOT NULL,
            xp_earned INTEGER NOT NULL,
            session_id INTEGER REFERENCES learning_sessions(id) ON DELETE SET NULL,
            note TEXT,
            created_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )
    """))
    conn.execute(sa.text("""
        CREATE INDEX IF NOT EXISTS ix_student_xp_log_student_id
        ON student_xp_log(student_id)
    """))

    # ── 2. student_badges ────────────────────────────────────────────────
    conn.execute(sa.text("""
        CREATE TABLE IF NOT EXISTS student_badges (
            id SERIAL PRIMARY KEY,
            student_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            badge_key VARCHAR(50) NOT NULL,
            unlocked_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )
    """))
    conn.execute(sa.text("""
        CREATE INDEX IF NOT EXISTS ix_student_badges_student_id
        ON student_badges(student_id)
    """))
    # Add unique constraint if not exists
    conn.execute(sa.text("""
        DO $$ BEGIN
            ALTER TABLE student_badges
                ADD CONSTRAINT uq_student_badge UNIQUE (student_id, badge_key);
        EXCEPTION WHEN duplicate_table THEN NULL;
        END $$
    """))

    # ── 3. student_streaks ───────────────────────────────────────────────
    conn.execute(sa.text("""
        CREATE TABLE IF NOT EXISTS student_streaks (
            id SERIAL PRIMARY KEY,
            student_id INTEGER NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
            current_streak INTEGER NOT NULL DEFAULT 0,
            longest_streak INTEGER NOT NULL DEFAULT 0,
            last_activity_date TIMESTAMPTZ,
            updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )
    """))
    conn.execute(sa.text("""
        CREATE INDEX IF NOT EXISTS ix_student_streaks_student_id
        ON student_streaks(student_id)
    """))

    # ── 4. parent_invite_codes ───────────────────────────────────────────
    conn.execute(sa.text("""
        CREATE TABLE IF NOT EXISTS parent_invite_codes (
            id SERIAL PRIMARY KEY,
            code VARCHAR(12) NOT NULL UNIQUE,
            student_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            created_by INTEGER NOT NULL REFERENCES users(id),
            expires_at TIMESTAMPTZ NOT NULL,
            used BOOLEAN NOT NULL DEFAULT false,
            used_by INTEGER REFERENCES users(id),
            used_at TIMESTAMPTZ,
            created_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )
    """))
    conn.execute(sa.text("""
        CREATE INDEX IF NOT EXISTS ix_parent_invite_codes_code
        ON parent_invite_codes(code)
    """))
    # Add missing columns on existing tables
    conn.execute(sa.text("""
        ALTER TABLE parent_invite_codes
            ADD COLUMN IF NOT EXISTS used BOOLEAN NOT NULL DEFAULT false
    """))
    conn.execute(sa.text("""
        ALTER TABLE parent_invite_codes
            ADD COLUMN IF NOT EXISTS used_by INTEGER REFERENCES users(id)
    """))

    # ── 5. parent_student_links ──────────────────────────────────────────
    conn.execute(sa.text("""
        CREATE TABLE IF NOT EXISTS parent_student_links (
            id SERIAL PRIMARY KEY,
            parent_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            student_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            is_active BOOLEAN NOT NULL DEFAULT true,
            linked_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )
    """))
    # Add unique constraint if not exists
    conn.execute(sa.text("""
        DO $$ BEGIN
            ALTER TABLE parent_student_links
                ADD CONSTRAINT uq_parent_student UNIQUE (parent_id, student_id);
        EXCEPTION WHEN duplicate_table THEN NULL;
        END $$
    """))
    # Add missing column on existing table
    conn.execute(sa.text("""
        ALTER TABLE parent_student_links
            ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT true
    """))

    # ── 6. feedbacks ─────────────────────────────────────────────────────
    # Rename feedback → feedbacks if old name exists
    conn.execute(sa.text("""
        DO $$ BEGIN
            IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'feedback' AND table_schema = 'public')
               AND NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'feedbacks' AND table_schema = 'public')
            THEN
                ALTER TABLE feedback RENAME TO feedbacks;
            END IF;
        END $$
    """))
    conn.execute(sa.text("""
        CREATE TABLE IF NOT EXISTS feedbacks (
            id SERIAL PRIMARY KEY,
            user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            category VARCHAR(50) NOT NULL,
            title VARCHAR(200) NOT NULL,
            description TEXT,
            page_url VARCHAR(500),
            status VARCHAR(20) NOT NULL DEFAULT 'open',
            created_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )
    """))
    # Add missing columns on existing table (renamed from feedback)
    conn.execute(sa.text("""
        ALTER TABLE feedbacks ADD COLUMN IF NOT EXISTS category VARCHAR(50) NOT NULL DEFAULT 'general'
    """))
    conn.execute(sa.text("""
        ALTER TABLE feedbacks ADD COLUMN IF NOT EXISTS title VARCHAR(200) NOT NULL DEFAULT ''
    """))
    conn.execute(sa.text("""
        ALTER TABLE feedbacks ADD COLUMN IF NOT EXISTS description TEXT
    """))

    # ── 7. Fix dictionary_cache column mismatches ────────────────────────
    conn.execute(sa.text("""
        ALTER TABLE dictionary_cache ADD COLUMN IF NOT EXISTS definitions JSONB
    """))
    conn.execute(sa.text("""
        ALTER TABLE dictionary_cache ADD COLUMN IF NOT EXISTS raw_response TEXT
    """))
    conn.execute(sa.text("""
        ALTER TABLE dictionary_cache ADD COLUMN IF NOT EXISTS fetched_at TIMESTAMPTZ DEFAULT now()
    """))
    conn.execute(sa.text("""
        ALTER TABLE dictionary_cache ADD COLUMN IF NOT EXISTS not_found INTEGER NOT NULL DEFAULT 0
    """))

    # ── 8. Fix teacher_notification_reads column names ───────────────────
    # Rename user_id → teacher_id if needed
    conn.execute(sa.text("""
        DO $$ BEGIN
            IF EXISTS (
                SELECT 1 FROM information_schema.columns
                WHERE table_name = 'teacher_notification_reads' AND column_name = 'user_id'
            ) THEN
                ALTER TABLE teacher_notification_reads RENAME COLUMN user_id TO teacher_id;
            END IF;
        END $$
    """))
    # Rename notification_type → alert_key if needed
    conn.execute(sa.text("""
        DO $$ BEGIN
            IF EXISTS (
                SELECT 1 FROM information_schema.columns
                WHERE table_name = 'teacher_notification_reads' AND column_name = 'notification_type'
            ) THEN
                ALTER TABLE teacher_notification_reads RENAME COLUMN notification_type TO alert_key;
            END IF;
        END $$
    """))
    # Drop notification_id if exists
    conn.execute(sa.text("""
        ALTER TABLE teacher_notification_reads DROP COLUMN IF EXISTS notification_id
    """))


def downgrade() -> None:
    # Downgrade is intentionally minimal — these tables can be dropped on fresh DBs
    # but should NOT be dropped on production.
    pass
