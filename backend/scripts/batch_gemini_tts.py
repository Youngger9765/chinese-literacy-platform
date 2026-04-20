"""Batch pre-generate Gemini 3.1 Flash TTS for all lessons with provenance audit trail.

Usage:
    python backend/scripts/batch_gemini_tts.py [--workers 10] [--dry-run] [--force]

Writes append-only JSONL audit log at backend/data/tts-provenance.jsonl
— every generation records raw_text, tts_input, model, voice, audio_sha256,
  replacements applied, git sha, timestamp, etc. at the write point.
No reconstruction: the log is the source of truth.

Requires:
    - gcloud ADC configured (gcloud auth application-default login)
    - google-genai SDK installed
    - ffmpeg + ffprobe installed locally
"""

from __future__ import annotations

import argparse
import hashlib
import json
import logging
import os
import re
import subprocess
import sys
import tempfile
import threading
import time
import uuid
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.services.lesson_loader import get_all_lessons
from app.services.tts_service import (
    _TAIWAN_TTS_REPLACEMENTS,
    _clean_for_gemini,
    _clean_for_tts,
    _split_sentences,
)

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
LANGUAGE_CODE = "zh-TW"
ENVIRONMENT = "local-batch"
PROVENANCE_FILE = Path(__file__).resolve().parent.parent / "data" / "tts-provenance.jsonl"


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _cache_key(text: str) -> str:
    return hashlib.sha256(text.strip().encode("utf-8")).hexdigest()


def _file_sha(path: Path) -> str | None:
    try:
        return hashlib.sha256(path.read_bytes()).hexdigest()
    except FileNotFoundError:
        return None


def _git_sha() -> str:
    try:
        return subprocess.check_output(
            ["git", "rev-parse", "HEAD"], text=True, stderr=subprocess.DEVNULL
        ).strip()
    except Exception:
        return "unknown"


def _gcloud_account() -> str:
    try:
        out = subprocess.check_output(
            ["gcloud", "config", "get-value", "account"],
            text=True, stderr=subprocess.DEVNULL,
        ).strip()
        return out or os.environ.get("USER", "unknown")
    except Exception:
        return os.environ.get("USER", "unknown")


def _audio_duration_ms(mp3_bytes: bytes) -> int | None:
    """Duration via ffprobe. Writes to tempfile because MP3 frames need
    full-file scan to measure duration accurately (no Xing header from Gemini)."""
    try:
        with tempfile.NamedTemporaryFile(suffix=".mp3", delete=True) as tf:
            tf.write(mp3_bytes)
            tf.flush()
            r = subprocess.run(
                ["ffprobe", "-v", "error", "-show_entries", "format=duration",
                 "-of", "default=noprint_wrappers=1:nokey=1", tf.name],
                capture_output=True, timeout=10,
            )
            if r.returncode == 0 and r.stdout:
                return int(float(r.stdout.decode().strip()) * 1000)
    except Exception:
        pass
    return None


def _detect_replacements(raw_sent: str, tts_input: str) -> list[dict]:
    """Inspect which replacement rules were triggered.

    Note: `raw_sent` is already post-_clean_for_tts (symbols stripped at
    paragraph level before splitting). `tts_input` is post-_clean_for_gemini.
    """
    applied: list[dict] = []

    # Taiwan pronunciation — scan rules
    for orig, repl in _TAIWAN_TTS_REPLACEMENTS:
        if orig in raw_sent:
            applied.append({
                "from": orig, "to": repl, "rule": "taiwan_pronunciation",
            })

    # Numbers — regex match arabic numerals that got converted
    for m in re.finditer(r"\d+(?:[.\-]\d+)?", raw_sent):
        applied.append({
            "from": m.group(), "rule": "numbers_to_chinese_tw",
        })

    return applied


