#!/usr/bin/env python3
"""Delete TTS cache objects that are stale rather than merely old (#2649 items 3 & 4a).

Two fixes landed on 2026-08-10 that change what synthesis *would* produce
without touching a single object already in the bucket:

  #2612/c53c68d3  the Taiwan reading table was rebuilt from the MOE dictionary
                  (198 entries, now including 攻擊 and 嘆息 — the words Hans
                  reported). The table is applied as SSML <sub> at synthesis
                  time, so every sentence cached before it shipped still holds
                  the old reading.

  #2649/abad95d7  an Azure cache miss no longer falls through to the google
                  prefix, so the mainland-accent objects written during the
                  2026-08-08 Azure outage stop being served. They are now
                  unreachable, not gone.

The cache key is sha256 of the raw sentence text (normalization._cache_key),
which does not change when the correction table does — that is the whole
problem: a stale object keeps winning the lookup forever. Deleting the object
is the invalidation mechanism; the next request re-synthesizes with the
current table.

Selection never guesses. `pronunciation` mode derives candidates from
backend/data/sentences.v2.jsonl, the same corpus the serving path uses to
build a lesson's sentence list, and keeps the ones the live transform actually
rewrites — asked by running it, not by consulting the table it reads from.
Candidates cover both units the runtime requests: individual sentences, and
whole paragraphs since #2662 made a paragraph one request. `mainland-orphans`
mode lists the google prefix and keeps only objects with no azure counterpart.

Deleting is opt-in. Without --delete this reports and exits, and even with it
only the objects this run itself flagged are removed — never a prefix sweep.

Usage:
  set -a; source backend/.env; set +a

  # what would be deleted (safe anytime)
  python backend/scripts/purge_stale_tts_cache.py --mode pronunciation
  python backend/scripts/purge_stale_tts_cache.py --mode mainland-orphans

  # actually delete, writing an evidence file naming every object removed
  python backend/scripts/purge_stale_tts_cache.py --mode pronunciation \
      --delete --report /tmp/purge-pronunciation.json

Re-synthesis happens lazily on the next request. To pre-warm instead of
making a student pay the first-hit latency, run batch_azure_tts.py afterwards.
"""
from __future__ import annotations

import argparse
import collections
import json
import logging
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "backend"))

from app.services.tts.normalization import (  # noqa: E402
    _cache_key,
    corrections_change_text,
)

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s",
                    datefmt="%H:%M:%S")
logger = logging.getLogger("purge-tts")

GCS_BUCKET = "lingoleap-tts-cache"
AZURE_PREFIX = "azure/sentences"
GOOGLE_PREFIX = "tts-cache"
GEMINI_PREFIX = "gemini31-prompt-only-v2/sentences"

SENTENCES_PATH = ROOT / "backend" / "data" / "sentences.v2.jsonl"


def load_corpus_sentences(path: Path = SENTENCES_PATH) -> list[dict]:
    """Every sentence in the serving corpus, in file order.

    This is the same JSONL build_lesson_tts_mapping() reads, so a key computed
    here is the key the runtime looks up. Deriving candidates from the corpus
    (rather than from the bucket) is what makes the selection auditable: the
    bucket only holds sha256 names, which cannot be turned back into text.
    """
    rows: list[dict] = []
    with open(path, encoding="utf-8") as fh:
        for line in fh:
            line = line.strip()
            if not line:
                continue
            row = json.loads(line)
            text = row.get("text", "")
            if text.strip():
                rows.append(row)
    return rows


def build_paragraph_texts(sentences: list[dict]) -> list[dict]:
    """Reconstruct each paragraph exactly as the player synthesizes it.

    Since #2662 a paragraph is one TTS request — the pitch contour resets at
    every request, so per-sentence clips read like a list rather than someone
    reading. The client rebuilds the paragraph as `canonical.join('').trim()`
    over the mapping's sentence list, so that is reproduced verbatim here; any
    other join produces a key the runtime never looks up.

    Both granularities live in the bucket at once (the keys are just sha256 of
    whatever text was sent), so both have to be enumerated. Sentence keys alone
    would repeat, one unit up, exactly the miss that #2661 caused.
    """
    grouped: dict[tuple, list[dict]] = {}
    for row in sentences:
        grouped.setdefault((row.get("lesson_id"), row.get("paragraph_idx")), []).append(row)

    paragraphs: list[dict] = []
    for (lesson_id, paragraph_idx), rows in grouped.items():
        ordered = sorted(rows, key=lambda r: r.get("sentence_idx", 0))
        text = "".join(r["text"] for r in ordered).strip()
        if text:
            paragraphs.append({
                "lesson_id": lesson_id,
                "paragraph_idx": paragraph_idx,
                "sentence_idx": None,
                "text": text,
            })
    return paragraphs


