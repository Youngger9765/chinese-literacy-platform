#!/usr/bin/env python3
"""Audit already-uploaded TTS cache objects in GCS for empty/corrupt audio (#2614).

Azure's TTS REST endpoint can answer HTTP 200 with an empty or truncated
body. Before batch_azure_tts.py validated its own output, at least 2
confirmed 0-byte objects were uploaded and now permanently win the runtime
cache — a student who hits that sentence gets silence forever, with no
error anywhere. Fixing the generator (see audio_validation.py) stops new
bad objects from landing, but it does nothing about ones already sitting in
the bucket. This script re-checks those.

Reads size + a short byte-range peek per object — never downloads a full
mp3 — so scanning thousands of objects is cheap. `--dry-run` behaviour
(list-only) is the default; nothing is ever deleted unless you pass
`--delete`, and even then only the objects this scan itself flagged (never
a blanket prefix delete).

Usage:
  set -a; source backend/.env; set +a

  # list-only, safe to run anytime
  python backend/scripts/audit_tts_objects.py --prefix azure/sentences

  # actually remove the confirmed-bad objects (forces regeneration on the
  # next batch_azure_tts.py run, since a missing cache_key gets regenerated)
  python backend/scripts/audit_tts_objects.py --prefix azure/sentences --delete
"""
from __future__ import annotations

import argparse
import logging
import sys
from pathlib import Path

from google.cloud import storage

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "backend"))

from app.services.tts.audio_validation import (  # noqa: E402
    MP3_PEEK_BYTES,
    MIN_MP3_BYTES,
    validate_mp3_metadata,
)

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s",
                    datefmt="%H:%M:%S")
logger = logging.getLogger("audit-tts")

GCS_BUCKET = "lingoleap-tts-cache"


def scan(bucket, prefix: str, min_bytes: int = MIN_MP3_BYTES) -> list[tuple[str, str, int | None]]:
    """Return (blob_name, reason, size) for every .mp3 object under `prefix`
    that fails validation. Read-only — never mutates the bucket.

    Skips the ranged GET entirely when size alone already disqualifies an
    object (0 bytes / too small): fetching bytes from an empty or truncated
    object would just cost a network round trip for a foregone conclusion.
    """
    bad: list[tuple[str, str, int | None]] = []
    for blob in bucket.list_blobs(prefix=prefix):
        if not blob.name.endswith(".mp3"):
            continue
        size = blob.size
        head = b""
        if size and size >= min_bytes:
            try:
                head = blob.download_as_bytes(start=0, end=MP3_PEEK_BYTES - 1)
            except Exception as exc:  # noqa: BLE001 — an unreadable object is bad, but must not abort the scan
                bad.append((blob.name, f"unreadable: {exc}", size))
                continue
        reason = validate_mp3_metadata(size, head, min_bytes=min_bytes)
        if reason:
            bad.append((blob.name, reason, size))
    return bad


def apply_delete(bucket, bad: list[tuple[str, str, int | None]]) -> int:
    """Delete every object `scan()` already flagged. Never does its own
    scanning or prefix matching — the caller decides what "bad" means, this
    function only removes exactly those names.

    Tolerates an object that is already gone (e.g. a second audit run, or a
    concurrent partial delete) — that is not a new deletion and not an error.
    """
    from google.api_core.exceptions import NotFound

    deleted = 0
    for name, _reason, _size in bad:
        try:
            bucket.blob(name).delete()
            deleted += 1
        except NotFound:
            logger.info("  %s already deleted (skipping)", name)
    return deleted


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--bucket", default=GCS_BUCKET)
    ap.add_argument("--prefix", required=True,
                    help="e.g. azure/sentences or gemini31-prompt-only-v2/sentences")
    ap.add_argument("--min-bytes", type=int, default=MIN_MP3_BYTES)
    ap.add_argument("--delete", action="store_true",
                    help="actually delete the confirmed-bad objects (default: report only)")
    args = ap.parse_args()

    gcs = storage.Client()
    bucket = gcs.bucket(args.bucket)

    logger.info("Scanning gs://%s/%s/ ...", args.bucket, args.prefix)
    bad = scan(bucket, args.prefix, min_bytes=args.min_bytes)

    if not bad:
        logger.info("Clean — no invalid objects found under %s/", args.prefix)
        return

    logger.warning("Found %d invalid object(s) under %s/:", len(bad), args.prefix)
    for name, reason, size in bad:
        logger.warning("  %s  size=%s  %s", name, size, reason)

    sizes = [s for _, _, s in bad if s is not None]
    if sizes:
        logger.info("Size distribution of bad objects: min=%d max=%d", min(sizes), max(sizes))

    if not args.delete:
        logger.info("Dry-run (default) — pass --delete to remove these %d object(s).", len(bad))
        return

    deleted = apply_delete(bucket, bad)
    logger.info("Deleted %d object(s). They will regenerate on the next batch run.", deleted)


if __name__ == "__main__":
    main()