class ProvenanceLogger:
    """Thread-safe append-only JSONL logger.

    On init, scans existing file to build cache_key → latest audit_id index,
    so new entries can set `supersedes` to the previous entry's audit_id.
    """

    def __init__(self, path: Path):
        self.path = path
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self._lock = threading.Lock()
        self._latest_audit_by_key: dict[str, str] = {}

        if self.path.exists():
            with open(self.path, "r", encoding="utf-8") as f:
                for line in f:
                    try:
                        e = json.loads(line)
                        self._latest_audit_by_key[e["cache_key"]] = e["audit_id"]
                    except (json.JSONDecodeError, KeyError):
                        continue

        self._fh = open(self.path, "a", encoding="utf-8")

    def write(self, entry: dict) -> None:
        with self._lock:
            entry["supersedes"] = self._latest_audit_by_key.get(entry["cache_key"])
            line = json.dumps(entry, ensure_ascii=False, separators=(",", ":"))
            self._fh.write(line + "\n")
            self._fh.flush()
            self._latest_audit_by_key[entry["cache_key"]] = entry["audit_id"]

    def close(self) -> None:
        with self._lock:
            self._fh.close()


# ---------------------------------------------------------------------------
# Synthesis
# ---------------------------------------------------------------------------


def _pcm_to_mp3(pcm_data: bytes) -> bytes:
    result = subprocess.run(
        ["ffmpeg", "-f", "s16le", "-ar", "24000", "-ac", "1",
         "-i", "pipe:0", "-f", "mp3", "-q:a", "2", "pipe:1"],
        input=pcm_data, capture_output=True, timeout=30,
    )
    if result.returncode != 0:
        raise RuntimeError(f"ffmpeg failed: {result.stderr.decode()}")
    return result.stdout


def _check_gcs_exists(bucket, key: str) -> bool:
    return bucket.blob(f"{GCS_PREFIX}/{key}.mp3").exists()


