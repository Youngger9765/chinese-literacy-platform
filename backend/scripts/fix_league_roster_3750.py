#!/usr/bin/env python3
"""fix_league_roster_3750.py — Issue #3750 one-off staging data fix.

NOT a migration, NOT run in CI, NOT imported by the app. This is a one-shot
operational script for a single incident: the locked `league_team_roster_members`
snapshot for season_id=2 / team_id=3 (classroom_id=1, "三年甲班") still showed
roster_size=1698 after #3750's classroom cleanup, because that cleanup (via
`DELETE /api/admin/seed/demo-students`) can only match students who are
CURRENTLY enrolled in the classroom — it cannot reach roster rows for students
already removed from ClassroomStudent. 1,680 of the roster's 1,698 rows are
exactly that: orphaned references to students no longer enrolled.

Team-lead decision (2026-10-24, chat log, Young's own instruction "把班級數量
調整正常" is the root authorization): fix the roster directly rather than the
slower re-enroll-then-cleanup round trip through the API.

What this does, in order, inside ONE transaction:
  1. Hard-pins to classroom_id=1 / season_id=2 / team_id=3 and REFUSES to run
     if the DB's actual rows at those ids don't match what was observed via
     the staging API before this script was written (classroom name "三年甲班",
     season name contains "跨班邀請賽", team's classroom_id == 1, roster size in
     a sane range) — this is the "confirm target is staging, not prod" check:
     prod has no such polluted roster at all, so these assertions fail loudly
     on the wrong database.
  2. Backs up the FULL current roster for team_id=3 to
     qa-shots/roster-backup-<timestamp>.json BEFORE any write.
  3. DELETE: only rows where team_id=3 AND student_id is in the orphaned set
     (roster members not currently enrolled in classroom_id=1) AND the
     corresponding user's email ends with @testdata.lingoleap.dev. Any
     orphaned id whose current email does NOT end with that suffix is
     skipped and reported, never deleted — a user id should never be reused
     (autoincrement PK), but this is checked, not assumed.
  4. INSERT: for every student currently enrolled in classroom_id=1 but not
     already a roster member of (season_id=2, team_id=3), add one row —
     brings roster_size up to the live classroom headcount.
  5. Prints before/after counts, then commits. Any exception rolls back the
     whole transaction (nothing partially applied).

Usage:
    cd backend
    # Fetch the password fresh — do not paste it into a file or print it:
    #   gcloud run services describe lingoleap-backend-staging \
    #     --region asia-east1 --project lingoleap-dev \
    #     --format="value(spec.template.spec.containers[0].env)" | grep DATABASE_URL
    # Then run cloud-sql-proxy --port 5433 lingoleap-dev:asia-east1:lingoleap-staging-db &
    export DATABASE_URL="postgresql://lingoleap:<password>@127.0.0.1:5433/lingoleap"
    python scripts/fix_league_roster_3750.py --dry-run   # preview only
    python scripts/fix_league_roster_3750.py --execute   # actually writes
"""
from __future__ import annotations

import argparse
import json
import os
import sys
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

CLASSROOM_ID = 1
SEASON_ID = 2
TEAM_ID = 3
TESTDATA_SUFFIX = "@testdata.lingoleap.dev"
REPO_ROOT = Path(__file__).resolve().parents[2]
BACKUP_DIR = REPO_ROOT / "qa-shots"


