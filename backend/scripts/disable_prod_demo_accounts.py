"""Disable demo accounts on production DB.

Issue #1575: Demo accounts (admin@test.com, teacher@test.com, student@test.com etc.)
were seeded into prod on first DB provisioning. They need to be deactivated rather
than deleted because they have linked learning sessions / assignments.

Strategy:
  - Set is_active=False so login fails at the auth gate
  - Randomize the password_hash so even if is_active check were bypassed,
    no one can authenticate with the known passwords
  - DO NOT delete rows (seeded assignments + learning sessions reference these user IDs)

Usage:
  DATABASE_URL=<prod-url> python backend/scripts/disable_prod_demo_accounts.py [--dry-run]

The script is IDEMPOTENT — safe to run multiple times.
"""
import argparse
import os
import secrets
import sys

# ---------------------------------------------------------------------------
# Resolve backend package path so the script can run from the repo root
# ---------------------------------------------------------------------------
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
BACKEND_DIR = os.path.dirname(SCRIPT_DIR)
if BACKEND_DIR not in sys.path:
    sys.path.insert(0, BACKEND_DIR)

from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker

DEMO_EMAILS = [
    "admin@test.com",
    "teacher@test.com",
    "teacher2@test.com",
    "student@test.com",
    "student2@test.com",
    "student3@test.com",
]


def _random_unusable_hash() -> str:
    """Return a bcrypt-like prefix with random bytes — not a valid hash."""
    return "$2b$12$DISABLED" + secrets.token_hex(22)


def run(database_url: str, dry_run: bool = False) -> None:
    engine = create_engine(database_url, echo=False)
    Session = sessionmaker(bind=engine)
    db = Session()

    try:
        rows = db.execute(
            text(
                "SELECT id, email, is_active FROM users WHERE email = ANY(:emails)"
            ),
            {"emails": DEMO_EMAILS},
        ).fetchall()

        if not rows:
            print("No demo accounts found in the database. Nothing to do.")
            return

        print(f"Found {len(rows)} demo account(s):")
        for row in rows:
            status = "ACTIVE" if row.is_active else "already inactive"
            print(f"  id={row.id}  email={row.email}  [{status}]")

        if dry_run:
            print("\n[DRY RUN] No changes made.")
            return

        for row in rows:
            db.execute(
                text(
                    "UPDATE users SET is_active = false, password_hash = :ph "
                    "WHERE id = :uid"
                ),
                {"ph": _random_unusable_hash(), "uid": row.id},
            )

        db.commit()
        print(f"\nDisabled {len(rows)} demo account(s). is_active=false + password randomized.")

        # Verify
        after = db.execute(
            text("SELECT email, is_active FROM users WHERE email = ANY(:emails)"),
            {"emails": DEMO_EMAILS},
        ).fetchall()
        print("\nVerification:")
        for row in after:
            print(f"  {row.email}  is_active={row.is_active}")

    finally:
        db.close()


def main() -> None:
    parser = argparse.ArgumentParser(description="Disable demo accounts on prod DB.")
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Print what would be done without making changes.",
    )
    args = parser.parse_args()

    database_url = os.environ.get("DATABASE_URL")
    if not database_url:
        print("ERROR: DATABASE_URL env var is required.", file=sys.stderr)
        sys.exit(1)

    # Safety guard: refuse to run against SQLite (local dev DB)
    if database_url.startswith("sqlite"):
        print("ERROR: Refusing to run against SQLite (looks like a local dev DB).", file=sys.stderr)
        sys.exit(1)

    print(f"Target DB: {database_url[:30]}...  [dry_run={args.dry_run}]")
    run(database_url, dry_run=args.dry_run)


if __name__ == "__main__":
    main()