def _synthesize_and_upload(client, bucket, provenance: ProvenanceLogger,
                           job: dict, run_meta: dict) -> dict:
    """Generate one sentence, upload to GCS, write provenance entry atomically."""
    import google.genai.types as genai_types

    key = job["cache_key"]
    t_start = time.time()
    try:
        response = client.models.generate_content(
            model=MODEL,
            contents=job["tts_input"],
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
        latency_ms = int((time.time() - t_start) * 1000)

        pcm_data = response.candidates[0].content.parts[0].inline_data.data
        if not pcm_data:
            return {"key": key, "status": "error", "error": "empty PCM"}

        mp3_data = _pcm_to_mp3(pcm_data)
        audio_sha = hashlib.sha256(mp3_data).hexdigest()
        duration_ms = _audio_duration_ms(mp3_data)

        gcs_uri = f"gs://{GCS_BUCKET}/{GCS_PREFIX}/{key}.mp3"
        bucket.blob(f"{GCS_PREFIX}/{key}.mp3").upload_from_string(
            mp3_data, content_type="audio/mpeg",
        )

        entry = {
            "audit_id": str(uuid.uuid4()),
            "generated_at": datetime.now(timezone.utc).astimezone().isoformat(),

            # Content
            "raw_text": job["raw_text"],
            "tts_input": job["tts_input"],
            "source_paragraph": job["source_paragraph"],
            "replacements_applied": _detect_replacements(
                job["raw_text"], job["tts_input"],
            ),

            # Output location + integrity
            "cache_key": key,
            "gcs_uri": gcs_uri,
            "audio_sha256": audio_sha,
            "audio_bytes": len(mp3_data),
            "audio_duration_ms": duration_ms,

            # Model / provider
            "provider": "gemini31",
            "model": MODEL,
            "voice": VOICE,
            "language_code": LANGUAGE_CODE,
            "location": LOCATION,

            # Source traceability
            "lesson_id": job["lesson_id"],
            "paragraph_idx": job["paragraph_idx"],
            "sentence_idx": job["sentence_idx"],
            "lesson_yaml_sha": job["lesson_yaml_sha"],

            # Run / code provenance
            "batch_run_id": run_meta["batch_run_id"],
            "script_git_sha": run_meta["script_git_sha"],
            "generated_by": run_meta["generated_by"],
            "environment": ENVIRONMENT,

            # API metrics
            "generation_latency_ms": latency_ms,
            "attempt_number": 1,
            # supersedes: set by ProvenanceLogger.write() from prior entry w/ same cache_key
        }
        provenance.write(entry)

        return {"key": key, "status": "ok", "bytes": len(mp3_data)}

    except Exception as exc:
        return {"key": key, "status": "error", "error": str(exc)[:200]}


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------


def main():
    parser = argparse.ArgumentParser(
        description="Batch Gemini 3.1 TTS generation with provenance audit trail"
    )
    parser.add_argument("--workers", type=int, default=10, help="Parallel workers")
    parser.add_argument("--dry-run", action="store_true", help="Count only")
    parser.add_argument("--force", action="store_true",
                        help="Regenerate even if GCS cache exists (overwrites blob, writes new audit entry)")
    args = parser.parse_args()

    run_meta = {
        "batch_run_id": f"{datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ')}-{uuid.uuid4().hex[:8]}",
        "script_git_sha": _git_sha(),
        "generated_by": _gcloud_account(),
    }
    logger.info("Run: %s", run_meta)
    logger.info("Provenance: %s", PROVENANCE_FILE)

    lessons = get_all_lessons()
    lesson_yaml_dir = Path(__file__).resolve().parent.parent / "data" / "lessons"
    jobs: list[dict] = []

    for lesson in lessons:
        lid_raw = lesson.get("id") or lesson.get("lesson_number")
        try:
            lid_int = int(lid_raw)
        except (TypeError, ValueError):
            logger.warning("Skip lesson with non-int id: %r", lid_raw)
            continue
        yaml_path = lesson_yaml_dir / f"L{lid_int:02d}.yml"
        lesson_yaml_sha = _file_sha(yaml_path)

        for p_idx, p in enumerate(lesson.get("paragraphs", [])):
            source_paragraph = str(p)
            cleaned = _clean_for_tts(source_paragraph)
            if not cleaned:
                continue
            for s_idx, sent in enumerate(_split_sentences(cleaned)):
                sent = sent.strip()
                if not sent:
                    continue
                tts_input = _clean_for_gemini(sent)
                jobs.append({
                    "raw_text": sent,
                    "tts_input": tts_input,
                    "source_paragraph": source_paragraph,
                    "cache_key": _cache_key(sent),
                    "lesson_id": lid_int,
                    "paragraph_idx": p_idx,
                    "sentence_idx": s_idx,
                    "lesson_yaml_sha": lesson_yaml_sha,
                })

    logger.info("Total: %d sentences across %d lessons", len(jobs), len(lessons))

    if args.dry_run:
        logger.info("Dry run — exiting")
        return

    from google.cloud import storage
    bucket = storage.Client().bucket(GCS_BUCKET)

    if args.force:
        logger.info("--force enabled: regenerating ALL %d sentences", len(jobs))
        to_generate = jobs
        already_cached = 0
    else:
        logger.info("Checking GCS cache...")
        to_generate = [j for j in jobs if not _check_gcs_exists(bucket, j["cache_key"])]
        already_cached = len(jobs) - len(to_generate)

    logger.info("Already cached: %d, Need to generate: %d", already_cached, len(to_generate))

    if not to_generate:
        logger.info("Nothing to do!")
        return

    import google.genai as genai
    client = genai.Client(vertexai=True, project=GCP_PROJECT, location=LOCATION)
    provenance = ProvenanceLogger(PROVENANCE_FILE)

    start = time.time()
    ok_count = err_count = 0
    total = len(to_generate)

    try:
        with ThreadPoolExecutor(max_workers=args.workers) as pool:
            futures = {
                pool.submit(_synthesize_and_upload, client, bucket, provenance, job, run_meta): job
                for job in to_generate
            }
            for i, future in enumerate(as_completed(futures), 1):
                result = future.result()
                if result["status"] == "ok":
                    ok_count += 1
                    if ok_count % 50 == 0:
                        elapsed = time.time() - start
                        rate = ok_count / elapsed
                        eta_min = (total - i) / rate / 60 if rate > 0 else 0
                        logger.info(
                            "[%d/%d] ok=%d err=%d  %.1f/s  ETA %.0fm",
                            i, total, ok_count, err_count, rate, eta_min,
                        )
                else:
                    err_count += 1
                    logger.warning(
                        "[%d/%d] ERROR key=%s: %s",
                        i, total, result["key"][:8], result["error"],
                    )
    finally:
        provenance.close()

    elapsed = time.time() - start
    logger.info(
        "Done! %d ok, %d errors, %.1f min (%.1f sentences/sec)",
        ok_count, err_count, elapsed / 60,
        ok_count / elapsed if elapsed > 0 else 0,
    )
    logger.info("Provenance log: %s", PROVENANCE_FILE)


if __name__ == "__main__":
    main()
