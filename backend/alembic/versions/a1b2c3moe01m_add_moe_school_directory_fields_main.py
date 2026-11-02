"""
MAIN-BRANCH COPY (2026-11-02): prod got #3804 before the game-mode
migrations (988d8bc90428 etc.), so this copy chains off main's head with a
distinct revision id. staging keeps a1b2c3moe01 (down=988d8bc90428). When
staging is later merged to main, alembic will see two heads; add a merge
revision. Both copies are idempotent (IF NOT EXISTS / column checks), so
the staging copy is a no-op on prod.
add MOE school directory fields to schools (#3804 §4.2)

Revision ID: a1b2c3moe01
Revises: 988d8bc90428
Create Date: 2026-11-01 00:00:00.000000

Idempotent DDL: checks information_schema.columns before each ADD COLUMN,
and wraps CREATE INDEX in IF NOT EXISTS — safe to re-run on a shared
preview/staging DB (see sqlalchemy-model-safety skill Rule 6).

Adds (all nullable — zero impact on existing rows):
  moe_school_code  VARCHAR(20)  UNIQUE indexed — the national MOE school code
  county_code      VARCHAR(10)             — raw source bracket code, provenance only
  county_name      VARCHAR(50)  indexed    — human county name, used by directory search
  school_level     VARCHAR(10)  indexed    — elementary | junior_high | senior_high
  is_public        BOOLEAN                 — from source 公/私立 column

See backend/data/moe_schools/README.md for the data source and
docs/prd/2026-11-01-school-as-teacher-attribute-prd.md §4.2 for why these
five columns and why county_code is NOT a stable county key.
"""
from typing import Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "a1b2c3moe01m"
down_revision: Union[str, None] = "6151124daac8"
branch_labels = None
depends_on = None


_NEW_COLUMNS = [
    ("moe_school_code", sa.String(20)),
    ("county_code", sa.String(10)),
    ("county_name", sa.String(50)),
    ("school_level", sa.String(10)),
    ("is_public", sa.Boolean()),
]


def _column_exists(conn, table: str, column: str) -> bool:
    result = conn.execute(
        sa.text(
            "SELECT column_name FROM information_schema.columns "
            "WHERE table_name = :table AND column_name = :column"
        ),
        {"table": table, "column": column},
    )
    return result.fetchone() is not None


def upgrade() -> None:
    conn = op.get_bind()

    for name, col_type in _NEW_COLUMNS:
        if not _column_exists(conn, "schools", name):
            op.add_column("schools", sa.Column(name, col_type, nullable=True))

    op.execute(
        "CREATE UNIQUE INDEX IF NOT EXISTS ix_schools_moe_school_code "
        "ON schools (moe_school_code)"
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_schools_county_name ON schools (county_name)"
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_schools_school_level ON schools (school_level)"
    )


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS ix_schools_school_level")
    op.execute("DROP INDEX IF EXISTS ix_schools_county_name")
    op.execute("DROP INDEX IF EXISTS ix_schools_moe_school_code")

    conn = op.get_bind()
    for name, _col_type in reversed(_NEW_COLUMNS):
        if _column_exists(conn, "schools", name):
            op.drop_column("schools", name)
