#!/usr/bin/env python3
"""Pre-generate Azure zh-TW TTS audio for every sentence in the manifest.

Mirrors batch_gemini_tts_v2.py but for the Azure path:
  - voice zh-TW-HsiaoChenNeural (native Taiwan accent, no prompt steering needed)
  - pronunciation fixes via <sub alias> (Azure rejects <phoneme> outright, see #2612)
  - writes to gs://lingoleap-tts-cache/azure/sentences/{sha256}.mp3
    (a different prefix from gemini31-prompt-only-v2/, so the two voice sets
     never mix and either can be rolled back independently)

Cache key is sha256 of the RAW sentence text, matching
backend/app/services/tts/normalization.py:_cache_key — the same key the runtime
computes, so a hit here is a hit in production.

Audio validation (rejecting Azure's HTTP-200-but-empty-body failure mode
before it ever reaches the bucket — see #2614) lives in the shared
app/services/tts/audio_validation.py module, not inline here, so it can be
unit-tested and so backend/scripts/audit_tts_objects.py can re-check
objects already uploaded using the exact same rules.

Usage:
  set -a; source backend/.env; set +a
  python backend/scripts/batch_azure_tts.py --dry-run
  python backend/scripts/batch_azure_tts.py --workers 6
"""
from __future__ import annotations

import argparse
import hashlib
import json
import logging
import os
import sys
import time
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone
from pathlib import Path

from google.api_core.exceptions import PreconditionFailed

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "backend"))

from app.services.tts.audio_validation import validate_mp3_bytes  # noqa: E402
from app.services.tts.normalization import (  # noqa: E402
    _apply_phoneme_corrections,
    _cache_key,
    _clean_for_tts,
)

JSONL = ROOT / "backend" / "data" / "sentences.v2.jsonl"
PROVENANCE = ROOT / "backend" / "data" / "tts-provenance.jsonl"
GCS_BUCKET = "lingoleap-tts-cache"
GCS_PREFIX = "azure/sentences"
VOICE = os.environ.get("AZURE_TTS_VOICE", "zh-TW-HsiaoChenNeural")
RATE = "1.08"

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s",
                    datefmt="%H:%M:%S")
logger = logging.getLogger("batch-azure")


def _escape(text: str) -> str:
    return (text.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
                .replace('"', "&quot;").replace("'", "&apos;"))


def _ssml(text: str) -> str:
    body = _apply_phoneme_corrections(_escape(text))
    return ('<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="zh-TW">'
            f'<voice name="{VOICE}"><prosody rate="{RATE}">{body}</prosody>'
            "</voice></speak>")


def _synthesize(text: str, key: str, region: str, tries: int = 4) -> bytes:
    """POST to Azure with backoff. Raises on final failure."""
    url = f"https://{region}.tts.speech.microsoft.com/cognitiveservices/v1"
    payload = _ssml(text).encode("utf-8")
    last: Exception | None = None
    for attempt in range(tries):
        try:
            req = urllib.request.Request(url, data=payload, headers={
                "Ocp-Apim-Subscription-Key": key,
                "Content-Type": "application/ssml+xml",
                "X-Microsoft-OutputFormat": "audio-48khz-192kbitrate-mono-mp3",
            })
            with urllib.request.urlopen(req, timeout=60) as resp:
                return resp.read()
        except urllib.error.HTTPError as exc:
            # 400 is a content problem — retrying will not help, fail fast so it
            # shows up in the failure list instead of burning 4 attempts.
            if exc.code == 400:
                raise
            last = exc
        except Exception as exc:  # noqa: BLE001 — network layer, retry
            last = exc
        time.sleep(1.5 * (attempt + 1))
    raise last  # type: ignore[misc]


def _upload_if_absent(bucket, blob_path: str, audio: bytes) -> bool:
    """Upload `audio` to `blob_path` only if no object exists there yet.

    Guards against a rare race (#2614 review, P2): this script dedupes
    cache_keys within a single run, so two threads in the same run never
    target the same blob_path. But two *overlapping runs* (e.g. someone
    re-invoking the script while an earlier one is still generating) could
    both pass the "not yet cached" pre-check and then race to write the same
    key. Both writes would be a valid mp3 of the same sentence, so this was
    never a corruption risk — but skipping the loser avoids an extra
    redundant upload. `if_generation_match=0` means "create only if this
    object doesn't exist yet"; GCS answers a losing writer with 412
    Precondition Failed instead of silently overwriting.

    Returns True if this call performed the upload, False if the object
    already existed (someone else won the race — not an error).
    """
    try:
        bucket.blob(blob_path).upload_from_string(
            audio, content_type="audio/mpeg", if_generation_match=0)
        return True
    except PreconditionFailed:
        return False


