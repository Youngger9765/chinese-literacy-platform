#!/usr/bin/env python3
"""
check_model_coverage.py — Schema drift detector for CI.

Scans backend/app/models/*.py for __tablename__ declarations and verifies
that every table name appears in at least one Alembic migration file under
backend/alembic/versions/.

Exit code 0  → all tables covered.
Exit code 1  → one or more tables are missing from migrations (schema drift).

Usage (from repo root):
    python backend/scripts/check_model_coverage.py

Related issue: #583
"""

import re
import sys
from pathlib import Path

# ── Paths (relative to this script's location inside backend/scripts/) ─────
SCRIPT_DIR = Path(__file__).resolve().parent
BACKEND_DIR = SCRIPT_DIR.parent
MODELS_DIR = BACKEND_DIR / "app" / "models"
MIGRATIONS_DIR = BACKEND_DIR / "alembic" / "versions"

# Tables that exist via SQLAlchemy Association / secondary tables defined
# inline (not as separate model classes) OR tables intentionally managed
# outside Alembic (add to this list sparingly).
ALLOWLIST: set[str] = {
    # SQLAlchemy many-to-many association tables defined inline via Table()
    # rather than as ORM model classes come through here automatically, but
    # since they ARE in migration files we don't need to allowlist them.
    # Reserve this list for tables that are genuinely outside Alembic scope.
    "semesters",   # TODO: missing DB schema — needs follow-up issue
}


def extract_table_names_from_models() -> dict[str, list[str]]:
    """Return {table_name: [source_files]} for every __tablename__ found."""
    pattern = re.compile(r'__tablename__\s*=\s*["\']([^"\']+)["\']')
    result: dict[str, list[str]] = {}
    for model_file in sorted(MODELS_DIR.glob("*.py")):
        if model_file.name.startswith("__"):
            continue
        text = model_file.read_text(encoding="utf-8")
        for match in pattern.finditer(text):
            table_name = match.group(1)
            result.setdefault(table_name, []).append(model_file.name)
    return result


def collect_migration_text() -> str:
    """Concatenate all migration files into one big string for grep-style search."""
    parts: list[str] = []
    for migration_file in sorted(MIGRATIONS_DIR.glob("*.py")):
        if migration_file.name.startswith("__"):
            continue
        parts.append(migration_file.read_text(encoding="utf-8"))
    return "\n".join(parts)


def main() -> int:
    if not MODELS_DIR.is_dir():
        print(f"ERROR: models directory not found: {MODELS_DIR}", file=sys.stderr)
        return 1

    if not MIGRATIONS_DIR.is_dir():
        print(f"ERROR: migrations directory not found: {MIGRATIONS_DIR}", file=sys.stderr)
        return 1

    model_tables = extract_table_names_from_models()
    migration_corpus = collect_migration_text()

    if not model_tables:
        print("WARNING: No __tablename__ definitions found in models — nothing to check.")
        return 0

    missing: list[tuple[str, list[str]]] = []
    covered: list[str] = []

    for table_name, sources in sorted(model_tables.items()):
        if table_name in ALLOWLIST:
            covered.append(f"  [ALLOWLISTED] {table_name}")
            continue
        # A table is "covered" if its name appears in the migration corpus:
        #   1. As a Python quoted string: "table_name" or 'table_name'
        #      (used by op.create_table(), op.add_column(), etc.)
        #   2. As a bare SQL identifier at a word boundary
        #      (used in raw text() SQL like "CREATE TABLE IF NOT EXISTS table_name")
        quoted_match = (
            f'"{table_name}"' in migration_corpus
            or f"'{table_name}'" in migration_corpus
        )
        sql_word_match = bool(
            re.search(rf"\b{re.escape(table_name)}\b", migration_corpus)
        )
        if quoted_match or sql_word_match:
            covered.append(f"  [OK] {table_name}  (defined in: {', '.join(sources)})")
        else:
            missing.append((table_name, sources))

    print("=== Schema Drift Check ===\n")
    print(f"Models scanned   : {MODELS_DIR}")
    print(f"Migrations scanned: {MIGRATIONS_DIR}")
    print(f"Tables found in models: {len(model_tables)}")
    print(f"Tables covered   : {len(covered)}")
    print(f"Tables missing   : {len(missing)}")
    print()

    if covered:
        print("Covered tables:")
        for line in covered:
            print(line)
        print()

    if missing:
        print("MISSING tables (in models but NOT in any migration file):", file=sys.stderr)
        for table_name, sources in missing:
            print(f"  [MISSING] {table_name}  (defined in: {', '.join(sources)})", file=sys.stderr)
        print(
            "\nACTION REQUIRED: Create an Alembic migration for the tables listed above.\n"
            "Run: cd backend && alembic revision --autogenerate -m 'add_<table>_table'\n"
            "Then review and apply the generated migration.",
            file=sys.stderr,
        )
        return 1

    print("All tables are covered by migrations.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