def select_pronunciation_affected(sentences: list[dict]) -> list[dict]:
    """Every cached text unit whose synthesized reading now differs.

    Asks corrections_change_text — the transform itself — not a word list and
    not _has_phoneme_corrections. Both of those go stale: a copied list dies
    when the table is regenerated, and the predicate already died once, when
    #2661 added the 和 conjunction rule as its own branch inside
    _apply_phoneme_corrections. Selecting on the predicate would have skipped
    every sentence whose only change is 和 → 漢 — including 「和」向心力 on
    L01, one of the sentences actually reported — and reported success.

    Covers sentences and paragraphs, because both are units the runtime asks
    for and therefore both are units the bucket holds. A single-granularity
    sweep looks complete and is not.
    """
    candidates = [{**row, "unit": "sentence"} for row in sentences]
    candidates += [{**row, "unit": "paragraph"} for row in build_paragraph_texts(sentences)]

    affected: list[dict] = []
    seen: set[str] = set()
    for row in candidates:
        text = row["text"]
        if not corrections_change_text(text):
            continue
        key = _cache_key(text)
        # A one-sentence paragraph has the same text as its only sentence, so
        # the same key arrives twice. Deduplicating here rather than at delete
        # time keeps the reported count equal to the number of objects — an
        # inflated "973 flagged" that deletes 900 is a number nobody can check.
        if key in seen:
            continue
        seen.add(key)
        affected.append({
            "unit": row["unit"],
            "lesson_id": row.get("lesson_id"),
            "paragraph_idx": row.get("paragraph_idx"),
            "sentence_idx": row.get("sentence_idx"),
            "text": text,
            "key": key,
        })
    return affected


def find_existing(bucket, affected: list[dict], prefixes: list[str]) -> list[dict]:
    """Keep only candidates that actually have an object, and record where.

    One list_blobs per prefix beats len(affected) × len(prefixes) exists()
    calls — the same reason batch_azure_tts.py lists instead of probing.
    """
    present: dict[str, set[str]] = {}
    for prefix in prefixes:
        names = set()
        for blob in bucket.list_blobs(prefix=f"{prefix}/"):
            if blob.name.endswith(".mp3"):
                names.add(blob.name.rsplit("/", 1)[-1][: -len(".mp3")])
        present[prefix] = names
        logger.info("  %s/ holds %d object(s)", prefix, len(names))

    hits: list[dict] = []
    for cand in affected:
        paths = [f"{p}/{cand['key']}.mp3" for p in prefixes if cand["key"] in present[p]]
        if paths:
            hits.append({**cand, "paths": paths})
    return hits


def select_mainland_orphans(bucket) -> list[dict]:
    """Objects under the google prefix with no azure counterpart (#2649 item 4).

    These are the sentences the 2026-08-08 Azure outage wrote in the mainland
    voice. abad95d7 already stopped them being served; this removes them so a
    future cross-prefix read — or a provider switch back to google — cannot
    resurrect a voice that was rejected in 2026-04.

    An object present under BOTH prefixes is left alone: azure wins the lookup,
    so the google copy is dormant history, not a live mainland-accent hazard.
    """
    azure_keys = {
        b.name.rsplit("/", 1)[-1][: -len(".mp3")]
        for b in bucket.list_blobs(prefix=f"{AZURE_PREFIX}/")
        if b.name.endswith(".mp3")
    }
    logger.info("  %s/ holds %d object(s)", AZURE_PREFIX, len(azure_keys))

    google_names = [
        b.name for b in bucket.list_blobs(prefix=f"{GOOGLE_PREFIX}/")
        if b.name.endswith(".mp3")
    ]
    orphans = [
        {"key": name.rsplit("/", 1)[-1][: -len(".mp3")], "text": None, "paths": [name]}
        for name in google_names
        if name.rsplit("/", 1)[-1][: -len(".mp3")] not in azure_keys
    ]
    logger.info("  %s/ holds %d object(s), %d without an azure counterpart",
                GOOGLE_PREFIX, len(google_names), len(orphans))
    return orphans


