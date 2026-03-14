"""catch-up migration: gamification, parent links, feedback, column + schema fixes

Creates tables that were manually added via SQL but never tracked by Alembic:
- student_xp_log, student_badges, student_streaks (gamification)
- parent_invite_codes, parent_student_links (parent system)
- feedbacks (user feedback)

Also fixes column mismatches on dictionary_cache and teacher_notification_reads,
and aligns learning_sessions (timestamp→timestamptz, json→jsonb), adds missing
UNIQUE constraints (texts, organizations, teacher_notification_reads).

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

    # ── 9. learning_sessions: completed_at timestamp → timestamptz ─────
    conn.execute(sa.text("""
        ALTER TABLE learning_sessions
            ALTER COLUMN completed_at TYPE TIMESTAMPTZ USING completed_at AT TIME ZONE 'UTC'
    """))

    # ── 10. learning_sessions: json → jsonb for 4 result columns ───────
    conn.execute(sa.text("""
        ALTER TABLE learning_sessions
            ALTER COLUMN reading_result TYPE JSONB USING reading_result::jsonb
    """))
    conn.execute(sa.text("""
        ALTER TABLE learning_sessions
            ALTER COLUMN comprehension_result TYPE JSONB USING comprehension_result::jsonb
    """))
    conn.execute(sa.text("""
        ALTER TABLE learning_sessions
            ALTER COLUMN vocab_result TYPE JSONB USING vocab_result::jsonb
    """))
    conn.execute(sa.text("""
        ALTER TABLE learning_sessions
            ALTER COLUMN full_reading_result TYPE JSONB USING full_reading_result::jsonb
    """))

    # ── 11. texts.lesson_number: add UNIQUE if missing ─────────────────
    conn.execute(sa.text("""
        DO $$ BEGIN
            ALTER TABLE texts
                ADD CONSTRAINT uq_texts_lesson_number UNIQUE (lesson_number);
        EXCEPTION WHEN duplicate_table THEN NULL;
        END $$
    """))

    # ── 12. organizations.name: add UNIQUE if missing ──────────────────
    conn.execute(sa.text("""
        DO $$ BEGIN
            ALTER TABLE organizations
                ADD CONSTRAINT uq_organizations_name UNIQUE (name);
        EXCEPTION WHEN duplicate_table THEN NULL;
        END $$
    """))

    # ── 13. teacher_notification_reads: add composite UNIQUE ───────────
    conn.execute(sa.text("""
        DO $$ BEGIN
            ALTER TABLE teacher_notification_reads
                ADD CONSTRAINT uq_teacher_alert_read UNIQUE (teacher_id, alert_key);
        EXCEPTION WHEN duplicate_table THEN NULL;
        END $$
    """))

    # ── 14. dictionary_cache.fetched_at: ensure NOT NULL ───────────────
    conn.execute(sa.text("""
        UPDATE dictionary_cache SET fetched_at = now() WHERE fetched_at IS NULL
    """))
    conn.execute(sa.text("""
        ALTER TABLE dictionary_cache ALTER COLUMN fetched_at SET NOT NULL
    """))
    conn.execute(sa.text("""
        ALTER TABLE dictionary_cache ALTER COLUMN fetched_at SET DEFAULT now()
    """))

    # ── 15. NOT NULL fixes (ORM says NOT NULL, DB allows NULL) ─────────
    # Guard with IF EXISTS so this is safe on fresh preview DBs where
    # assignment tables may not have been created yet.
    conn.execute(sa.text("""
        DO $$
        BEGIN
            IF EXISTS (
                SELECT 1 FROM information_schema.tables
                WHERE table_schema = 'public' AND table_name = 'assignment_submissions'
            ) THEN
                UPDATE assignment_submissions SET status = 'pending' WHERE status IS NULL;
                ALTER TABLE assignment_submissions ALTER COLUMN status SET NOT NULL;
            END IF;
        END
        $$
    """))
    conn.execute(sa.text("""
        DO $$
        BEGIN
            IF EXISTS (
                SELECT 1 FROM information_schema.tables
                WHERE table_schema = 'public' AND table_name = 'assignments'
            ) THEN
                UPDATE assignments SET assignment_type = 'reading' WHERE assignment_type IS NULL;
                ALTER TABLE assignments ALTER COLUMN assignment_type SET NOT NULL;
            END IF;
        END
        $$
    """))
    conn.execute(sa.text("""
        UPDATE error_corrections SET correction_type = 'practice' WHERE correction_type IS NULL
    """))
    conn.execute(sa.text("""
        ALTER TABLE error_corrections ALTER COLUMN correction_type SET NOT NULL
    """))

    # ── 16. Column type/length fixes ───────────────────────────────────
    # parent_invite_codes.code: VARCHAR(20) → VARCHAR(12)
    conn.execute(sa.text("""
        ALTER TABLE parent_invite_codes ALTER COLUMN code TYPE VARCHAR(12)
    """))
    # teacher_notification_reads.alert_key: VARCHAR(50) → VARCHAR(200)
    conn.execute(sa.text("""
        ALTER TABLE teacher_notification_reads ALTER COLUMN alert_key TYPE VARCHAR(200)
    """))
    # teacher_notification_reads.read_at: NOT NULL → nullable (ORM has nullable=True)
    conn.execute(sa.text("""
        ALTER TABLE teacher_notification_reads ALTER COLUMN read_at DROP NOT NULL
    """))

    # ── 17. ON DELETE CASCADE fixes for FKs ────────────────────────────
    # student_xp_log.student_id
    conn.execute(sa.text("""
        DO $$ BEGIN
            ALTER TABLE student_xp_log DROP CONSTRAINT IF EXISTS student_xp_log_user_id_fkey;
            ALTER TABLE student_xp_log DROP CONSTRAINT IF EXISTS student_xp_log_student_id_fkey;
            ALTER TABLE student_xp_log
                ADD CONSTRAINT student_xp_log_student_id_fkey
                FOREIGN KEY (student_id) REFERENCES users(id) ON DELETE CASCADE;
        END $$
    """))
    # student_badges.student_id
    conn.execute(sa.text("""
        DO $$ BEGIN
            ALTER TABLE student_badges DROP CONSTRAINT IF EXISTS student_badges_user_id_fkey;
            ALTER TABLE student_badges DROP CONSTRAINT IF EXISTS student_badges_student_id_fkey;
            ALTER TABLE student_badges
                ADD CONSTRAINT student_badges_student_id_fkey
                FOREIGN KEY (student_id) REFERENCES users(id) ON DELETE CASCADE;
        END $$
    """))
    # student_streaks.student_id
    conn.execute(sa.text("""
        DO $$ BEGIN
            ALTER TABLE student_streaks DROP CONSTRAINT IF EXISTS student_streaks_user_id_fkey;
            ALTER TABLE student_streaks DROP CONSTRAINT IF EXISTS student_streaks_student_id_fkey;
            ALTER TABLE student_streaks
                ADD CONSTRAINT student_streaks_student_id_fkey
                FOREIGN KEY (student_id) REFERENCES users(id) ON DELETE CASCADE;
        END $$
    """))
    # parent_invite_codes.student_id
    conn.execute(sa.text("""
        DO $$ BEGIN
            ALTER TABLE parent_invite_codes DROP CONSTRAINT IF EXISTS parent_invite_codes_student_id_fkey;
            ALTER TABLE parent_invite_codes
                ADD CONSTRAINT parent_invite_codes_student_id_fkey
                FOREIGN KEY (student_id) REFERENCES users(id) ON DELETE CASCADE;
        END $$
    """))
    # parent_student_links.parent_id + student_id
    conn.execute(sa.text("""
        DO $$ BEGIN
            ALTER TABLE parent_student_links DROP CONSTRAINT IF EXISTS parent_student_links_parent_id_fkey;
            ALTER TABLE parent_student_links DROP CONSTRAINT IF EXISTS parent_student_links_student_id_fkey;
            ALTER TABLE parent_student_links
                ADD CONSTRAINT parent_student_links_parent_id_fkey
                FOREIGN KEY (parent_id) REFERENCES users(id) ON DELETE CASCADE;
            ALTER TABLE parent_student_links
                ADD CONSTRAINT parent_student_links_student_id_fkey
                FOREIGN KEY (student_id) REFERENCES users(id) ON DELETE CASCADE;
        END $$
    """))

    # ── 18. Index fixes ────────────────────────────────────────────────
    # Add missing indexes
    conn.execute(sa.text("""
        CREATE INDEX IF NOT EXISTS ix_classroom_texts_expires_at ON classroom_texts(expires_at)
    """))
    conn.execute(sa.text("""
        CREATE INDEX IF NOT EXISTS ix_learning_sessions_student_id ON learning_sessions(student_id)
    """))
    # Remove stale composite index (replaced by single-column index above)
    conn.execute(sa.text("""
        DROP INDEX IF EXISTS ix_learning_sessions_student_status
    """))
    # Remove extra feedbacks index (ORM doesn't define it)
    conn.execute(sa.text("""
        DROP INDEX IF EXISTS ix_feedbacks_user_id
    """))

    # ── 19. Clean up duplicate unique constraints on student_streaks ───
    conn.execute(sa.text("""
        DO $$ BEGIN
            ALTER TABLE student_streaks DROP CONSTRAINT IF EXISTS student_streaks_user_id_key;
        END $$
    """))
    conn.execute(sa.text("""
        DO $$ BEGIN
            ALTER TABLE student_streaks DROP CONSTRAINT IF EXISTS student_streaks_student_id_key;
        END $$
    """))
    # ORM defines unique=True on the column, Alembic expects a unique index
    conn.execute(sa.text("""
        CREATE UNIQUE INDEX IF NOT EXISTS ix_student_streaks_student_id ON student_streaks(student_id)
    """))

    # ── 20. Align unique constraints as indexes (Alembic convention) ───
    # parent_invite_codes.code: constraint → unique index
    conn.execute(sa.text("""
        DO $$ BEGIN
            ALTER TABLE parent_invite_codes DROP CONSTRAINT IF EXISTS parent_invite_codes_code_key;
        END $$
    """))
    conn.execute(sa.text("""
        CREATE UNIQUE INDEX IF NOT EXISTS ix_parent_invite_codes_code ON parent_invite_codes(code)
    """))
    # texts.lesson_number: drop redundant named constraint (unique index already exists)
    conn.execute(sa.text("""
        DO $$ BEGIN
            ALTER TABLE texts DROP CONSTRAINT IF EXISTS uq_texts_lesson_number;
        END $$
    """))
    # users: replace UNIQUE constraints with Alembic-style unique indexes
    conn.execute(sa.text("""
        DO $$ BEGIN
            ALTER TABLE users DROP CONSTRAINT IF EXISTS uq_users_username;
            ALTER TABLE users DROP CONSTRAINT IF EXISTS users_email_key;
            ALTER TABLE users DROP CONSTRAINT IF EXISTS users_google_id_key;
        END $$
    """))
    conn.execute(sa.text("""
        DROP INDEX IF EXISTS ix_users_google_id
    """))
    conn.execute(sa.text("""
        CREATE UNIQUE INDEX IF NOT EXISTS ix_users_google_id ON users(google_id)
    """))


def downgrade() -> None:
    # Downgrade is intentionally minimal — these tables can be dropped on fresh DBs
    # but should NOT be dropped on production.
    pass
