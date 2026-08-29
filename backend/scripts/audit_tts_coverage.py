#!/usr/bin/env python3
"""Audit GCS coverage of the sentence manifest for the active TTS provider (#2619).

Two TTS bugs shipped 2026-08-08 with no lock behind them: audio regenerated
live on every "AI 朗讀" click (cache miss) and the first playback fell back
to the browser's machine voice. Both existing locks (frontend's
tts-alignment.eval.ts + useTtsPlayback.test.ts) only check that the frontend
computes the SAME cache key as the backend — neither checks that an object
actually EXISTS at that key in GCS. If the bucket gets wiped again (an
`age:90` lifecycle rule did exactly that in 2026-07, unnoticed for 4 months),
both of those stay green while every real user hits cold-generation and a
possible fallback. This script is the missing check.

`expected_keys()` deliberately reuses batch_azure_tts.py's own
`load_sentences()` (dynamically loaded, same pattern its own tests use)
instead of re-deriving the punctuation-only filter here — the risk of two
independent copies of `_has_speakable_content` drifting apart is exactly the
kind of gap this audit exists to close, not reproduce.

`missing_keys()` is a subset check (expected - existing), not exact
equality: the real bucket can hold MORE objects than the manifest currently
expects (e.g. 3 punctuation-only objects an azure batch run generated before
#2615's skip-filter landed) — those extras must never fail this gate.

Usage:
  set -a; source backend/.env; set +a
  python backend/scripts/audit_tts_coverage.py
  python backend/scripts/audit_tts_coverage.py --provider azure
"""
from __future__ import annotations

import argparse
import importlib.util
import logging
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "backend"))

from app.services.tts import TTS_GCS_BUCKET, _blob_path  # noqa: E402

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s",
                    datefmt="%H:%M:%S")
logger = logging.getLogger("audit-tts-coverage")

# Reuse the runtime's own bucket name (env TTS_GCS_BUCKET, default
# "lingoleap-tts-cache") instead of a second hardcoded literal — code review
# on #2619 flagged the drift risk: harmless today since the default matches,
# but silently wrong the day someone overrides TTS_GCS_BUCKET per-environment
# without updating this file too.
GCS_BUCKET = TTS_GCS_BUCKET


def _load_batch_azure_module():
    """Dynamically load batch_azure_tts.py so expected_keys() can call its
    load_sentences() directly — the single source of truth for "what should
    have been generated", including the punctuation-only skip filter. Not a
    normal package import: it's a standalone script, same reason
    test_batch_azure_tts.py and test_audit_tts_objects.py load it this way."""
    spec = importlib.util.spec_from_file_location(
        "batch_azure_tts_ref", ROOT / "backend" / "scripts" / "batch_azure_tts.py"
    )
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def expected_keys() -> set[str]:
    """Every cache_key that batch_azure_tts.py would queue for generation —
    i.e. every unique, speakable sentence currently in the manifest."""
    batch_mod = _load_batch_azure_module()
    return {item["cache_key"] for item in batch_mod.load_sentences()}


def existing_keys(bucket, provider: str) -> set[str]:
    """Every cache_key that already has a real .mp3 object in GCS for
    `provider`. One list_blobs call, never a per-key exists() loop — see
    batch_azure_tts.py's own comment on why (10+ minutes for this manifest)."""
    prefix = _blob_path("", provider).removesuffix(".mp3")
    found: set[str] = set()
    for blob in bucket.list_blobs(prefix=prefix):
        if not blob.name.endswith(".mp3"):
            continue
        found.add(blob.name[len(prefix):-4])
    return found


def missing_keys(expected: set[str], existing: set[str]) -> set[str]:
    """Subset check, not equality — extra objects beyond what's currently
    expected (stale/legacy generations) are never a failure."""
    return expected - existing


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--provider", default=None,
                     help="defaults to TTS_PROVIDER env (or 'azure')")
    ap.add_argument("--bucket", default=GCS_BUCKET)
    args = ap.parse_args()

    from google.cloud import storage

    provider = args.provider or os.environ.get("TTS_PROVIDER", "azure")
    gcs = storage.Client()
    bucket = gcs.bucket(args.bucket)

    expected = expected_keys()
    existing = existing_keys(bucket, provider)
    missing = missing_keys(expected, existing)

    logger.info("provider=%s expected=%d existing=%d missing=%d",
                provider, len(expected), len(existing), len(missing))

    if missing:
        logger.warning("Missing %d/%d speakable sentence(s) under provider=%s:",
                        len(missing), len(expected), provider)
        for key in sorted(missing)[:20]:
            logger.warning("  %s", key)
        if len(missing) > 20:
            logger.warning("  ... and %d more", len(missing) - 20)
        sys.exit(1)

    logger.info("Coverage 100%% — every speakable sentence has a GCS object under provider=%s.",
                provider)


if __name__ == "__main__":
    main()