def get_bucket(name: str):
    """The single place this script reaches real GCS.

    A named seam rather than an inline `storage.Client()` in main(): tests
    replace this one function, instead of patching sys.modules and hoping
    `from google.cloud import storage` resolves through the cache — it does
    not once any other test in the session has imported the real module,
    which is how a green test file turns red purely from run order.
    """
    from google.cloud import storage

    return storage.Client().bucket(name)


def apply_delete(bucket, flagged: list[dict]) -> list[str]:
    """Delete exactly the paths already flagged. Does no selection of its own.

    An object that is already gone (a second run, a concurrent partial delete)
    is not an error and is not counted as a deletion.
    """
    from google.api_core.exceptions import NotFound

    deleted: list[str] = []
    for item in flagged:
        for path in item["paths"]:
            try:
                bucket.blob(path).delete()
                deleted.append(path)
            except NotFound:
                logger.info("  %s already gone (skipping)", path)
    return deleted


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--bucket", default=GCS_BUCKET)
    ap.add_argument("--mode", choices=("pronunciation", "mainland-orphans"),
                    default="pronunciation")
    ap.add_argument("--include-dormant-prefixes", action="store_true",
                    help="pronunciation mode: also purge the google/gemini31 copies. "
                         "Off by default — with cross-prefix read-through gone "
                         "(abad95d7) only the azure copy can reach a student, and "
                         "the others cost nothing to keep.")
    ap.add_argument("--limit", type=int, default=0,
                    help="stop after N flagged items (0 = no limit); for a small "
                         "first pass before committing to the whole set")
    ap.add_argument("--report", type=Path,
                    help="write the flagged/deleted set here as JSON evidence")
    ap.add_argument("--delete", action="store_true",
                    help="actually delete (default: report only)")
    args = ap.parse_args(argv)

    bucket = get_bucket(args.bucket)

    if args.mode == "pronunciation":
        sentences = load_corpus_sentences()
        affected = select_pronunciation_affected(sentences)
        by_unit = collections.Counter(a.get("unit") for a in affected)
        logger.info(
            "Corpus: %d sentences in %d paragraphs. Affected: %d sentence(s) + %d paragraph(s).",
            len(sentences), len(build_paragraph_texts(sentences)),
            by_unit["sentence"], by_unit["paragraph"],
        )
        prefixes = [AZURE_PREFIX]
        if args.include_dormant_prefixes:
            prefixes += [GEMINI_PREFIX, GOOGLE_PREFIX]
        flagged = find_existing(bucket, affected, prefixes)
    else:
        flagged = select_mainland_orphans(bucket)

    if args.limit:
        flagged = flagged[: args.limit]

    object_count = sum(len(f["paths"]) for f in flagged)
    logger.info("Flagged %d cached sentence(s) / %d object(s).", len(flagged), object_count)
    for item in flagged[:10]:
        logger.info("  %s  %s", item["paths"], (item.get("text") or "")[:30])
    if len(flagged) > 10:
        logger.info("  ... and %d more (see --report for the full list)", len(flagged) - 10)

    deleted: list[str] = []
    if args.delete and flagged:
        deleted = apply_delete(bucket, flagged)
        logger.info("Deleted %d object(s). They re-synthesize on the next request; "
                    "run batch_azure_tts.py to pre-warm instead.", len(deleted))
    elif not args.delete:
        logger.info("Dry-run (default) — pass --delete to remove these %d object(s).",
                    object_count)

    if args.report:
        args.report.write_text(json.dumps({
            "mode": args.mode,
            "bucket": args.bucket,
            "applied": bool(args.delete),
            "flagged_sentences": len(flagged),
            "flagged_objects": object_count,
            "deleted_objects": deleted,
            "items": flagged,
        }, ensure_ascii=False, indent=2), encoding="utf-8")
        logger.info("Report written: %s", args.report)

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
