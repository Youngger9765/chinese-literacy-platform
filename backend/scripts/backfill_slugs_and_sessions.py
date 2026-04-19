#!/usr/bin/env python3
"""backfill_slugs_and_sessions.py — Issue #1012: data backfill script.

Normalizes story_slug values in learning_sessions and deduplicates
in_progress sessions so that each student+story pair has at most one
active session.

Steps
-----
1. Normalize every non-null story_slug using normalize_story_slug().
2. For each student, find sets of in_progress sessions that map to the
   same canonical slug and keep only the most-recently-started one
   (the "winner"); mark the rest as "abandoned".
3. Re-build the StudentStreak for every affected student so that
   gamification streak data is consistent with the cleaned sessions.

Usage
-----
    # Dry run (no DB writes):
    cd backend
    export DATABASE_URL="<connection-string-from-cloud-run-env>"
    python scripts/backfill_slugs_and_sessions.py --dry-run

    # Live run:
    python scripts/backfill_slugs_and_sessions.py

Safety
------
- Idempotent: re-running produces the same result.
- Never deletes rows — abandoned sessions are preserved with status="abandoned".
- Prints a summary of every change made (or would be made in --dry-run).
"""
from __future__ import annotations

import argparse
import os
import sys
from collections import defaultdict

# Allow running from repo root or from backend/
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))


def main(dry_run: bool = False) -> None:
    database_url = os.environ.get("DATABASE_URL")
    if not database_url:
        print("ERROR: DATABASE_URL environment variable is required.", file=sys.stderr)
        sys.exit(1)

    from sqlalchemy import create_engine
    from sqlalchemy.orm import sessionmaker

    # Import models so SQLAlchemy knows about all tables
    import app.models  # noqa: F401
    from app.models.session import LearningSession
    from app.utils.slug import normalize_story_slug
    from app.services.gamification_service import _get_or_create_streak, update_streak

    engine = create_engine(database_url)
    SessionLocal = sessionmaker(bind=engine)
    db = SessionLocal()

    mode = "DRY RUN" if dry_run else "LIVE"
    print(f"=== Backfill: slug normalization + session dedup [{mode}] ===\n")

    # -----------------------------------------------------------------------
    # Step 1: Normalize slug values
    # -----------------------------------------------------------------------
    all_sessions: list[LearningSession] = db.query(LearningSession).all()
    slug_updates = 0
    for s in all_sessions:
        if s.story_slug is None:
            continue
        canonical = normalize_story_slug(s.story_slug)
        if canonical != s.story_slug:
            print(f"  session {s.id} (student {s.student_id}): "
                  f"slug '{s.story_slug}' -> '{canonical}'")
            if not dry_run:
                s.story_slug = canonical
            slug_updates += 1

    if not dry_run and slug_updates:
        db.commit()
    print(f"\nSlug updates: {slug_updates}\n")

    # -----------------------------------------------------------------------
    # Step 2: Deduplicate in_progress sessions
    # -----------------------------------------------------------------------
    in_progress: list[LearningSession] = (
        db.query(LearningSession)
        .filter(LearningSession.status == "in_progress", LearningSession.story_slug.is_not(None))
        .order_by(LearningSession.started_at.desc())
        .all()
    )

    # Group by (student_id, canonical_slug)
    groups: dict[tuple[int, str], list[LearningSession]] = defaultdict(list)
    for s in in_progress:
        key = (s.student_id, normalize_story_slug(s.story_slug))  # type: ignore[arg-type]
        groups[key].append(s)

    abandoned_count = 0
    for (student_id, slug), sessions in groups.items():
        if len(sessions) <= 1:
            continue
        # sessions is already sorted desc by started_at (winner = first)
        winner = sessions[0]
        duplicates = sessions[1:]
        print(f"  student {student_id}, story '{slug}': "
              f"keeping session {winner.id}, "
              f"abandoning {[s.id for s in duplicates]}")
        if not dry_run:
            for dup in duplicates:
                dup.status = "abandoned"
        abandoned_count += len(duplicates)

    if not dry_run and abandoned_count:
        db.commit()
    print(f"\nAbandoned duplicate sessions: {abandoned_count}\n")

    # -----------------------------------------------------------------------
    # Step 3: Rebuild StudentStreak for every student that had changes
    # -----------------------------------------------------------------------
    affected_students: set[int] = set()
    for s in all_sessions:
        if s.story_slug is not None:
            affected_students.add(s.student_id)
    # Also include students that had dedup changes
    for (student_id, _) in groups:
        affected_students.add(student_id)

    if not dry_run and affected_students:
        print(f"Rebuilding StudentStreak for {len(affected_students)} students...")
        for student_id in affected_students:
            # Reset the streak record and replay from completed sessions
            streak = _get_or_create_streak(db, student_id)
            streak.current_streak = 0
            streak.longest_streak = 0
            streak.last_activity_date = None

        db.commit()

        # Replay completed sessions ordered by completion date
        from app.models.session import LearningSession as LS
        for student_id in sorted(affected_students):
            completed_sessions = (
                db.query(LS)
                .filter(
                    LS.student_id == student_id,
                    LS.status == "completed",
                    LS.completed_at.is_not(None),
                )
                .order_by(LS.completed_at.asc())
                .all()
            )
            seen_dates: set[str] = set()
            for cs in completed_sessions:
                day_str = cs.completed_at.strftime("%Y-%m-%d")  # type: ignore[union-attr]
                if day_str in seen_dates:
                    continue  # one update per day is sufficient
                seen_dates.add(day_str)
                activity_date_obj = cs.completed_at.date()  # type: ignore[union-attr]
                update_streak(db, student_id, activity_date=activity_date_obj)
            db.commit()
        print(f"StudentStreak rebuild complete for {len(affected_students)} students.\n")
    elif dry_run:
        print(f"[DRY RUN] Would rebuild StudentStreak for {len(affected_students)} students.\n")

    db.close()
    print("=== Backfill complete ===")
    print(f"  Slug updates:              {slug_updates}")
    print(f"  Abandoned duplicate sessions: {abandoned_count}")
    if not dry_run:
        print(f"  StudentStreak rebuilt for: {len(affected_students)} students")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Backfill slug normalization + session dedup")
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Print changes without writing to the database",
    )
    args = parser.parse_args()
    main(dry_run=args.dry_run)
