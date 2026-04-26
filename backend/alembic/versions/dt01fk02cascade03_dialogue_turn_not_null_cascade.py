"""fix: DialogueTurn.learning_session_id NOT NULL + CASCADE (Issue #1189)

Revision ID: dt01fk02cascade03
Revises: px01perf02idx03
Create Date: 2026-04-26 00:00:00.000000

Migration steps:
1. DELETE orphaned dialogue_turns (learning_session_id IS NULL)
2. DROP existing nullable FK constraint
3. ALTER COLUMN learning_session_id SET NOT NULL
4. ADD FK with ON DELETE CASCADE

Decision: orphaned rows are deleted (not re-linked) because they have no
recoverable parent session — re-linking to a placeholder would produce
incorrect teacher history data. Deleting is the safer integrity choice.

All DDL is idempotent — safe to re-run on preview-db / staging-db.
"""

from typing import Union
from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect as sa_inspect

# revision identifiers, used by Alembic.
revision: str = "dt01fk02cascade03"
down_revision: Union[str, None] = "px01perf02idx03"
branch_labels = None
depends_on = None


def _fk_exists(bind, table_name: str, fk_name: str) -> bool:
    """Check if a FK constraint exists by name."""
    return any(
        fk["name"] == fk_name
        for fk in sa_inspect(bind).get_foreign_keys(table_name)
    )


def _column_nullable(bind, table_name: str, column_name: str) -> bool:
    """Return True if the column is currently nullable."""
    cols = sa_inspect(bind).get_columns(table_name)
    for col in cols:
        if col["name"] == column_name:
            return col.get("nullable", True)
    return True


def _table_exists(bind, table_name: str) -> bool:
    return table_name in sa_inspect(bind).get_table_names()


def upgrade() -> None:
    bind = op.get_bind()

    if not _table_exists(bind, "dialogue_turns"):
        # Table doesn't exist yet (fresh DB) — nothing to migrate.
        return

    # ── Step 1: Delete orphaned rows ─────────────────────────────────────────
    # Safe to run multiple times: DELETE WHERE NULL is a no-op when none exist.
    result = bind.execute(
        sa.text("SELECT COUNT(*) FROM dialogue_turns WHERE learning_session_id IS NULL")
    )
    orphan_count = result.scalar()
    if orphan_count and orphan_count > 0:
        bind.execute(
            sa.text("DELETE FROM dialogue_turns WHERE learning_session_id IS NULL")
        )
        # Log for audit visibility in migration output
        print(f"  [#1189] Deleted {orphan_count} orphaned dialogue_turns rows.")
    else:
        print("  [#1189] No orphaned dialogue_turns rows found.")

    # ── Step 2: Drop old nullable FK (no cascade) ────────────────────────────
    # The original FK was created by SQLAlchemy auto-naming as
    # dialogue_turns_learning_session_id_fkey (PostgreSQL convention).
    # We drop and re-add with ON DELETE CASCADE.
    old_fk_name = "dialogue_turns_learning_session_id_fkey"

    # Check if old FK exists before dropping (idempotency guard).
    # PostgreSQL: query information_schema because sa_inspect FK name may vary.
    fk_exists_result = bind.execute(sa.text(
        "SELECT COUNT(*) FROM information_schema.table_constraints "
        "WHERE constraint_type = 'FOREIGN KEY' "
        "AND table_name = 'dialogue_turns' "
        "AND constraint_name = :fk_name"
    ), {"fk_name": old_fk_name})
    if fk_exists_result.scalar() > 0:
        op.drop_constraint(
            old_fk_name,
            "dialogue_turns",
            type_="foreignkey",
        )

    # ── Step 3: Set NOT NULL on the column ───────────────────────────────────
    # Only alter if currently nullable (idempotency guard).
    if _column_nullable(bind, "dialogue_turns", "learning_session_id"):
        op.alter_column(
            "dialogue_turns",
            "learning_session_id",
            existing_type=sa.Integer(),
            nullable=False,
        )

    # ── Step 4: Re-add FK with ON DELETE CASCADE ──────────────────────────────
    # Check if new FK already exists before creating (idempotency guard).
    new_fk_exists = bind.execute(sa.text(
        "SELECT COUNT(*) FROM information_schema.referential_constraints rc "
        "JOIN information_schema.table_constraints tc "
        "  ON rc.constraint_name = tc.constraint_name "
        "WHERE tc.table_name = 'dialogue_turns' "
        "AND rc.delete_rule = 'CASCADE' "
        "AND tc.constraint_type = 'FOREIGN KEY'"
    ))
    if new_fk_exists.scalar() == 0:
        op.create_foreign_key(
            "dialogue_turns_learning_session_id_fkey",
            "dialogue_turns",
            "learning_sessions",
            ["learning_session_id"],
            ["id"],
            ondelete="CASCADE",
        )


def downgrade() -> None:
    bind = op.get_bind()

    if not _table_exists(bind, "dialogue_turns"):
        return

    # ── Drop CASCADE FK ───────────────────────────────────────────────────────
    cascade_fk_exists = bind.execute(sa.text(
        "SELECT COUNT(*) FROM information_schema.referential_constraints rc "
        "JOIN information_schema.table_constraints tc "
        "  ON rc.constraint_name = tc.constraint_name "
        "WHERE tc.table_name = 'dialogue_turns' "
        "AND rc.delete_rule = 'CASCADE' "
        "AND tc.constraint_type = 'FOREIGN KEY'"
    ))
    if cascade_fk_exists.scalar() > 0:
        op.drop_constraint(
            "dialogue_turns_learning_session_id_fkey",
            "dialogue_turns",
            type_="foreignkey",
        )

    # ── Restore nullable ──────────────────────────────────────────────────────
    if not _column_nullable(bind, "dialogue_turns", "learning_session_id"):
        op.alter_column(
            "dialogue_turns",
            "learning_session_id",
            existing_type=sa.Integer(),
            nullable=True,
        )

    # ── Restore original nullable FK (no cascade) ─────────────────────────────
    old_fk_exists = bind.execute(sa.text(
        "SELECT COUNT(*) FROM information_schema.table_constraints "
        "WHERE constraint_type = 'FOREIGN KEY' "
        "AND table_name = 'dialogue_turns' "
        "AND constraint_name = 'dialogue_turns_learning_session_id_fkey'"
    ))
    if old_fk_exists.scalar() == 0:
        op.create_foreign_key(
            "dialogue_turns_learning_session_id_fkey",
            "dialogue_turns",
            "learning_sessions",
            ["learning_session_id"],
            ["id"],
            # No ondelete — matches original nullable FK behaviour
        )
