"""Normalize existing TTS audio in GCS to consistent loudness (-16 LUFS).

Gemini 3.1 Flash TTS generates each sentence as an independent API call with no
cross-sentence volume conditioning. Within a batch run, adjacent sentences can
differ by 2-6 dB in mean/peak volume. End users perceive this as "voice changing"
between paragraphs (reported by PM on 2026-04-22 for L01 p0 vs p1).

Fix: download each MP3, run ffmpeg loudnorm (I=-16 LUFS, TP=-1.5 dB, LRA=11),
upload back to the same GCS key. Idempotent: marks each blob with
metadata.loudnorm=v1 after processing, skips blobs already flagged.

Usage:
    python backend/scripts/normalize_tts_loudnorm.py --dry-run
    python backend/scripts/normalize_tts_loudnorm.py --workers 10
    python backend/scripts/normalize_tts_loudnorm.py --prefix gemini31-prompt-only-v2/sentences

Requires:
    gcloud ADC, ffmpeg.
"""

from __future__ import annotations

import argparse
import logging
import subprocess
import sys
import time
from concurrent.futures import ThreadPoolExecutor, as_completed

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s", datefmt="%H:%M:%S")
logger = logging.getLogger(__name__)

GCS_BUCKET = "lingoleap-tts-cache"
DEFAULT_PREFIX = "gemini31-prompt-only-v2/sentences"
LOUDNORM_FILTER = "loudnorm=I=-16:TP=-1.5:LRA=11"
LOUDNORM_VERSION = "v1"


def _loudnorm_mp3(mp3_bytes: bytes) -> bytes:
    """Run ffmpeg loudnorm on MP3 bytes, return normalized MP3 bytes."""
    result = subprocess.run(
        [
            "ffmpeg",
            "-hide_banner",
            "-loglevel", "error",
            "-i", "pipe:0",
            "-af", LOUDNORM_FILTER,
            "-f", "mp3",
            "-q:a", "2",
            "pipe:1",
        ],
        input=mp3_bytes,
        capture_output=True,
        timeout=60,
    )
    if result.returncode != 0:
        raise RuntimeError(f"ffmpeg loudnorm failed: {result.stderr.decode()[:300]}")
    return result.stdout


def _process_blob(bucket, blob_name: str) -> dict:
    try:
        blob = bucket.blob(blob_name)
        blob.reload()
        if blob.metadata and blob.metadata.get("loudnorm") == LOUDNORM_VERSION:
            return {"name": blob_name, "status": "skipped", "reason": "already normalized"}

        original = blob.download_as_bytes()
        if not original:
            return {"name": blob_name, "status": "error", "reason": "empty blob"}

        normalized = _loudnorm_mp3(original)
        if not normalized:
            return {"name": blob_name, "status": "error", "reason": "loudnorm output empty"}

        new_blob = bucket.blob(blob_name)
        new_blob.metadata = {**(blob.metadata or {}), "loudnorm": LOUDNORM_VERSION}
        new_blob.upload_from_string(normalized, content_type="audio/mpeg")

        return {
            "name": blob_name,
            "status": "ok",
            "before": len(original),
            "after": len(normalized),
        }
    except Exception as exc:
        return {"name": blob_name, "status": "error", "reason": str(exc)[:200]}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--prefix", default=DEFAULT_PREFIX, help="GCS prefix to process")
    ap.add_argument("--workers", type=int, default=10)
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--limit", type=int, default=0, help="Only process first N (0=all)")
    args = ap.parse_args()

    from google.cloud import storage

    gcs = storage.Client()
    bucket = gcs.bucket(GCS_BUCKET)

    logger.info("Listing gs://%s/%s ...", GCS_BUCKET, args.prefix)
    blob_names = [b.name for b in bucket.list_blobs(prefix=args.prefix) if b.name.endswith(".mp3")]
    logger.info("Found %d .mp3 blobs", len(blob_names))

    if args.limit:
        blob_names = blob_names[: args.limit]

    if args.dry_run:
        # Check how many are already flagged
        flagged = 0
        for name in blob_names[:100]:
            b = bucket.blob(name)
            b.reload()
            if b.metadata and b.metadata.get("loudnorm") == LOUDNORM_VERSION:
                flagged += 1
        logger.info("Sampled 100: %d already normalized, %d to process", flagged, 100 - flagged)
        logger.info("Filter: %s | Target metadata: loudnorm=%s", LOUDNORM_FILTER, LOUDNORM_VERSION)
        return

    start = time.time()
    ok = err = skipped = 0

    with ThreadPoolExecutor(max_workers=args.workers) as pool:
        futs = {pool.submit(_process_blob, bucket, name): name for name in blob_names}
        for i, fut in enumerate(as_completed(futs), 1):
            res = fut.result()
            if res["status"] == "ok":
                ok += 1
            elif res["status"] == "skipped":
                skipped += 1
            else:
                err += 1
                logger.warning("[%d/%d] ERR %s: %s", i, len(blob_names), res["name"][-40:], res.get("reason"))
            if i % 100 == 0:
                rate = i / (time.time() - start)
                eta = (len(blob_names) - i) / rate / 60 if rate else 0
                logger.info("[%d/%d] ok=%d skipped=%d err=%d %.1f/s ETA %.0fm", i, len(blob_names), ok, skipped, err, rate, eta)

    logger.info("Done: ok=%d skipped=%d err=%d in %.0fs", ok, skipped, err, time.time() - start)


if __name__ == "__main__":
    main()
