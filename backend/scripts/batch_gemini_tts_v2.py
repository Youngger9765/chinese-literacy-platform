"""Batch pre-generate Gemini 3.1 Flash TTS using v2 segmentation.

Reads backend/data/sentences.jsonl (2129 sentences from Opus v2 segmentation),
applies _clean_for_tts + Taiwan pronunciation fixes, cache-keys the final
TTS input, and generates missing audio via Gemini 3.1 Flash TTS → GCS.

Differs from batch_gemini_tts.py by sourcing from JSONL (v2 semantic
boundaries) instead of YAML (regex splits).

Usage:
    python backend/scripts/batch_gemini_tts_v2.py --voice Aoede --dry-run
    python backend/scripts/batch_gemini_tts_v2.py --voice Aoede --workers 10

Requires:
    gcloud ADC, google-genai SDK, ffmpeg.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import logging
import subprocess
import sys
import time
import uuid
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "backend"))

from app.services.tts_service import _clean_for_gemini, _clean_for_tts

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s", datefmt="%H:%M:%S")
logger = logging.getLogger(__name__)

GCS_BUCKET = "lingoleap-tts-cache"
GCS_PREFIX = "gemini31/sentences"
MODEL = "gemini-3.1-flash-tts-preview"
GCP_PROJECT = "lingoleap-dev"
LOCATION = "us-central1"
JSONL = ROOT / "backend" / "data" / "sentences.jsonl"
PROVENANCE = ROOT / "backend" / "data" / "tts-provenance.jsonl"


def _cache_key(text: str) -> str:
    return hashlib.sha256(text.strip().encode("utf-8")).hexdigest()


def _pcm_to_mp3(pcm_data: bytes) -> bytes:
    result = subprocess.run(
        ["ffmpeg", "-f", "s16le", "-ar", "24000", "-ac", "1", "-i", "pipe:0", "-f", "mp3", "-q:a", "2", "pipe:1"],
        input=pcm_data, capture_output=True, timeout=30,
    )
    if result.returncode != 0:
        raise RuntimeError(f"ffmpeg failed: {result.stderr.decode()[:200]}")
    return result.stdout


def _prep_tts_input(raw: str) -> tuple[str, list[dict]]:
    """Clean + Taiwan pronunciation. Returns (tts_input, replacements_applied)."""
    cleaned = _clean_for_tts(raw)
    tts_input = _clean_for_gemini(cleaned)
    replacements = []
    if tts_input != cleaned:
        replacements.append({"note": "taiwan_fixes_applied"})
    return tts_input, replacements


def _synthesize(client, bucket, tts_input: str, key: str, voice: str) -> dict:
    import google.genai.types as t
    try:
        resp = client.models.generate_content(
            model=MODEL,
            contents=tts_input,
            config=t.GenerateContentConfig(
                response_modalities=["AUDIO"],
                speech_config=t.SpeechConfig(
                    voice_config=t.VoiceConfig(prebuilt_voice_config=t.PrebuiltVoiceConfig(voice_name=voice))
                ),
            ),
        )
        if not resp.candidates or not resp.candidates[0].content or not resp.candidates[0].content.parts:
            fr = getattr(resp.candidates[0] if resp.candidates else None, "finish_reason", "unknown")
            return {"key": key, "status": "error", "error": f"empty (finish={fr})"}
        pcm = resp.candidates[0].content.parts[0].inline_data.data
        if not pcm:
            return {"key": key, "status": "error", "error": "empty PCM"}
        mp3 = _pcm_to_mp3(pcm)
        blob = bucket.blob(f"{GCS_PREFIX}/{key}.mp3")
        blob.upload_from_string(mp3, content_type="audio/mpeg")
        return {"key": key, "status": "ok", "bytes": len(mp3)}
    except Exception as exc:
        return {"key": key, "status": "error", "error": str(exc)[:200]}


def load_sentences():
    items = []
    with JSONL.open() as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            rec = json.loads(line)
            raw = rec["text"]
            tts_input, _ = _prep_tts_input(raw)
            key = _cache_key(tts_input)
            items.append({
                "raw_text": raw,
                "tts_input": tts_input,
                "cache_key": key,
                "lesson_id": rec["lesson_id"],
                "paragraph_idx": rec["paragraph_idx"],
                "sentence_idx": rec["sentence_idx"],
            })
    return items


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--voice", default="Aoede", help="Gemini 3.1 prebuilt voice (default: Aoede)")
    ap.add_argument("--workers", type=int, default=10)
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--limit", type=int, default=0, help="Only process first N (0=all)")
    args = ap.parse_args()

    items = load_sentences()
    if args.limit:
        items = items[: args.limit]
    logger.info("Loaded %d sentences from %s", len(items), JSONL.relative_to(ROOT))

    # Dedup by cache_key
    seen = {}
    for it in items:
        seen.setdefault(it["cache_key"], it)
    unique = list(seen.values())
    logger.info("Unique texts: %d (dup rate %.1f%%)", len(unique), 100 * (1 - len(unique) / max(len(items), 1)))

    if args.dry_run:
        from google.cloud import storage
        gcs = storage.Client()
        bucket = gcs.bucket(GCS_BUCKET)
        cached = sum(1 for it in unique if bucket.blob(f"{GCS_PREFIX}/{it['cache_key']}.mp3").exists())
        logger.info("Already cached: %d / %d  |  Need to generate: %d", cached, len(unique), len(unique) - cached)
        logger.info("Voice: %s  |  Model: %s", args.voice, MODEL)
        return

    from google.cloud import storage
    import google.genai as genai

    gcs = storage.Client()
    bucket = gcs.bucket(GCS_BUCKET)
    logger.info("Checking GCS cache...")
    to_gen = [it for it in unique if not bucket.blob(f"{GCS_PREFIX}/{it['cache_key']}.mp3").exists()]
    logger.info("Cached: %d  |  To generate: %d  |  Voice: %s", len(unique) - len(to_gen), len(to_gen), args.voice)
    if not to_gen:
        logger.info("All cached — nothing to do.")
        return

    client = genai.Client(vertexai=True, project=GCP_PROJECT, location=LOCATION)
    run_id = f"{datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ')}-{uuid.uuid4().hex[:8]}"
    start = time.time()
    ok = err = 0

    with PROVENANCE.open("a") as prov, ThreadPoolExecutor(max_workers=args.workers) as pool:
        futs = {pool.submit(_synthesize, client, bucket, it["tts_input"], it["cache_key"], args.voice): it for it in to_gen}
        for i, fut in enumerate(as_completed(futs), 1):
            res = fut.result()
            it = futs[fut]
            if res["status"] == "ok":
                ok += 1
                prov.write(json.dumps({
                    "audit_id": str(uuid.uuid4()),
                    "generated_at": datetime.now(timezone.utc).isoformat(),
                    "raw_text": it["raw_text"],
                    "tts_input": it["tts_input"],
                    "cache_key": it["cache_key"],
                    "gcs_uri": f"gs://{GCS_BUCKET}/{GCS_PREFIX}/{it['cache_key']}.mp3",
                    "audio_bytes": res["bytes"],
                    "provider": "gemini31",
                    "model": MODEL,
                    "voice": args.voice,
                    "lesson_id": it["lesson_id"],
                    "paragraph_idx": it["paragraph_idx"],
                    "sentence_idx": it["sentence_idx"],
                    "batch_run_id": run_id,
                    "segmenter_source": "v2-jsonl",
                }, ensure_ascii=False) + "\n")
                if ok % 50 == 0:
                    prov.flush()
                    rate = ok / (time.time() - start)
                    eta = (len(to_gen) - i) / rate / 60 if rate else 0
                    logger.info("[%d/%d] ok=%d err=%d %.1f/s ETA %.0fm", i, len(to_gen), ok, err, rate, eta)
            else:
                err += 1
                logger.warning("[%d/%d] ERR %s: %s", i, len(to_gen), res["key"][:8], res["error"])

    logger.info("Done: ok=%d err=%d in %.0fs (run_id=%s)", ok, err, time.time() - start, run_id)


if __name__ == "__main__":
    main()
