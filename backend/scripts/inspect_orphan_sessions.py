#!/usr/bin/env python3
"""inspect_orphan_sessions.py — Issue #1123: read-only orphan session report.

Queries ALL learning_sessions and identifies rows whose story_slug does not
map to a known lesson number (1..57+).  No DB writes are performed.

Usage
-----
    cd backend
    export DATABASE_URL="<staging-connection-string>"
    python scripts/inspect_orphan_sessions.py

Output
------
Prints a summary table of orphan slugs plus per-student sample rows.
Classifies each slug into one of three buckets:
  - TYPO      : looks like a typo of a valid slug (e.g. "esson-1" ~ "lesson-1")
  - INVALID   : pure numeric but no matching lesson (e.g. "45")
  - LEGACY    : old non-numeric format (e.g. "G4-1")

Safety
------
Read-only: never writes or modifies any row.
Run this and share the output with Young before deciding on a cleanup strategy.
"""
from __future__ import annotations

import os
import re
import sys
from collections import Counter, defaultdict

# Allow running from repo root or from backend/
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _is_numeric_slug(s: str) -> bool:
    try:
        int(s)
        return True
    except ValueError:
        return False


def _classify_slug(raw: str, valid_ids: set[int]) -> str:
    """Classify an orphan slug into TYPO / INVALID / LEGACY."""
    # Pure numeric — check if lesson exists
    if _is_numeric_slug(raw):
        num = int(raw)
        return "INVALID" if num not in valid_ids else "VALID"  # shouldn't reach VALID here
    # Looks like a prefix typo of "lesson-N" (e.g. "esson-1", "lsson-1")
    match = re.match(r".*?(\d+)$", raw)
    if match:
        candidate = int(match.group(1))
        if candidate in valid_ids:
            return "TYPO"
    # Non-numeric with letter prefix — likely legacy format (e.g. "G4-1")
    return "LEGACY"


def main() -> None:
    database_url = os.environ.get("DATABASE_URL")
    if not database_url:
        print("ERROR: DATABASE_URL environment variable is required.", file=sys.stderr)
        print("       export DATABASE_URL='postgresql://user:pass@host/dbname'", file=sys.stderr)
        sys.exit(1)

    from sqlalchemy import create_engine
    from sqlalchemy.orm import sessionmaker

    import app.models  # noqa: F401 — registers all ORM classes
    from app.models.session import LearningSession
    from app.services.lesson_loader import get_all_lessons
    from app.utils.slug import normalize_story_slug

    engine = create_engine(database_url)
    SessionLocal = sessionmaker(bind=engine)
    db = SessionLocal()

    # --- Build set of valid canonical lesson numbers ---
    all_lessons = get_all_lessons()
    valid_ids: set[int] = {int(l["lesson_number"]) for l in all_lessons if l.get("lesson_number")}
    print(f"Loaded {len(valid_ids)} valid lessons (ids {min(valid_ids)}..{max(valid_ids)})")

    # --- Fetch all sessions with a non-null story_slug ---
    sessions = (
        db.query(LearningSession)
        .filter(LearningSession.story_slug.isnot(None))
        .all()
    )
    print(f"Total sessions with story_slug: {len(sessions)}\n")

    # --- Identify orphans (after normalization) ---
    orphans: list[LearningSession] = []
    for s in sessions:
        canonical = normalize_story_slug(s.story_slug)
        if not _is_numeric_slug(canonical) or int(canonical) not in valid_ids:
            orphans.append(s)

    if not orphans:
        print("No orphan sessions found.")
        return

    # --- Aggregate ---
    slug_counter: Counter[str] = Counter(s.story_slug for s in orphans)
    slug_to_classification: dict[str, str] = {}
    for slug in slug_counter:
        slug_to_classification[slug] = _classify_slug(slug, valid_ids)

    by_classification: dict[str, list[str]] = defaultdict(list)
    for slug, cls in slug_to_classification.items():
        by_classification[cls].append(slug)

    # --- Print summary ---
    print(f"{'='*60}")
    print(f"ORPHAN SUMMARY: {len(orphans)} rows across {len(slug_counter)} distinct slugs")
    print(f"{'='*60}")

    for cls in ("TYPO", "INVALID", "LEGACY"):
        slugs = by_classification.get(cls, [])
        if not slugs:
            continue
        print(f"\n[{cls}] ({len(slugs)} distinct slug(s))")
        for slug in sorted(slugs):
            count = slug_counter[slug]
            canonical = normalize_story_slug(slug)
            note = ""
            if cls == "TYPO":
                note = f"  → candidate lesson: {canonical}"
            elif cls == "INVALID":
                note = f"  → no lesson #{canonical} exists"
            elif cls == "LEGACY":
                note = f"  → normalize() returned '{canonical}' (unresolved)"
            print(f"  slug='{slug}'  occurrences={count}{note}")

    # --- Sample rows per orphan slug (up to 5) ---
    print(f"\n{'='*60}")
    print("SAMPLE ROWS (up to 5 per slug)")
    print(f"{'='*60}")

    slug_to_sessions: dict[str, list[LearningSession]] = defaultdict(list)
    for s in orphans:
        slug_to_sessions[s.story_slug].append(s)

    for slug in sorted(slug_to_sessions.keys()):
        rows = slug_to_sessions[slug]
        cls = slug_to_classification[slug]
        print(f"\nslug='{slug}' [{cls}] — {len(rows)} row(s)")
        for s in rows[:5]:
            started = s.started_at.strftime("%Y-%m-%d") if s.started_at else "?"
            print(f"  id={s.id}  student_id={s.student_id}  "
                  f"status={s.status}  step={s.current_step}  started={started}")
        if len(rows) > 5:
            print(f"  ... and {len(rows) - 5} more")

    # --- Recommendation summary ---
    print(f"\n{'='*60}")
    print("RECOMMENDED ACTIONS (for Young to decide)")
    print(f"{'='*60}")
    if by_classification.get("TYPO"):
        slugs_str = ", ".join(f"'{s}'" for s in sorted(by_classification["TYPO"]))
        print(f"  TYPO slugs ({slugs_str}):")
        print("    Option A: run normalize_story_slug() via one-off script (no migration needed)")
        print("    Option B: add normalization on-write hook in create_session endpoint")
    if by_classification.get("INVALID"):
        slugs_str = ", ".join(f"'{s}'" for s in sorted(by_classification["INVALID"]))
        print(f"  INVALID slugs ({slugs_str}):")
        print("    Option A: soft-delete (status='abandoned') via one-off script")
        print("    Option B: leave as-is (orphans don't affect active users)")
    if by_classification.get("LEGACY"):
        slugs_str = ", ".join(f"'{s}'" for s in sorted(by_classification["LEGACY"]))
        print(f"  LEGACY slugs ({slugs_str}):")
        print("    Option A: map to canonical number via one-off script if mapping is known")
        print("    Option B: soft-delete if legacy format is truly abandoned")
    print("\nNext step: tell Young the counts above and ask which option to proceed with.")
    print("DO NOT create a migration file until Young says 'yes, create migration'.")

    db.close()


if __name__ == "__main__":
    main()
