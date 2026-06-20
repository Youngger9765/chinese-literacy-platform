#!/usr/bin/env python3
"""Orphan GCS audio reconciliation script (Issue #2266).

⚠️  DORMANT — NOT scheduled.  Run manually when needed.
⚠️  No cron / Cloud Scheduler / GCP Eventarc wiring.  Young's decision: "cron
     先不要 run，放著就好" (2026-06-19).

Finds GCS blobs under reading-audio/ that have no corresponding DB row pointing
to them (i.e. both ReadingAttemptHistory.audio_gcs_path AND
AssignmentSubmission.audio_gcs_path are NULL / don't match).

How to run:
    # Dry-run (default — only lists orphans, deletes nothing):
    python scripts/reconcile_reading_audio_orphans.py

    # Actually delete orphans:
    python scripts/reconcile_reading_audio_orphans.py --delete

    # Limit scan to a prefix (useful for testing):
    python scripts/reconcile_reading_audio_orphans.py --prefix reading-audio/attempts/

Prerequisites:
    - READING_AUDIO_GCS_BUCKET env var must be set.
    - DATABASE_URL env var must be set (Cloud SQL Unix socket or Postgres URL).
    - Run from the project root (so that `backend/` is in sys.path).
    - Service account running this script must have storage.objectViewer +
      storage.objectAdmin on the bucket.
"""

from __future__ import annotations

import argparse
import logging
import os
import sys
from pathlib import Path

# ── Path fix so we can import backend app modules ────────────────────────────
PROJECT_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(PROJECT_ROOT / "backend"))

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s: %(message)s",
)
logger = logging.getLogger("reconcile_reading_audio_orphans")


def _get_db_audio_paths() -> set[str]:
    """Return all audio_gcs_path values recorded in the DB (non-NULL)."""
    from app.database import SessionLocal  # noqa: PLC0415
    from app.models.assignment import AssignmentSubmission  # noqa: PLC0415
    from app.models.session import ReadingAttemptHistory  # noqa: PLC0415

    db = SessionLocal()
    try:
        attempt_paths = {
            p
            for (p,) in db.query(ReadingAttemptHistory.audio_gcs_path)
            .filter(ReadingAttemptHistory.audio_gcs_path.is_not(None))
            .all()
            if p
        }
        submission_paths = {
            p
            for (p,) in db.query(AssignmentSubmission.audio_gcs_path)
            .filter(AssignmentSubmission.audio_gcs_path.is_not(None))
            .all()
            if p
        }
        all_paths = attempt_paths | submission_paths
        logger.info(
            "DB audio paths: %d attempt-bound, %d submission-bound → %d total",
            len(attempt_paths),
            len(submission_paths),
            len(all_paths),
        )
        return all_paths
    finally:
        db.close()


def _get_gcs_blobs(bucket_name: str, prefix: str) -> list[str]:
    """List all blob names under the given prefix in the GCS bucket."""
    try:
        from google.cloud import storage  # noqa: PLC0415
    except ImportError:
        logger.error("google-cloud-storage not installed.  Run: pip install google-cloud-storage")
        sys.exit(1)

    client = storage.Client()
    bucket = client.bucket(bucket_name)
    blobs = list(client.list_blobs(bucket, prefix=prefix))
    names = [b.name for b in blobs]
    logger.info("GCS blobs under '%s': %d found", prefix, len(names))
    return names


def _delete_blob(bucket_name: str, blob_name: str) -> bool:
    """Delete a single GCS blob.  Returns True on success."""
    try:
        from google.cloud import storage  # noqa: PLC0415

        client = storage.Client()
        bucket = client.bucket(bucket_name)
        blob = bucket.blob(blob_name)
        blob.delete()
        logger.info("DELETED: %s", blob_name)
        return True
    except Exception as exc:
        logger.warning("FAILED to delete %s: %s", blob_name, exc)
        return False


def main() -> None:
    parser = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    parser.add_argument(
        "--delete",
        action="store_true",
        default=False,
        help="Actually delete orphan blobs. Default is dry-run (list only).",
    )
    parser.add_argument(
        "--prefix",
        default="reading-audio/",
        help="GCS prefix to scan (default: 'reading-audio/').",
    )
    args = parser.parse_args()

    bucket_name = os.environ.get("READING_AUDIO_GCS_BUCKET")
    if not bucket_name:
        logger.error(
            "READING_AUDIO_GCS_BUCKET env var is not set.  "
            "Example: export READING_AUDIO_GCS_BUCKET=lingoleap-reading-audio"
        )
        sys.exit(1)

    database_url = os.environ.get("DATABASE_URL")
    if not database_url:
        logger.error(
            "DATABASE_URL env var is not set.  "
            "Example: export DATABASE_URL=postgresql://user:pass@localhost/dbname"
        )
        sys.exit(1)

    logger.info("=== Reading Audio Orphan Reconciliation ===")
    logger.info("Bucket : %s", bucket_name)
    logger.info("Prefix : %s", args.prefix)
    logger.info("Mode   : %s", "DELETE" if args.delete else "DRY-RUN")

    # ── Fetch DB paths ───────────────────────────────────────────────────────
    db_paths = _get_db_audio_paths()

    # ── Fetch GCS blobs ──────────────────────────────────────────────────────
    gcs_names = _get_gcs_blobs(bucket_name, args.prefix)

    # ── Compute orphans ──────────────────────────────────────────────────────
    orphans = [name for name in gcs_names if name not in db_paths]
    logger.info(
        "Orphan blobs (GCS but not in DB): %d / %d total",
        len(orphans),
        len(gcs_names),
    )

    if not orphans:
        logger.info("No orphans found. Nothing to do.")
        return

    # ── Report / delete ──────────────────────────────────────────────────────
    deleted = 0
    failed = 0
    for name in orphans:
        if args.delete:
            ok = _delete_blob(bucket_name, name)
            if ok:
                deleted += 1
            else:
                failed += 1
        else:
            logger.info("ORPHAN (dry-run): %s", name)

    if args.delete:
        logger.info(
            "Reconciliation complete: deleted=%d failed=%d orphans=%d",
            deleted,
            failed,
            len(orphans),
        )
    else:
        logger.info(
            "Dry-run complete: %d orphans found. Re-run with --delete to remove them.",
            len(orphans),
        )


if __name__ == "__main__":
    main()