def main(execute: bool) -> None:
    database_url = os.environ.get("DATABASE_URL")
    if not database_url:
        print("ERROR: DATABASE_URL environment variable is required.", file=sys.stderr)
        sys.exit(1)

    from sqlalchemy import create_engine, text
    from sqlalchemy.orm import sessionmaker

    import app.models  # noqa: F401 — register all tables
    from app.models.league import LeagueSeason, LeagueTeam, LeagueTeamRosterMember
    from app.models.school import Classroom, ClassroomStudent
    from app.models.user import User

    engine = create_engine(database_url)
    SessionLocal = sessionmaker(bind=engine)
    db = SessionLocal()

    mode = "EXECUTE" if execute else "DRY RUN"
    print(f"=== fix_league_roster_3750 [{mode}] ===\n")

    # -------------------------------------------------------------------
    # Step 1: confirm this is the right database AND the right row shape
    # (prod has no such season/team/pollution — these assertions fail
    # loudly on the wrong target instead of silently doing nothing or,
    # worse, matching nothing and reporting false success).
    # -------------------------------------------------------------------
    db_name = db.execute(text("SELECT current_database()")).scalar()
    classroom = db.query(Classroom).filter(Classroom.id == CLASSROOM_ID).first()
    season = db.query(LeagueSeason).filter(LeagueSeason.id == SEASON_ID).first()
    team = db.query(LeagueTeam).filter(LeagueTeam.id == TEAM_ID).first()

    assert classroom is not None, f"classroom_id={CLASSROOM_ID} not found"
    assert classroom.name == "三年甲班", f"classroom {CLASSROOM_ID} name mismatch: {classroom.name!r}"
    assert season is not None, f"season_id={SEASON_ID} not found"
    assert "跨班邀請賽" in season.name, f"season {SEASON_ID} name mismatch: {season.name!r}"
    assert team is not None, f"team_id={TEAM_ID} not found"
    assert team.classroom_id == CLASSROOM_ID, (
        f"team {TEAM_ID} belongs to classroom {team.classroom_id}, not {CLASSROOM_ID}"
    )

    roster_before = (
        db.query(LeagueTeamRosterMember)
        .filter(LeagueTeamRosterMember.team_id == TEAM_ID)
        .all()
    )
    assert 1500 <= len(roster_before) <= 1800, (
        f"roster_size for team {TEAM_ID} is {len(roster_before)} — expected ~1698 "
        "(#3750 pollution shape). Refusing to run: this does not look like the "
        "staging DB this script was written against."
    )

    print(f"database: {db_name}")
    print(f"classroom {CLASSROOM_ID}: {classroom.name!r} (confirmed)")
    print(f"season {SEASON_ID}: {season.name!r} (confirmed)")
    print(f"team {TEAM_ID}: classroom_id={team.classroom_id} (confirmed)")
    print(f"roster_before: {len(roster_before)} rows (sane-range check passed)\n")

    # -------------------------------------------------------------------
    # Step 2: backup BEFORE any write
    # -------------------------------------------------------------------
    BACKUP_DIR.mkdir(parents=True, exist_ok=True)
    ts = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    backup_path = BACKUP_DIR / f"roster-backup-{ts}.json"
    backup_rows = [
        {
            "id": r.id,
            "team_id": r.team_id,
            "season_id": r.season_id,
            "student_id": r.student_id,
            "locked_at": r.locked_at.isoformat() if r.locked_at else None,
        }
        for r in roster_before
    ]
    backup_path.write_text(json.dumps(backup_rows, ensure_ascii=False, indent=2))
    print(f"backed up {len(backup_rows)} rows -> {backup_path}\n")

    # -------------------------------------------------------------------
    # Step 3: compute the orphaned set (roster members not currently
    # enrolled in classroom_id=1), then narrow it to @testdata.lingoleap.dev
    # only — the extra safety filter.
    # -------------------------------------------------------------------
    current_classroom_student_ids = {
        row[0]
        for row in db.query(ClassroomStudent.student_id)
        .filter(ClassroomStudent.classroom_id == CLASSROOM_ID)
        .all()
    }
    roster_student_ids = {r.student_id for r in roster_before}
    orphaned_ids = roster_student_ids - current_classroom_student_ids

    orphaned_users = {
        u.id: u.email
        for u in db.query(User).filter(User.id.in_(orphaned_ids)).all()
    }
    to_delete_ids = {
        sid for sid in orphaned_ids
        if orphaned_users.get(sid, "").endswith(TESTDATA_SUFFIX)
    }
    skipped_non_testdata = sorted(orphaned_ids - to_delete_ids)

    print(f"current classroom {CLASSROOM_ID} enrollment: {len(current_classroom_student_ids)} students")
    print(f"roster members no longer enrolled (orphaned): {len(orphaned_ids)}")
    print(f"  of which @testdata.lingoleap.dev (will DELETE): {len(to_delete_ids)}")
    if skipped_non_testdata:
        print(
            f"  ⚠️  SKIPPED (orphaned but NOT @testdata.lingoleap.dev — left alone): "
            f"{skipped_non_testdata} -> {[orphaned_users.get(i) for i in skipped_non_testdata]}"
        )
    else:
        print("  no non-testdata orphaned rows found (expected)")

    # -------------------------------------------------------------------
    # Step 4: compute the insert set (current classroom students not yet
    # on the roster).
    # -------------------------------------------------------------------
    already_on_roster_after_delete = roster_student_ids - to_delete_ids
    to_insert_ids = sorted(current_classroom_student_ids - already_on_roster_after_delete)

    print(f"\nclassroom students NOT yet on the roster (will INSERT): {len(to_insert_ids)}")
    print(
        f"\nexpected roster_size after fix: "
        f"{len(roster_student_ids) - len(to_delete_ids) + len(to_insert_ids)} "
        f"(should equal current classroom enrollment: {len(current_classroom_student_ids)})\n"
    )

    if not execute:
        print("DRY RUN — no changes made. Re-run with --execute to apply.")
        db.close()
        return

    # -------------------------------------------------------------------
    # Step 5: write, inside one transaction.
    # -------------------------------------------------------------------
    try:
        deleted = (
            db.query(LeagueTeamRosterMember)
            .filter(
                LeagueTeamRosterMember.team_id == TEAM_ID,
                LeagueTeamRosterMember.student_id.in_(to_delete_ids),
            )
            .delete(synchronize_session=False)
        )
        for sid in to_insert_ids:
            db.add(
                LeagueTeamRosterMember(
                    team_id=TEAM_ID, season_id=SEASON_ID, student_id=sid
                )
            )
        db.flush()

        roster_after_count = (
            db.query(LeagueTeamRosterMember)
            .filter(LeagueTeamRosterMember.team_id == TEAM_ID)
            .count()
        )
        print(f"deleted: {deleted} (expected {len(to_delete_ids)})")
        print(f"inserted: {len(to_insert_ids)}")
        print(f"roster_size after (pre-commit, same transaction): {roster_after_count}")

        assert deleted == len(to_delete_ids), "deleted count mismatch — aborting"
        assert roster_after_count == len(current_classroom_student_ids), (
            f"post-fix roster_size {roster_after_count} != classroom enrollment "
            f"{len(current_classroom_student_ids)} — aborting"
        )

        db.commit()
        print("\nCOMMITTED.")
    except Exception:
        db.rollback()
        print("\nROLLED BACK due to exception:", file=sys.stderr)
        raise
    finally:
        db.close()


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument("--dry-run", action="store_true", help="preview only, no writes")
    group.add_argument("--execute", action="store_true", help="actually write")
    args = parser.parse_args()
    main(execute=args.execute)
