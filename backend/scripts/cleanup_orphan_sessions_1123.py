#!/usr/bin/env python3
"""cleanup_orphan_sessions_1123.py — Issue #1123: one-off cleanup for orphan LearningSession rows.

Finds LearningSession rows whose story_slug cannot be resolved to a valid lesson
in the texts table (matched by texts.lesson_number) and either updates or soft-deletes them.

Specific handling for the 3 known orphan slugs on staging:
  - "esson-1"  → TYPO: update story_slug to "1" if lesson 1 exists in texts; else soft-delete
  - "45"       → INVALID: soft-delete (no lesson 45 exists)
  - "G4-1"     → LEGACY: soft-delete (old format, unresolvable)

Soft-delete = set status = "abandoned" (no is_deleted column on learning_sessions).

Usage
-----
    cd backend
    export DATABASE_URL="<your-connection-string>"
    python scripts/cleanup_orphan_sessions_1123.py --dry-run    # default, safe
    python scripts/cleanup_orphan_sessions_1123.py --apply      # executes changes

Safety
------
- Defaults to --dry-run (no writes without --apply)
- Wraps all writes in a single transaction; rolls back on any error
- Idempotent: re-running on already-fixed rows is a no-op
- Logs every action to stdout
"""
from __future__ import annotations

import argparse
import logging
import os
import sys
from datetime import datetime, timezone

# Allow running from repo root or from backend/
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(message)s",
    datefmt="%H:%M:%S",
)
logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Slug resolution helpers
# ---------------------------------------------------------------------------

def _normalize(slug: str) -> str:
    """Strip L/l prefix and try to parse as integer string, else return stripped."""
    stripped = slug.lstrip("Ll")
    try:
        return str(int(stripped))
    except ValueError:
        return stripped


