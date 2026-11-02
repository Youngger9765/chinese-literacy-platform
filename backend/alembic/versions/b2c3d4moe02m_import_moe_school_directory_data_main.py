"""import MOE school directory data into schools (#3804 §4.2 follow-up)

Revision ID: b2c3d4moe02
Revises: a1b2c3moe01
Create Date: 2026-11-02 00:00:00.000000

Why this migration exists: a1b2c3moe01 only added the moe_school_code /
county_code / county_name / school_level / is_public COLUMNS. It never
populated them — scripts/import_moe_schools.py is a standalone CLI script
that nothing in the deploy pipeline invokes, so staging deployed with the
schema but zero imported rows (GET /api/schools/directory/search returned
items: [] for every query, confirmed against the live staging URL
2026-11-02). This migration is the DATA half, kept separate from the
schema migration per standard practice (schema and data changes in one
migration are harder to reason about and to roll back independently).

Reuses app.services.moe_school_import's load_moe_school_rows() /
import_moe_schools() directly — the exact same parsing + upsert-by-
moe_school_code logic already covered by tests/test_moe_school_import_3804.py
and tests/test_moe_school_search_eval_3804.py, rather than re-implementing
a second copy of the same logic inside the migration (this follows
Alembic's own documented pattern for using the ORM inside a migration —
https://alembic.sqlalchemy.org/en/latest/cookbook.html — "Using the ORM
in a migration").

Idempotent: import_moe_schools() upserts by moe_school_code, so a retried
or re-run upgrade() produces the same 3855 rows, not duplicates (see
tests/test_moe_school_directory_data_migration_3804.py::
test_upgrade_is_idempotent_on_rerun). The CSV data is baked into the
Docker image (backend/data/moe_schools/*.csv is not excluded by
.dockerignore — verified below) so this runs the same way in every
environment the image is deployed to (preview / staging / prod).

Downgrade only removes schools.moe_school_code IS NOT NULL rows that are
NOT referenced by any classrooms.school_id or any user_roles row with
scope_type='school' pointing at them — once the self-serve-teacher flow
(#3806) ships, real teachers can attach themselves to one of these
directory rows by name, and downgrading must never silently delete a
school a real teacher or classroom depends on.
"""
from typing import Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "b2c3d4moe02m"
down_revision: Union[str, None] = "a1b2c3moe01m"
branch_labels = None
depends_on = None


def upgrade() -> None:
    from sqlalchemy.orm import Session

    from app.services.moe_school_import import import_moe_schools, load_moe_school_rows

    # a1b2c3moe01 created school_level as VARCHAR(10), but "junior_high" and
    # "senior_high" are 11 chars; Postgres rejected the import on staging
    # (2026-11-02). Widen before inserting. Idempotent: widening is a no-op
    # if already VARCHAR(20).
    # SQLite (tests) cannot ALTER a column type and does not enforce VARCHAR length.
    if op.get_bind().dialect.name != "sqlite":
        op.alter_column("schools", "school_level", type_=sa.String(20), existing_nullable=True)

    bind = op.get_bind()
    session = Session(bind=bind)
    try:
        rows = load_moe_school_rows()
        import_moe_schools(session, rows)
    finally:
        session.close()


def downgrade() -> None:
    conn = op.get_bind()

    candidate_ids = [
        row[0]
        for row in conn.execute(
            sa.text("SELECT id FROM schools WHERE moe_school_code IS NOT NULL")
        )
    ]
    if not candidate_ids:
        return

    referenced_by_classroom = {
        row[0]
        for row in conn.execute(
            sa.text(
                "SELECT DISTINCT school_id FROM classrooms WHERE school_id IN :ids"
            ).bindparams(sa.bindparam("ids", expanding=True)),
            {"ids": candidate_ids},
        )
    }

    candidate_ids_str = [str(i) for i in candidate_ids]
    referenced_by_user_role = {
        int(row[0])
        for row in conn.execute(
            sa.text(
                "SELECT DISTINCT scope_id FROM user_roles "
                "WHERE scope_type = 'school' AND scope_id IN :ids"
            ).bindparams(sa.bindparam("ids", expanding=True)),
            {"ids": candidate_ids_str},
        )
        if row[0] is not None and str(row[0]).isdigit()
    }

    safe_to_delete = [
        i for i in candidate_ids if i not in referenced_by_classroom and i not in referenced_by_user_role
    ]
    if safe_to_delete:
        conn.execute(
            sa.text("DELETE FROM schools WHERE id IN :ids").bindparams(
                sa.bindparam("ids", expanding=True)
            ),
            {"ids": safe_to_delete},
        )