def load_sentences() -> list[dict]:
    items: list[dict] = []
    with JSONL.open(encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            rec = json.loads(line)
            raw = rec["text"]
            cleaned = _clean_for_tts(raw)
            if not cleaned:
                continue
            items.append({
                "raw_text": raw,
                "tts_input": cleaned,
                "cache_key": _cache_key(raw),
                "lesson_id": rec["lesson_id"],
                "paragraph_idx": rec["paragraph_idx"],
                "sentence_idx": rec["sentence_idx"],
            })
    return items


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--workers", type=int, default=6,
                    help="concurrent requests (Azure rate-limits; 6 is conservative)")
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--limit", type=int, default=0)
    args = ap.parse_args()

    az_key = os.environ.get("AZURE_SPEECH_KEY")
    az_region = os.environ.get("AZURE_SPEECH_REGION")
    if not az_key or not az_region:
        logger.error("AZURE_SPEECH_KEY / AZURE_SPEECH_REGION not set — "
                     "run: set -a; source backend/.env; set +a")
        sys.exit(1)

    items = load_sentences()
    logger.info("Loaded %d sentences from %s", len(items), JSONL.name)

    seen: dict[str, dict] = {}
    for it in items:
        seen.setdefault(it["cache_key"], it)
    unique = list(seen.values())
    if args.limit:
        unique = unique[: args.limit]
    logger.info("Unique texts: %d  |  voice: %s", len(unique), VOICE)

    from google.cloud import storage
    gcs = storage.Client()
    bucket = gcs.bucket(GCS_BUCKET)

    # One list_blobs beats N exists() calls by orders of magnitude — the Gemini
    # script's per-key exists() loop takes 10+ minutes for this manifest.
    logger.info("Listing existing objects under %s/ ...", GCS_PREFIX)
    have = {
        b.name[len(GCS_PREFIX) + 1: -4]
        for b in gcs.list_blobs(GCS_BUCKET, prefix=f"{GCS_PREFIX}/")
        if b.name.endswith(".mp3")
    }
    to_gen = [it for it in unique if it["cache_key"] not in have]
    logger.info("Cached: %d  |  To generate: %d", len(unique) - len(to_gen), len(to_gen))

    if args.dry_run:
        return
    if not to_gen:
        logger.info("All cached — nothing to do.")
        return

    run_id = f"{datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ')}-azure"
    start = time.time()
    ok = err = 0
    failures: list[tuple[str, str]] = []

    def work(it: dict) -> tuple[dict, bytes | None, str | None]:
        try:
            audio = _synthesize(it["tts_input"], az_key, az_region)
            # Azure can answer HTTP 200 with an empty or truncated body.
            # Uploading that produces a silent mp3 that then *permanently*
            # wins the cache — the runtime sees a hit and never regenerates,
            # so the student just gets silence forever. An observed run
            # produced 2 zero-byte objects with err=0, so this is not
            # theoretical. Validate before the object ever reaches the
            # bucket (shared with audit_tts_objects.py, see #2614).
            bad = validate_mp3_bytes(audio)
            if bad:
                return it, None, f"InvalidAudio: {bad}"
            _upload_if_absent(bucket, f"{GCS_PREFIX}/{it['cache_key']}.mp3", audio)
            return it, audio, None
        except Exception as exc:  # noqa: BLE001
            return it, None, f"{type(exc).__name__}: {exc}"

    with PROVENANCE.open("a", encoding="utf-8") as prov, \
            ThreadPoolExecutor(max_workers=args.workers) as pool:
        futs = {pool.submit(work, it): it for it in to_gen}
        for i, fut in enumerate(as_completed(futs), 1):
            it, audio, error = fut.result()
            if error:
                err += 1
                failures.append((it["cache_key"], error))
            else:
                ok += 1
                prov.write(json.dumps({
                    "generated_at": datetime.now(timezone.utc).isoformat(),
                    "raw_text": it["raw_text"],
                    "tts_input": it["tts_input"],
                    "cache_key": it["cache_key"],
                    "gcs_uri": f"gs://{GCS_BUCKET}/{GCS_PREFIX}/{it['cache_key']}.mp3",
                    "audio_bytes": len(audio or b""),
                    "provider": "azure",
                    "voice": VOICE,
                    "language_code": "zh-TW",
                    "lesson_id": it["lesson_id"],
                    "paragraph_idx": it["paragraph_idx"],
                    "sentence_idx": it["sentence_idx"],
                    "batch_run_id": run_id,
                }, ensure_ascii=False) + "\n")
                prov.flush()
            if i % 50 == 0 or i == len(to_gen):
                rate = i / max(time.time() - start, 1)
                eta = (len(to_gen) - i) / max(rate, 0.01) / 60
                logger.info("[%d/%d] ok=%d err=%d %.1f/s ETA %.0fm",
                            i, len(to_gen), ok, err, rate, eta)

    logger.info("Done in %.1fm — ok=%d err=%d", (time.time() - start) / 60, ok, err)
    if failures:
        logger.warning("First 10 failures:")
        for k, e in failures[:10]:
            logger.warning("  %s  %s", k[:12], e[:100])


if __name__ == "__main__":
    main()