def _slug_to_lesson_number(slug: str) -> int | None:
    """Return integer lesson number if slug is resolvable, else None."""
    normalized = _normalize(slug)
    try:
        return int(normalized)
    except ValueError:
        return None


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main() -> None:
    parser = argparse.ArgumentParser(
        description="One-off cleanup for orphan LearningSession rows (Issue #1123)."
    )
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument(
        "--dry-run",
        action="store_true",
        default=True,
        help="Preview actions without writing to DB (default).",
    )
    mode.add_argument(
        "--apply",
        action="store_true",
        default=False,
        help="Execute changes. Required to write to DB.",
    )
    args = parser.parse_args()

    # --apply overrides the default --dry-run
    dry_run = not args.apply

    database_url = os.environ.get("DATABASE_URL")
    if not database_url:
        logger.error("DATABASE_URL environment variable is required.")
        logger.error("  export DATABASE_URL='<driver>://<user>:<pass>@<host>/<dbname>'")
        sys.exit(1)

    if dry_run:
        logger.info("=== DRY-RUN MODE — no writes will be made ===")
        logger.info("    Pass --apply to execute changes.")
    else:
        logger.info("=== APPLY MODE — changes will be written to DB ===")

    from sqlalchemy import create_engine, text as sa_text
    from sqlalchemy.orm import sessionmaker

    import app.models  # noqa: F401 — registers all ORM classes with Base
    from app.models.session import LearningSession
    from app.models.text import Text

    engine = create_engine(database_url, pool_pre_ping=True)
    SessionLocal = sessionmaker(bind=engine, autocommit=False, autoflush=False)
    db = SessionLocal()

    try:
        # ------------------------------------------------------------------
        # Step 1: Build set of valid lesson numbers from texts table
        # ------------------------------------------------------------------
        valid_lesson_numbers: set[int] = {
            row.lesson_number
            for row in db.query(Text.lesson_number).all()
            if row.lesson_number is not None
        }
        logger.info("Loaded %d valid lesson numbers from texts table (range %d..%d).",
                    len(valid_lesson_numbers),
                    min(valid_lesson_numbers) if valid_lesson_numbers else 0,
                    max(valid_lesson_numbers) if valid_lesson_numbers else 0)

        # ------------------------------------------------------------------
        # Step 2: Find orphan sessions — story_slug resolves to a number
        #         not in texts.lesson_number, OR is entirely non-numeric
        # ------------------------------------------------------------------
        all_sessions = (
            db.query(LearningSession)
            .filter(LearningSession.story_slug.isnot(None))
            .all()
        )
        logger.info("Total sessions with story_slug: %d", len(all_sessions))

        orphans: list[LearningSession] = []
        for s in all_sessions:
            lesson_num = _slug_to_lesson_number(s.story_slug)
            if lesson_num is None or lesson_num not in valid_lesson_numbers:
                orphans.append(s)

        logger.info("Orphan sessions found: %d", len(orphans))
        if not orphans:
            logger.info("Nothing to do. Exiting.")
            return

        # ------------------------------------------------------------------
        # Step 3: Print each orphan
        # ------------------------------------------------------------------
        logger.info("")
        logger.info("%-6s  %-10s  %-20s  %-20s  %-6s  %s",
                    "id", "user_id", "story_slug", "created_at", "step", "status")
        logger.info("-" * 90)
        for s in orphans:
            created = s.started_at.strftime("%Y-%m-%d %H:%M") if s.started_at else "unknown"
            steps = (s.step_progress or {}).get("steps_completed", [])
            steps_completed = len(steps) if isinstance(steps, list) else 0
            logger.info("%-6s  %-10s  %-20s  %-20s  %-6s  %s",
                        s.id, s.student_id, repr(s.story_slug), created, steps_completed, s.status)
        logger.info("")

        # ------------------------------------------------------------------
        # Step 4: Decide action per slug
        # ------------------------------------------------------------------
        n_updated = 0
        n_soft_deleted = 0
        n_skipped = 0

        for s in orphans:
            raw_slug = s.story_slug

            # Already abandoned from a previous run → idempotent skip
            if s.status == "abandoned":
                logger.info("[SKIP] session id=%s slug=%r already abandoned — no-op", s.id, raw_slug)
                n_skipped += 1
                continue

            # --- TYPO: "esson-1" → likely meant lesson-1 → canonical slug "1" ---
            if raw_slug == "esson-1":
                target_slug = "1"
                if 1 in valid_lesson_numbers:
                    logger.info(
                        "[UPDATE] session id=%s slug=%r → story_slug=%r (lesson 1 exists in texts)",
                        s.id, raw_slug, target_slug,
                    )
                    if not dry_run:
                        s.story_slug = target_slug
                        # Also resolve text_id so FK is consistent
                        text_record = db.query(Text).filter(Text.lesson_number == 1).first()
                        if text_record:
                            s.text_id = text_record.id
                    n_updated += 1
                else:
                    logger.info(
                        "[SOFT-DELETE] session id=%s slug=%r — lesson 1 not in texts, abandoning",
                        s.id, raw_slug,
                    )
                    if not dry_run:
                        s.status = "abandoned"
                    n_soft_deleted += 1

            # --- INVALID: "45" → no lesson 45, soft-delete ---
            elif raw_slug == "45":
                logger.info(
                    "[SOFT-DELETE] session id=%s slug=%r — no lesson 45 in texts",
                    s.id, raw_slug,
                )
                if not dry_run:
                    s.status = "abandoned"
                n_soft_deleted += 1

            # --- LEGACY / other: "G4-1" etc. → soft-delete ---
            else:
                lesson_num = _slug_to_lesson_number(raw_slug)
                if lesson_num is not None and lesson_num in valid_lesson_numbers:
                    # Resolvable after all (shouldn't reach here but guard anyway)
                    logger.info(
                        "[SKIP] session id=%s slug=%r resolves to lesson %d — already valid",
                        s.id, raw_slug, lesson_num,
                    )
                    n_skipped += 1
                else:
                    logger.info(
                        "[SOFT-DELETE] session id=%s slug=%r — unresolvable legacy slug",
                        s.id, raw_slug,
                    )
                    if not dry_run:
                        s.status = "abandoned"
                    n_soft_deleted += 1

        # ------------------------------------------------------------------
        # Step 5: Commit or rollback
        # ------------------------------------------------------------------
        if not dry_run:
            try:
                db.commit()
                logger.info("Transaction committed successfully.")
            except Exception as exc:
                db.rollback()
                logger.error("Transaction rolled back due to error: %s", exc)
                raise

        # ------------------------------------------------------------------
        # Step 6: Summary
        # ------------------------------------------------------------------
        logger.info("")
        logger.info("=" * 50)
        logger.info("SUMMARY%s", " (DRY-RUN — no changes written)" if dry_run else "")
        logger.info("=" * 50)
        logger.info("  Orphans found    : %d", len(orphans))
        logger.info("  Updated (slug fix): %d", n_updated)
        logger.info("  Soft-deleted      : %d", n_soft_deleted)
        logger.info("  Skipped (no-op)   : %d", n_skipped)
        if dry_run:
            logger.info("")
            logger.info("  Run with --apply to execute the above changes.")

    finally:
        db.close()


if __name__ == "__main__":
    main()
