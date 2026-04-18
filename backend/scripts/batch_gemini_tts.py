"""Batch pre-generate Gemini 3.1 Flash TTS for all lessons.

Usage:
    python backend/scripts/batch_gemini_tts.py [--workers 10] [--dry-run]

Reads all 57 lesson YAMLs, splits into sentences, checks GCS for existing cache,
and generates missing audio via Gemini 3.1 Flash TTS. Stores in GCS under
gemini31/sentences/{hash}.mp3.

Requires:
    - gcloud ADC configured (gcloud auth application-default login)
    - google-genai SDK installed
    - ffmpeg installed locally
"""

from __future__ import annotations

import argparse
import hashlib
import logging
import subprocess
import sys
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

# Add backend to path
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.services.lesson_loader import get_all_lessons
from app.services.tts_service import _clean_for_tts, _split_sentences

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(message)s",
    datefmt="%H:%M:%S",
)
logger = logging.getLogger(__name__)

# Config
GCS_BUCKET = "lingoleap-tts-cache"
GCS_PREFIX = "gemini31/sentences"
MODEL = "gemini-3.1-flash-tts-preview"
VOICE = "Aoede"
GCP_PROJECT = "lingoleap-dev"
LOCATION = "us-central1"


def _cache_key(text: str) -> str:
    return hashlib.sha256(text.strip().encode("utf-8")).hexdigest()


def _check_gcs_exists(bucket, key: str) -> bool:
    blob = bucket.blob(f"{GCS_PREFIX}/{key}.mp3")
    return blob.exists()


def _pcm_to_mp3(pcm_data: bytes) -> bytes:
    result = subprocess.run(
        ["ffmpeg", "-f", "s16le", "-ar", "24000", "-ac", "1",
         "-i", "pipe:0", "-f", "mp3", "-q:a", "2", "pipe:1"],
        input=pcm_data, capture_output=True, timeout=30,
    )
    if result.returncode != 0:
        raise RuntimeError(f"ffmpeg failed: {result.stderr.decode()}")
    return result.stdout


def _synthesize_and_upload(client, bucket, text: str, key: str) -> dict:
    """Synthesize one sentence and upload to GCS. Returns status dict."""
    import google.genai.types as genai_types

    try:
        response = client.models.generate_content(
            model=MODEL,
            contents=text,
            config=genai_types.GenerateContentConfig(
                response_modalities=["AUDIO"],
                speech_config=genai_types.SpeechConfig(
                    voice_config=genai_types.VoiceConfig(
                        prebuilt_voice_config=genai_types.PrebuiltVoiceConfig(
                            voice_name=VOICE,
                        ),
                    ),
                ),
            ),
        )
        pcm_data = response.candidates[0].content.parts[0].inline_data.data
        if not pcm_data:
            return {"key": key, "status": "error", "error": "empty PCM"}

        mp3_data = _pcm_to_mp3(pcm_data)

        blob = bucket.blob(f"{GCS_PREFIX}/{key}.mp3")
        blob.upload_from_string(mp3_data, content_type="audio/mpeg")

        return {"key": key, "status": "ok", "bytes": len(mp3_data)}

    except Exception as exc:
        return {"key": key, "status": "error", "error": str(exc)[:100]}


def main():
    parser = argparse.ArgumentParser(description="Batch Gemini 3.1 TTS generation")
    parser.add_argument("--workers", type=int, default=10, help="Parallel workers")
    parser.add_argument("--dry-run", action="store_true", help="Count only, don't generate")
    args = parser.parse_args()

    # Collect all sentences
    lessons = get_all_lessons()
    sentences: list[tuple[str, str]] = []  # (text, hash)

    for lesson in lessons:
        for p in lesson.get("paragraphs", []):
            cleaned = _clean_for_tts(str(p))
            if not cleaned:
                continue
            for sent in _split_sentences(cleaned):
                sent = sent.strip()
                if sent:
                    sentences.append((sent, _cache_key(sent)))

    logger.info("Total: %d sentences across %d lessons", len(sentences), len(lessons))

    if args.dry_run:
        logger.info("Dry run — exiting")
        return

    # Init GCS
    from google.cloud import storage
    gcs_client = storage.Client()
    bucket = gcs_client.bucket(GCS_BUCKET)

    # Check which already exist
    logger.info("Checking GCS cache for existing files...")
    to_generate = []
    already_cached = 0
    for text, key in sentences:
        if _check_gcs_exists(bucket, key):
            already_cached += 1
        else:
            to_generate.append((text, key))

    logger.info("Already cached: %d, Need to generate: %d", already_cached, len(to_generate))

    if not to_generate:
        logger.info("All sentences already cached!")
        return

    # Init Gemini client (shared across threads — SDK is thread-safe)
    import google.genai as genai
    client = genai.Client(vertexai=True, project=GCP_PROJECT, location=LOCATION)

    # Generate with thread pool
    start = time.time()
    ok_count = 0
    err_count = 0
    total = len(to_generate)

    with ThreadPoolExecutor(max_workers=args.workers) as pool:
        futures = {
            pool.submit(_synthesize_and_upload, client, bucket, text, key): (text, key)
            for text, key in to_generate
        }
        for i, future in enumerate(as_completed(futures), 1):
            result = future.result()
            if result["status"] == "ok":
                ok_count += 1
                if ok_count % 50 == 0:
                    elapsed = time.time() - start
                    rate = ok_count / elapsed
                    remaining = (total - i) / rate if rate > 0 else 0
                    logger.info(
                        "[%d/%d] ok=%d err=%d  %.1f/s  ETA %.0fm",
                        i, total, ok_count, err_count, rate, remaining / 60,
                    )
            else:
                err_count += 1
                logger.warning(
                    "[%d/%d] ERROR key=%s: %s",
                    i, total, result["key"][:8], result["error"],
                )

    elapsed = time.time() - start
    logger.info(
        "Done! %d ok, %d errors, %.1f minutes (%.1f sentences/sec)",
        ok_count, err_count, elapsed / 60, ok_count / elapsed if elapsed > 0 else 0,
    )


if __name__ == "__main__":
    main()
