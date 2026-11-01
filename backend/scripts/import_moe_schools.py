#!/usr/bin/env python3
"""import_moe_schools.py — load the official MOE school directory (#3804 §4.2).

Reads backend/data/moe_schools/{elementary,junior_high,senior_high}.csv and
upserts them into the `schools` table, keyed on moe_school_code. Safe to
re-run (idempotent upsert — see app/services/moe_school_import.py).

Does NOT touch any pre-existing school row where moe_school_code is NULL
(domain-auto-created / manually-created schools stay exactly as they were).

Usage:
    cd backend
    python scripts/import_moe_schools.py              # import against $DATABASE_URL
    python scripts/import_moe_schools.py --dry-run     # parse + count only, no DB writes
"""
import argparse
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from app.database import SessionLocal
from app.services.moe_school_import import load_moe_school_rows, import_moe_schools


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Parse the source CSVs and print counts without touching the database.",
    )
    args = parser.parse_args()

    rows = load_moe_school_rows()

    by_level: dict[str, int] = {}
    for row in rows:
        by_level[row["school_level"]] = by_level.get(row["school_level"], 0) + 1

    print(f"Parsed {len(rows)} valid rows from backend/data/moe_schools/:")
    for level in ("elementary", "junior_high", "senior_high"):
        print(f"  {level}: {by_level.get(level, 0)}")

    codes = [r["moe_school_code"] for r in rows]
    if len(codes) != len(set(codes)):
        print("ERROR: duplicate moe_school_code across the parsed rows — aborting.", file=sys.stderr)
        sys.exit(1)

    if args.dry_run:
        print("--dry-run: no database writes performed.")
        return

    db = SessionLocal()
    try:
        result = import_moe_schools(db, rows)
    finally:
        db.close()

    print(f"Imported: created={result.created} updated={result.updated}")
    unchanged = len(rows) - result.created - result.updated
    print(f"Unchanged (already up to date): {unchanged}")


if __name__ == "__main__":
    main()
